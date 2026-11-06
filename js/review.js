// "Revisar" tab (v2 only): what the Claude Code sessions are doing for each
// project, the progress of their task lists, and what waits for the user.
// Data comes from workItems/{sessionId}, written by tools/mareo-work.mjs from
// the local session transcripts. "Revisado" marks live in mareo_v2/{uid}.reviewed
// as { sessionId: updatedAt }, so a session that moves again shows up again.

import { Store } from './store.js';
import { Meta } from './meta-repo.js';
import { identityFor } from './identity.js';
import { db, collection, query, where, getDocs } from './firebase-config.js';

const DAYS = 7;
const REFRESH_MS = 2 * 60 * 1000;
const STATUS = {
  decide:  { label: 'Te pregunta',  rank: 0 },
  review:  { label: 'Para revisar', rank: 1 },
  running: { label: 'En curso',     rank: 2 },
  paused:  { label: 'Pausada',      rank: 3 },
};

let items = null;       // null = not loaded yet
let loadedAt = 0;
let loading = false;
let loadError = '';
let filter = 'mine';    // 'mine' = waiting for me, 'all'
let timer = null;

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}

function rerender() {
  document.dispatchEvent(new Event('mareo:render'));
}

function ago(ms) {
  const m = Math.round((Date.now() - ms) / 60000);
  if (m < 1) return 'recién';
  if (m < 60) return `hace ${m} min`;
  const h = Math.round(m / 60);
  if (h < 24) return `hace ${h} h`;
  const d = Math.round(h / 24);
  return d === 1 ? 'ayer' : `hace ${d} días`;
}

async function load() {
  if (loading || !Store._uid) return;
  loading = true;
  try {
    const snap = await getDocs(query(collection(db, 'workItems'), where('ownerUid', '==', Store._uid)));
    const since = Date.now() - DAYS * 86400000;
    items = snap.docs.map(d => d.data()).filter(x => (x.updatedAt || 0) >= since);
    loadError = '';
  } catch (err) {
    loadError = err?.code || String(err);
    items = items || [];
  }
  loadedAt = Date.now();
  loading = false;
  rerender();
}

function reviewedMap() {
  return Meta.user().reviewed || {};
}

function isReviewed(it) {
  return (reviewedMap()[it.sessionId] || 0) >= (it.updatedAt || 0);
}

function needsMe(it) {
  return !it.auto && (it.status === 'decide' || it.status === 'review') && !isReviewed(it);
}

function markReviewed(it, on) {
  const reviewed = { ...reviewedMap() };
  if (on) reviewed[it.sessionId] = it.updatedAt || Date.now();
  else delete reviewed[it.sessionId];
  Meta.updateUser({ reviewed });
  rerender();
}

function progressBar(pct, color) {
  const bar = el('div', 'rv-bar');
  bar.setAttribute('role', 'progressbar');
  bar.setAttribute('aria-valuemin', '0');
  bar.setAttribute('aria-valuemax', '100');
  bar.setAttribute('aria-valuenow', String(pct));
  const fill = el('span', 'rv-bar-fill');
  fill.style.width = `${pct}%`;
  if (color) fill.style.background = color;
  bar.appendChild(fill);
  return bar;
}

function projectColor(it) {
  const p = it.projectId && Store._findProject(it.projectId);
  return p ? identityFor(p).color : '#8A8D96';
}

