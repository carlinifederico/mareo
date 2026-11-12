// One way only: tasks of a person's lane on a production hub's Tareas board
// (the Opi hub: Cloudflare Pages + D1, /api/db) come into a MAREO project's
// notes. MAREO never writes to the hub. Runs on events, no background job:
// when MAREO opens, when the tab comes back into view and after a refresh.
// Each note made from a task carries hubId (the board doc id) and hubAt (the
// hub version it last took); when the task changes on the hub, the note takes
// the new title and done. They are the priority ones (hubMain) and show first.
// Deleting such a note in MAREO hides that task here (proj.hubDismissed) and
// leaves it on the hub. Rows with from:'mareo' were uploaded by an earlier
// version and are ignored.
import { Store } from './store.js';

const LINKS = [
  {
    projectId: 'proj-silence',
    hub: 'https://opi-hub-e5unvvjl.pages.dev',
    uid: '7kJgWTraHBdsVXzzn9X8owXszS92', // MAREO account (carlinifederico@gmail.com)
    lane: 'fede', name: 'Fede', email: 'carlini@3dar.com', // hub identity
  },
];

const state = new Map(); // projectId -> { rows: Map(id -> row), lastAt, loaded }
let running = false, again = false;

const same = (a, b) => (a || '').trim().toLowerCase() === (b || '').trim().toLowerCase();
const linkFor =(projectId) => LINKS.find(l => l.projectId === projectId);
const mine = (l) => Store._uid === l.uid;

async function api(l) {
  const res = await fetch(l.hub + '/api/db?since=' + Math.max(0, state.get(l.projectId).lastAt - 10000), {
    headers: { 'x-opi-user': l.name },
  });
  if (!res.ok) throw new Error('hub ' + res.status);
  return res.json();
}

async function pull(l) {
  let st = state.get(l.projectId);
  if (!st) state.set(l.projectId, st = { rows: new Map(), lastAt: 0, loaded: false });
  const { rows } = await api(l);
  for (const r of rows) {
    if (r.at > st.lastAt) st.lastAt = r.at;
    if (r.col !== 'board') continue;
    if (r.deleted || !r.data || r.data.lane !== l.lane) st.rows.delete(r.id);
    else st.rows.set(r.id, r);
  }
  st.loaded = true;
  return st;
}

async function syncProject(l) {
  const st = await pull(l);
  const proj = Store._findProject(l.projectId);
  if (!proj) return;
  if (!proj.projectNotes) proj.projectNotes = [];
  const dismissed = new Set(proj.hubDismissed || []);
  let changed = false;
  const now = () => Date.now();
  const byHub = new Map(proj.projectNotes.filter(n => n.hubId).map(n => [n.hubId, n]));

  const fresh = [];
  for (const [id, r] of st.rows) {
    if (dismissed.has(id) || r.data.from) continue; // only tasks made on the hub come in
    const n = byHub.get(id);
    if (!n) {
      // A note with the same title that lost its link (a save that never
      // reached Firestore, another device): link it instead of duplicating.
      const twin = proj.projectNotes.find(x => !x.hubId && !(x.depth > 0) && same(x.title, r.data.title));
      if (twin) {
        Object.assign(twin, { hubId: id, hubAt: r.at, hubMain: true });
        byHub.set(id, twin);
        changed = true;
        continue;
      }
      fresh.push({
        id: 'pn-' + crypto.randomUUID(), title: r.data.title || '', content: '', done: !!r.data.done,
        createdAt: r.data.created_at || now(), updatedAt: now(), hubId: id, hubAt: r.at, hubMain: true,
      });
      continue;
    }
    if (n.hubMain !== true) { n.hubMain = true; changed = true; }
    if (r.at > (n.hubAt || 0)) {
      n.title = r.data.title || ''; n.done = !!r.data.done; n.hubAt = r.at; n.updatedAt = now();
      changed = true;
    }
  }
  for (const n of fresh) { proj.projectNotes.unshift(n); changed = true; }

  // Linked notes whose hub task is gone (deleted or moved to someone else's
  // lane) go too. MAREO's own notes that an earlier version uploaded
  // (hubMain false) only lose the link: they stay in MAREO.
  const kept = [];
  for (const n of proj.projectNotes) {
    const r = n.hubId && st.rows.get(n.hubId);
    if (!n.hubId || (r && !r.data.from)) { kept.push(n); continue; }
    changed = true;
    if (n.hubMain === false || (r && r.data.from)) {
      delete n.hubId; delete n.hubAt; delete n.hubSynced; delete n.hubMain;
      kept.push(n);
    }
  }
  proj.projectNotes = kept;

  if (changed) {
    Store._skipUndo = true;
    try { Store.save(); } finally { Store._skipUndo = false; }
  }
  // Don't re-render under someone typing; the next render shows it.
  if (changed && !document.activeElement?.classList?.contains('note-preview-text')) {
    document.dispatchEvent(new Event('mareo:render'));
  }
}

export async function syncHubTasks() {
  if (running) { again = true; return; }
  running = true;
  try {
    for (const l of LINKS) {
      if (!mine(l) || !Store.data) continue;
      await syncProject(l).catch(err => console.warn('hub tasks sync failed', l.projectId, err));
    }
  } finally {
    running = false;
    if (again) { again = false; syncHubTasks(); }
  }
}

export function initHubTasks() {
  // Deleting a hub task's note in MAREO hides that task here; the hub keeps it.
  const remove = Store.removeProjectNote.bind(Store);
  Store.removeProjectNote = (projectId, noteId) => {
    const proj = linkFor(projectId) && Store._findProject(projectId);
    const n = proj && (proj.projectNotes || []).find(x => x.id === noteId);
    if (n && n.hubId) proj.hubDismissed = [...new Set([...(proj.hubDismissed || []), n.hubId])];
    remove(projectId, noteId);
  };
  const refresh = Store.refresh.bind(Store);
  Store.refresh = async () => { await refresh(); syncHubTasks(); };
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') syncHubTasks(); });
}
