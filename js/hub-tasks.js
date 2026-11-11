// Two-way sync between a MAREO project's notes and a person's lane on a
// production hub's Tareas board (the Opi hub: Cloudflare Pages + D1, /api/db).
// No background job: it runs when MAREO opens, when the tab comes back into
// view, after a refresh, and a few seconds after a note of that project is
// edited. Each synced note carries hubId (the board doc id), hubAt (the hub
// version it last matched) and hubSynced (its own updatedAt at that moment),
// so a change on either side is detected and the newer one wins.
import { Store } from './store.js';

const LINKS = [
  {
    projectId: 'proj-silence',
    hub: 'https://opi-hub-e5unvvjl.pages.dev',
    uid: '7kJgWTraHBdsVXzzn9X8owXszS92', // MAREO account (carlinifederico@gmail.com)
    lane: 'fede', name: 'Fede', email: 'carlini@3dar.com', // hub identity
  },
];

const PUSH_DELAY = 2500;
const state = new Map(); // projectId -> { rows: Map(id -> row), lastAt, loaded }
const tombstones = new Set(); // hub ids deleted here, until the hub confirms
let running = false, again = false, timer = null, selfSave = false;

const linkFor = (projectId) => LINKS.find(l => l.projectId === projectId);
const mine = (l) => Store._uid === l.uid;

async function api(l, body) {
  const res = await fetch(l.hub + '/api/db' + (body ? '' : '?since=' + Math.max(0, state.get(l.projectId).lastAt - 10000)), {
    method: body ? 'POST' : 'GET',
    headers: { 'content-type': 'application/json', 'x-opi-user': l.name },
    body: body ? JSON.stringify(body) : undefined,
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
    if (r.deleted || !r.data || r.data.lane !== l.lane) { st.rows.delete(r.id); tombstones.delete(r.id); }
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
  let changed = false, dirty = false;
  const now = () => Date.now();
  const byHub = new Map(proj.projectNotes.filter(n => n.hubId).map(n => [n.hubId, n]));
  const write = async (body) => {
    const j = await api(l, body);
    const r = j.rows && j.rows[0];
    if (r) { if (r.at > st.lastAt) st.lastAt = r.at; if (!r.deleted) st.rows.set(r.id, { ...r, col: 'board' }); }
    return r;
  };

  // Hub -> MAREO, and MAREO edits of linked notes -> hub
  const fresh = [];
  for (const [id, r] of st.rows) {
    if (tombstones.has(id)) continue;
    const n = byHub.get(id);
    if (!n) {
      fresh.push({
        id: 'pn-' + crypto.randomUUID(), title: r.data.title || '', content: '', done: !!r.data.done,
        createdAt: r.data.created_at || now(), updatedAt: now(), hubId: id, hubAt: r.at,
      });
      continue;
    }
    const localChanged = (n.updatedAt || 0) > (n.hubSynced || 0);
    const hubChanged = r.at > (n.hubAt || 0);
    if (hubChanged && (!localChanged || r.at >= n.updatedAt)) {
      n.title = r.data.title || ''; n.done = !!r.data.done; n.hubAt = r.at;
      n.updatedAt = n.hubSynced = now();
      changed = true;
    } else if (localChanged) {
      const seen = n.updatedAt;
      const done = !!n.done;
      const out = await write({ op: 'update', col: 'board', id, data: {
        title: n.title || '', done, doneAt: done ? (r.data.doneAt || now()) : { __delete__: true }, by: l.email, at: now(),
      } });
      if (out) { n.hubAt = out.at; n.hubSynced = seen; dirty = true; }
    }
  }
  for (const n of fresh) { n.hubSynced = n.updatedAt; proj.projectNotes.unshift(n); changed = true; }

  // Linked notes whose task is gone from the lane (deleted or moved to someone else)
  const before = proj.projectNotes.length;
  proj.projectNotes = proj.projectNotes.filter(n => !n.hubId || st.rows.has(n.hubId) || tombstones.has(n.hubId));
  if (proj.projectNotes.length !== before) changed = true;

  // New MAREO notes -> new tasks in the lane
  let order = Math.max(-1, ...[...st.rows.values()].map(r => +(r.data && r.data.order) || 0));
  for (const n of proj.projectNotes) {
    if (n.hubId || (n.depth || 0) > 0 || !(n.title || '').trim()) continue;
    const seen = n.updatedAt;
    const t = now();
    const out = await write({ op: 'add', col: 'board', data: {
      title: n.title.trim(), note: '', due: '', scene: '', lane: l.lane, order: ++order, done: !!n.done,
      created_by: l.email, created_at: n.createdAt || t, by: l.email, at: t,
    } });
    if (out) { n.hubId = out.id; n.hubAt = out.at; n.hubSynced = seen; dirty = true; }
  }

  if (changed || dirty) {
    selfSave = true; Store._skipUndo = true;
    try { Store.save(); } finally { Store._skipUndo = false; selfSave = false; }
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

const later = () => { clearTimeout(timer); timer = setTimeout(syncHubTasks, PUSH_DELAY); };

export function initHubTasks() {
  // Any save of the user's data may touch a linked project's notes.
  const save = Store.save.bind(Store);
  Store.save = () => { save(); if (!selfSave) later(); };
  // Deleting a linked note deletes its task on the hub.
  const remove = Store.removeProjectNote.bind(Store);
  Store.removeProjectNote = (projectId, noteId) => {
    const l = linkFor(projectId);
    const n = l && (Store._findProject(projectId)?.projectNotes || []).find(x => x.id === noteId);
    remove(projectId, noteId);
    if (n && n.hubId && mine(l)) {
      tombstones.add(n.hubId);
      api(l, { op: 'delete', col: 'board', id: n.hubId }).catch(err => console.warn('hub task delete failed', err));
    }
  };
  const refresh = Store.refresh.bind(Store);
  Store.refresh = async () => { await refresh(); syncHubTasks(); };
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') syncHubTasks(); });
}