export function renderReview(container) {
  container.innerHTML = '';
  if (items === null) load();
  if (!timer) timer = setInterval(() => { if (document.getElementById('view-review')?.classList.contains('active')) load(); }, REFRESH_MS);

  const page = el('div', 'v2-page rv-page');
  const head = el('header', 'rv-head');
  const titles = el('div');
  titles.appendChild(el('h1', 'rv-title', 'Revisar'));
  titles.appendChild(el('p', 'pp-muted', 'Lo que Claude está haciendo en tus sesiones, proyecto por proyecto, y lo que espera que mires.'));
  head.appendChild(titles);

  const tools = el('div', 'rv-tools');
  const seg = el('div', 'v2-segmented');
  seg.setAttribute('role', 'group');
  for (const [id, label] of [['mine', 'Pendiente de mí'], ['all', 'Todo']]) {
    const b = el('button', filter === id ? 'on' : '', label);
    b.type = 'button';
    b.setAttribute('aria-pressed', String(filter === id));
    b.addEventListener('click', () => { filter = id; rerender(); });
    seg.appendChild(b);
  }
  tools.appendChild(seg);
  const refresh = el('button', 'pp-btn-outline rv-refresh', loading ? 'Actualizando…' : 'Actualizar');
  refresh.type = 'button';
  refresh.disabled = loading;
  refresh.addEventListener('click', () => load());
  tools.appendChild(refresh);
  head.appendChild(tools);
  page.appendChild(head);

  if (items === null) {
    page.appendChild(el('p', 'pp-muted', 'Cargando sesiones…'));
    container.appendChild(page);
    return;
  }
  if (loadError) page.appendChild(el('p', 'rv-error', `No pude leer las sesiones (${loadError}).`));

  // Counters over every session of the last days
  const human = items.filter(x => !x.auto);
  const counts = el('div', 'rv-counts');
  const nDecide = human.filter(x => x.status === 'decide' && !isReviewed(x)).length;
  const nReview = human.filter(x => x.status === 'review' && !isReviewed(x)).length;
  const nRunning = human.filter(x => x.status === 'running').length;
  const nPaused = human.filter(x => x.status === 'paused').length;
  for (const [n, label, cls] of [[nDecide, 'te preguntan', 'decide'], [nReview, 'para revisar', 'review'], [nRunning, 'en curso', 'running'], [nPaused, 'pausadas', 'paused']]) {
    const c = el('div', `rv-count ${cls}`);
    c.append(el('b', null, String(n)), el('span', null, label));
    counts.appendChild(c);
  }
  page.appendChild(counts);
  page.appendChild(el('p', 'pp-muted rv-synced', `Sesiones de los últimos ${DAYS} días · leído ${ago(loadedAt)} · se actualiza solo cada 2 minutos`));

  // Group by project, most recently active first
  const groups = new Map();
  for (const it of items) {
    const key = it.projectId || it.projectName;
    if (!groups.has(key)) groups.set(key, { name: it.projectName, color: projectColor(it), list: [] });
    groups.get(key).list.push(it);
  }
  const ordered = [...groups.values()]
    .map(g => ({ ...g, last: Math.max(...g.list.map(x => x.updatedAt || 0)) }))
    .sort((a, b) => b.last - a.last);

  let shown = 0;
  for (const g of ordered) {
    const sessions = g.list.filter(x => !x.auto).sort((a, b) =>
      (STATUS[a.status]?.rank ?? 9) - (STATUS[b.status]?.rank ?? 9) || b.updatedAt - a.updatedAt);
    const visible = filter === 'mine' ? sessions.filter(x => needsMe(x) || x.status === 'running') : sessions;
    const autos = g.list.filter(x => x.auto);
    if (!visible.length && (filter === 'mine' || !autos.length)) continue;
    shown++;
    page.appendChild(renderGroup(g, sessions, visible, autos));
  }
  if (!shown) page.appendChild(el('p', 'rv-empty', filter === 'mine' ? 'Nada esperando por vos. Todo lo de las sesiones está revisado.' : 'No hay sesiones en los últimos días.'));

  container.appendChild(page);
}

