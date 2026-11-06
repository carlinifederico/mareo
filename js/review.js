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
  decide:  { label: 'Te pregunta', rank: 0 },
  review:  { label: 'Listo',       rank: 1 },
  running: { label: 'En curso',    rank: 2 },
  paused:  { label: 'En cola',     rank: 3 },
};

let items = null;       // null = not loaded yet
let loadedAt = 0;
let loading = false;
let loadError = '';
let filter = 'open';    // 'open' = not reviewed yet, 'all'
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

function stepCounts(list) {
  let done = 0, total = 0;
  for (const it of list) for (const s of it.steps || []) { total++; if (s.status === 'completed') done++; }
  return { done, total, pct: total ? Math.round((done / total) * 100) : 0 };
}

function barRow(cls, { done, total, pct }, color) {
  const row = el('div', cls);
  row.append(progressBar(pct, color), el('span', 'rv-pct', `${done}/${total}`));
  return row;
}

export function renderReview(container) {
  container.innerHTML = '';
  if (items === null) load();
  if (!timer) timer = setInterval(() => { if (document.getElementById('view-review')?.classList.contains('active')) load(); }, REFRESH_MS);

  const page = el('div', 'v2-page rv-page');
  const head = el('header', 'rv-head');
  head.appendChild(el('h1', 'rv-title', 'Revisar'));
  const tools = el('div', 'rv-tools');
  const seg = el('div', 'v2-segmented');
  seg.setAttribute('role', 'group');
  for (const [id, label] of [['open', 'Pendiente'], ['all', 'Todo']]) {
    const b = el('button', filter === id ? 'on' : '', label);
    b.type = 'button';
    b.setAttribute('aria-pressed', String(filter === id));
    b.addEventListener('click', () => { filter = id; rerender(); });
    seg.appendChild(b);
  }
  const refresh = el('button', 'pp-btn-outline', loading ? '…' : 'Actualizar');
  refresh.type = 'button';
  refresh.disabled = loading;
  refresh.title = `Leído ${ago(loadedAt)}`;
  refresh.addEventListener('click', () => load());
  tools.append(seg, refresh);
  head.appendChild(tools);
  page.appendChild(head);

  if (items === null) {
    page.appendChild(el('p', 'pp-muted', 'Cargando…'));
    container.appendChild(page);
    return;
  }
  if (loadError) page.appendChild(el('p', 'rv-error', `No pude leer las sesiones (${loadError}).`));

  // Everything queued in the last days, across projects
  const human = items.filter(x => !x.auto);
  const all = stepCounts(human);
  const total = el('section', 'v2-card rv-total');
  const tHead = el('div', 'rv-total-head');
  tHead.append(el('b', null, 'Todas las tareas'), el('span', 'rv-total-pct', `${all.pct}%`));
  total.append(tHead, barRow('rv-total-bar', all));
  const chips = el('div', 'rv-chips');
  for (const st of ['decide', 'running', 'paused', 'review']) {
    const n = human.filter(x => x.status === st && !(st === 'review' && isReviewed(x))).length;
    if (n) chips.appendChild(el('span', `rv-status ${st}`, `${n} ${STATUS[st].label.toLowerCase()}`));
  }
  total.appendChild(chips);
  page.appendChild(total);

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
    const visible = filter === 'open' ? sessions.filter(x => x.status === 'running' || !isReviewed(x)) : sessions;
    if (!visible.length) continue;
    shown++;
    page.appendChild(renderGroup(g, sessions, visible, g.list.filter(x => x.auto)));
  }
  if (!shown) page.appendChild(el('p', 'rv-empty', 'Nada pendiente.'));
  container.appendChild(page);
}

function renderGroup(g, sessions, visible, autos) {
  const sec = el('section', 'v2-card rv-group');
  sec.style.setProperty('--proj', g.color);
  const head = el('div', 'rv-group-head');
  const name = el('h2', 'v2-card-title rv-group-name');
  name.append(el('span', 'rv-dot'), g.name);
  head.appendChild(name);
  const c = stepCounts(sessions);
  if (c.total) head.appendChild(barRow('rv-group-progress', c, g.color));
  sec.appendChild(head);

  const list = el('div', 'rv-list');
  for (const it of visible) list.appendChild(renderSession(it, g.color));
  sec.appendChild(list);

  if (autos.length) {
    const last = autos.reduce((a, b) => (b.updatedAt > a.updatedAt ? b : a));
    sec.appendChild(el('p', 'pp-muted rv-autos', `${autos.length} automáticas · última ${ago(last.updatedAt)}`));
  }
  return sec;
}

function renderSession(it, color) {
  const reviewed = isReviewed(it) && it.status !== 'running';
  const card = el('article', `rv-item ${it.status}${reviewed ? ' reviewed' : ''}`);
  if (it.recap) card.title = it.recap;
  const top = el('div', 'rv-item-top');
  top.appendChild(el('span', `rv-status ${it.status}`, STATUS[it.status]?.label || it.status));
  top.appendChild(el('span', 'rv-when', ago(it.updatedAt)));
  card.appendChild(top);
  card.appendChild(el('h3', 'rv-item-title', it.title || 'Sesión'));

  const steps = it.steps || [];
  if (steps.length) {
    card.appendChild(barRow('rv-item-progress', stepCounts([it]), color));
    const ol = el('ol', 'rv-steps');
    for (const s of steps) {
      const li = el('li', `rv-step ${s.status}`);
      li.append(el('span', 'rv-step-mark', s.status === 'completed' ? '✓' : s.status === 'in_progress' ? '●' : '○'), el('span', null, s.label));
      ol.appendChild(li);
    }
    card.appendChild(ol);
  }
  if (it.ask && it.status === 'decide') card.appendChild(el('p', 'rv-ask', it.ask));

  if (it.status !== 'running') {
    const b = el('button', 'rv-mark', reviewed ? '↺' : '✓ Visto');
    b.type = 'button';
    b.title = reviewed ? 'Volver a pendiente' : 'Marcar como revisado';
    b.addEventListener('click', () => markReviewed(it, !reviewed));
    top.appendChild(b);
  }
  return card;
}
