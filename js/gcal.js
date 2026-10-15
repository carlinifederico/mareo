// Read-only Google Calendar overlay for Today Tasks.
// Uses the same Google account the user signs in with: a separate popup asks
// for the calendar.readonly scope and returns an OAuth access token, which we
// keep in sessionStorage until it expires (Firebase doesn't refresh Google
// access tokens, so after ~1h the user reconnects with one click).
import { auth, GoogleAuthProvider, reauthenticateWithPopup } from './firebase-config.js';

const SCOPE = 'https://www.googleapis.com/auth/calendar.readonly';
const API = 'https://www.googleapis.com/calendar/v3';
const TOKEN_KEY = 'mareo_gcal_token';
const ENABLED_KEY = 'mareo_gcal_enabled';
const CACHE_MS = 5 * 60 * 1000;

let calendarsPromise = null;
const dayCache = new Map(); // dateKey → { at, events }

function readToken() {
  try {
    const t = JSON.parse(sessionStorage.getItem(TOKEN_KEY) || 'null');
    return t && t.exp > Date.now() ? t.token : null;
  } catch { return null; }
}

function clearToken() {
  try { sessionStorage.removeItem(TOKEN_KEY); } catch {}
  calendarsPromise = null;
  dayCache.clear();
}

// Token rejected by Google (revoked/expired early): keep a marker so the UI
// shows "Reconectar" rather than the first-time "Conectar".
function expireToken() {
  try { sessionStorage.setItem(TOKEN_KEY, JSON.stringify({ token: null, exp: 0 })); } catch {}
  calendarsPromise = null;
  dayCache.clear();
}

export const GCal = {
  isConnected() { return !!readToken(); },

  // Was connected this session but the token ran out → offer "Reconectar"
  isExpired() {
    try { return !readToken() && !!sessionStorage.getItem(TOKEN_KEY); } catch { return false; }
  },

  isEnabled() {
    try { return localStorage.getItem(ENABLED_KEY) !== '0'; } catch { return true; }
  },

  setEnabled(on) {
    try { localStorage.setItem(ENABLED_KEY, on ? '1' : '0'); } catch {}
  },

  async connect() {
    const provider = new GoogleAuthProvider();
    provider.addScope(SCOPE);
    const user = auth.currentUser;
    if (!user) throw new Error('Not signed in');
    if (user.email) provider.setCustomParameters({ login_hint: user.email });
    // Reauthenticate (not signIn) so picking another Google account fails
    // with auth/user-mismatch instead of switching the MAREO session.
    const result = await reauthenticateWithPopup(user, provider);
    const token = GoogleAuthProvider.credentialFromResult(result)?.accessToken;
    if (!token) throw new Error('No calendar token');
    try {
      sessionStorage.setItem(TOKEN_KEY, JSON.stringify({ token, exp: Date.now() + 55 * 60 * 1000 }));
    } catch {}
    calendarsPromise = null;
    dayCache.clear();
    this.setEnabled(true);
  },

  disconnect() { clearToken(); },

  // → { events: [...] } | { needsAuth: true } | { error }
  async getEvents(dateKey) {
    const token = readToken();
    if (!token) return { needsAuth: true };

    const cached = dayCache.get(dateKey);
    if (cached && Date.now() - cached.at < CACHE_MS) return { events: cached.events };

    try {
      const calendars = await getCalendars(token);
      const [y, m, d] = dateKey.split('-').map(Number);
      const dayStart = new Date(y, m - 1, d);
      const dayEnd = new Date(y, m - 1, d + 1);
      const params = new URLSearchParams({
        timeMin: dayStart.toISOString(),
        timeMax: dayEnd.toISOString(),
        singleEvents: 'true',
        orderBy: 'startTime',
        maxResults: '100',
      });
      const lists = await Promise.all(calendars.map(cal =>
        api(token, `/calendars/${encodeURIComponent(cal.id)}/events?${params}`)
          .then(r => (r.items || []).map(ev => normalize(ev, cal, dayStart)))
          .catch(err => { if (err.status === 401) throw err; return []; })
      ));
      const events = lists.flat().filter(Boolean);
      dayCache.set(dateKey, { at: Date.now(), events });
      return { events };
    } catch (err) {
      if (err.status === 401) { expireToken(); return { needsAuth: true }; }
      return { error: err.message || String(err) };
    }
  },
};

async function api(token, path) {
  const res = await fetch(API + path, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) {
    const err = new Error(`Calendar API ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return res.json();
}

// Calendars the user has ticked in Google Calendar (fetched once per token)
function getCalendars(token) {
  if (!calendarsPromise) {
    calendarsPromise = api(token, '/users/me/calendarList?minAccessRole=reader')
      .then(r => (r.items || []).filter(c => c.selected && !c.hidden))
      .catch(err => { calendarsPromise = null; throw err; });
  }
  return calendarsPromise;
}

function normalize(ev, cal, dayStart) {
  if (ev.status === 'cancelled') return null;
  // Skip events the user declined
  const me = (ev.attendees || []).find(a => a.self);
  if (me && me.responseStatus === 'declined') return null;

  const color = cal.backgroundColor || '#8ab4f8';
  const title = ev.summary || '(sin título)';
  if (ev.start?.date) return { title, allDay: true, color };

  const minutesOf = (iso) => Math.round((new Date(iso) - dayStart) / 60000);
  return {
    title,
    allDay: false,
    start: minutesOf(ev.start.dateTime),
    end: minutesOf(ev.end.dateTime),
    color,
  };
}