function renderGroup(g, sessions, visible, autos) {
  const sec = el('section', 'v2-card rv-group');
  sec.style.setProperty('--proj', g.color);
  const head = el('div', 'rv-group-head');
  const name = el('h2', 'v2-card-title rv-group-name');
  name.append(el('span', 'rv-dot'), g.name);
  head.appendChild(name);

  // Project progress: all steps of its sessions that have a task list
  const withSteps = sessions.filter(x => (x.steps || []).length);
  const total = withSteps.reduce((n, x) => n + x.steps.length, 0);
  const done = withSteps.reduce((n, x) => n + x.steps.filter(s => s.status === 'completed').length, 0);
  const meta = el('div', 'rv-group-meta');
  const waiting = sessions.filter(needsMe).length;
  meta.appendChild(el('span', 'pp-muted', `${sessions.length} ${sessions.length === 1 ? 'sesión' : 'sesiones'}${waiting ? ` · ${waiting} esperan por vos` : ''}`));
  if (total) {
    const pct = Math.round((done / total) * 100);
    const wrap = el('div', 'rv-group-progress');
    wrap.append(progressBar(pct, g.color), el('span', 'rv-pct', `${done}/${total} pasos · ${pct}%`));
    meta.appendChild(wrap);
  }
  head.appendChild(meta);
  sec.appendChild(head);

  const list = el('div', 'rv-list');
  for (const it of visible) list.appendChild(renderSession(it, g.color));
  sec.appendChild(list);

  if (autos.length) {
    const det = el('details', 'rv-autos');
    const last = autos.reduce((a, b) => (b.updatedAt > a.updatedAt ? b : a));
    det.appendChild(el('summary', null, `Tareas automáticas: ${autos.length} ${autos.length === 1 ? 'corrida' : 'corridas'} · última ${ago(last.updatedAt)}`));
    const ul = el('ul', 'rv-autos-list');
    for (const a of autos.sort((x, y) => y.updatedAt - x.updatedAt)) {
      const li = el('li');
      li.append(el('span', 'rv-when', ago(a.updatedAt)), el('span', null, a.title + (a.recap ? ` — ${a.recap}` : '')));
      ul.appendChild(li);
    }
    det.appendChild(ul);
    sec.appendChild(det);
  }
  return sec;
}

function renderSession(it, color) {
  const reviewed = isReviewed(it) && it.status !== 'running';
  const card = el('article', `rv-item ${it.status}${reviewed ? ' reviewed' : ''}`);
  const top = el('div', 'rv-item-top');
  top.appendChild(el('span', `rv-status ${it.status}`, reviewed ? 'Revisado' : (STATUS[it.status]?.label || it.status)));
  top.appendChild(el('h3', 'rv-item-title', it.title || 'Sesión'));
  top.appendChild(el('span', 'rv-when', ago(it.updatedAt)));
  card.appendChild(top);

  const steps = it.steps || [];
  if (steps.length) {
    const done = steps.filter(s => s.status === 'completed').length;
    const pr = el('div', 'rv-item-progress');
    pr.append(progressBar(it.progress ?? Math.round((done / steps.length) * 100), color), el('span', 'rv-pct', `${done}/${steps.length}`));
    card.appendChild(pr);
    const ol = el('ol', 'rv-steps');
    for (const s of steps) {
      const li = el('li', `rv-step ${s.status}`);
      li.appendChild(el('span', 'rv-step-mark', s.status === 'completed' ? '✓' : s.status === 'in_progress' ? '●' : '○'));
      li.appendChild(el('span', null, s.label));
      if (s.status === 'in_progress' && it.status === 'running') li.appendChild(el('span', 'rv-now', 'ahora'));
      ol.appendChild(li);
    }
    card.appendChild(ol);
  }

  if (it.ask && it.status === 'decide') {
    const q = el('p', 'rv-ask');
    q.append(el('b', null, 'Te pregunta: '), it.ask);
    card.appendChild(q);
  }
  // While a session runs its last recap belongs to the previous turn
  if (it.recap && it.status !== 'running') card.appendChild(el('p', 'rv-recap', it.recap));
  if (it.lastPrompt) {
    const p = el('p', 'pp-muted rv-prompt');
    p.append(el('b', null, 'Último pedido: '), it.lastPrompt);
    card.appendChild(p);
  }

  if (it.status !== 'running') {
    const b = el('button', 'pp-brief-add rv-mark', reviewed ? 'Marcar pendiente' : 'Marcar revisado');
    b.type = 'button';
    b.addEventListener('click', () => markReviewed(it, !reviewed));
    card.appendChild(b);
  }
  return card;
}
