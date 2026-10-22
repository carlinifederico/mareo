// Read-only Google Calendar access for Today Tasks, Home and Dedicación.
// Uses the same Google account the user signs in with: a popup asks for the
// calendar.readonly scope and returns an OAuth access token (~1h). The token
// is kept in localStorage so reloads and new tabs reuse it. When it runs out,
// reconnecting goes through Google Identity Services with prompt:'' (no
// account picker, closes by itself) if GIS_CLIENT_ID is set, else through the
// Firebase reauth popup.
import { auth, GoogleAuthProvider, reauthenticateWithPopup } from './firebase-config.js';

const SCOPE = 'https://www.googleapis.com/auth/calendar.readonly';
const API = 'https://www.googleapis.com/calendar/v3';
const TOKEN_KEY = 'mareo_gcal_token';
const ENABLED_KEY = 'mareo_gcal_enabled';
const CACHE_MS = 5 * 60 * 1000;
// OAuth web client of the Firebase project (GCP console → Credentials →
// "Web client (auto created by Google Service)"). Empty = Firebase popup only.
const GIS_CLIENT_ID = '';

let calendarsPromise = null;
const rangeCache = new Map(); // "min|max" → { at, events }

function readStored() {
  try { return JSON.parse(localStorage.getItem(TOKEN_KEY) || 'null'); } catch { return null; }
}

function readToken() {
  const t = readStored();
  return t && t.token && t.exp > Date.now() ? t.token : null;
}

function storeToken(token, expiresInSec = 3600) {
  try {
    localStorage.setItem(TOKEN_KEY, JSON.stringify({ token, exp: Date.now() + (expiresInSec - 300) * 1000 }));
  } catch {}
  calendarsPromise = null;
  rangeCache.clear();
}

// Token rejected by Google (revoked/expired early): keep a marker so the UI
// shows "Reconectar" rather than the first-time "Conectar".
function expireToken() {
  try { localStorage.setItem(TOKEN_KEY, JSON.stringify({ token: null, exp: 0 })); } catch {}
  calendarsPromise = null;
  rangeCache.clear();
}

let gisLoad = null;
function loadGis() {
  if (!gisLoad) {
    gisLoad = new Promise((resolve, reject) => {
      if (window.google?.accounts?.oauth2) return resolve();
      const s = document.createElement('script');
      s.src = 'https://accounts.google.com/gsi/client';
      s.async = true;
      s.onload = () => resolve();
      s.onerror = () => { gisLoad = null; reject(new Error('GIS load failed')); };
      document.head.appendChild(s);
    });
  }
  return gisLoad;
}

async function connectWithGis(email) {
  await loadGis();
  return new Promise((resolve, reject) => {
    const client = window.google.accounts.oauth2.initTokenClient({
      client_id: GIS_CLIENT_ID,
      scope: SCOPE,
      hint: email || undefined,
      callback: (resp) => {
        if (resp.error || !resp.access_token) return reject(new Error(resp.error || 'No calendar token'));
        storeToken(resp.access_token, Number(resp.expires_in) || 3600);
        resolve();
      },
      error_callback: (err) => reject(Object.assign(new Error(err?.type || 'gis_error'), { code: err?.type })),
    });
    client.requestAccessToken({ prompt: '' });
  });
}

export const GCal = {
  isConnected() { return !!readToken(); },

  // Was connected before but the token ran out → offer "Reconectar"
  isExpired() { return !readToken() && !!readStored(); },

  isEnabled() {
    try { return localStorage.getItem(ENABLED_KEY) !== '0'; } catch { return true; }
  },

  setEnabled(on) {
    try { localStorage.setItem(ENABLED_KEY, on ? '1' : '0'); } catch {}
  },

  async connect() {
    const user = auth.currentUser;
    if (!user) throw new Error('Not signed in');
    // Quick path once the scope was granted before
    if (GIS_CLIENT_ID && this.isExpired()) {
      try {
        await connectWithGis(user.email);
        this.setEnabled(true);
        return;
      } catch (err) {
        console.warn('GIS reconnect failed, falling back to popup', err);
      }
    }
    const provider = new GoogleAuthProvider();
    provider.addScope(SCOPE);
    if (user.email) provider.setCustomParameters({ login_hint: user.email });
    // Reauthenticate (not signIn) so picking another Google account fails
    // with auth/user-mismatch instead of switching the MAREO session.
    const result = await reauthenticateWithPopup(user, provider);
    const token = GoogleAuthProvider.credentialFromResult(result)?.accessToken;
    if (!token) throw new Error('No calendar token');
    storeToken(token);
    this.setEnabled(true);
  },

  disconnect() {
    try { localStorage.removeItem(TOKEN_KEY); } catch {}
    calendarsPromise = null;
    rangeCache.clear();
  },

  // One local day, with start/end in minutes from midnight.
  // → { events } | { needsAuth: true } | { error }
  async getEvents(dateKey) {
    const [y, m, d] = dateKey.split('-').map(Number);
    const dayStart = new Date(y, m - 1, d);
    const dayEnd = new Date(y, m - 1, d + 1);
    const res = await this.getRange(dayStart, dayEnd);
    if (!res.events) return res;
    const minutesOf = (ms) => Math.round((ms - dayStart.getTime()) / 60000);
    return {
      events: res.events.map(ev => ev.allDay ? ev : { ...ev, start: minutesOf(ev.startMs), end: minutesOf(ev.endMs) }),
    };
  },

  // Any range (e.g. a whole month) across the user's visible calendars,
  // following pagination. Timed events carry absolute startMs/endMs.
  async getRange(from, to) {
    const token = readToken();
    if (!token) return { needsAuth: true };

    const cacheKey = `${from.getTime()}|${to.getTime()}`;
    const cached = rangeCache.get(cacheKey);
    if (cached && Date.now() - cached.at < CACHE_MS) return { events: cached.events };

    try {
      const calendars = await getCalendars(token);
      const lists = await Promise.all(calendars.map(cal =>
        listCalendarEvents(token, cal, from, to)
          .catch(err => { if (err.status === 401) throw err; return []; })
      ));
      // The same meeting shows up once per calendar it's on → dedupe
      const seen = new Set();
      const events = [];
      for (const ev of lists.flat()) {
        if (!ev) continue;
        const k = `${ev.iCalUID || ev.id}|${ev.startMs || ev.date}`;
        if (seen.has(k)) continue;
        seen.add(k);
        events.push(ev);
      }
      events.sort((a, b) => (a.startMs || 0) - (b.startMs || 0));
      rangeCache.set(cacheKey, { at: Date.now(), events });
      return { events };
    } catch (err) {
      if (err.status === 401) { expireToken(); return { needsAuth: true }; }
      return { error: err.message || String(err) };
    }
  },
};

async function listCalendarEvents(token, cal, from, to) {
  const out = [];
  let pageToken = '';
  for (let page = 0; page < 10; page++) {
    const params = new URLSearchParams({
      timeMin: from.toISOString(),
      timeMax: to.toISOString(),
      singleEvents: 'true',
      orderBy: 'startTime',
      maxResults: '250',
    });
    if (pageToken) params.set('pageToken', pageToken);
    const r = await api(token, `/calendars/${encodeURIComponent(cal.id)}/events?${params}`);
    for (const ev of r.items || []) out.push(normalize(ev, cal));
    pageToken = r.nextPageToken;
    if (!pageToken) break;
  }
  return out;
}

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

function normalize(ev, cal) {
  if (ev.status === 'cancelled') return null;
  // Skip events the user declined
  const me = (ev.attendees || []).find(a => a.self);
  if (me && me.responseStatus === 'declined') return null;

  const base = {
    id: ev.id,
    iCalUID: ev.iCalUID || '',
    recurringEventId: ev.recurringEventId || '',
    calendarId: cal.id,
    title: ev.summary || '(sin título)',
    color: cal.backgroundColor || '#8ab4f8',
  };
  if (ev.start?.date) return { ...base, allDay: true, date: ev.start.date };
  return {
    ...base,
    allDay: false,
    startMs: new Date(ev.start.dateTime).getTime(),
    endMs: new Date(ev.end.dateTime).getTime(),
  };
}
