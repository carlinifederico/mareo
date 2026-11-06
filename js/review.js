// "Revisar" tab (v2 only): the processes Claude Code sessions are working on,
// per project, with their progress. Processes being worked on go on top;
// the rest (waiting for an answer, done, queued) go below to review.
// Data comes from workItems/{sessionId}, written by tools/mareo-work.mjs from
// the local session transcripts; `process` is the short name of what each
// session works on. "Visto" marks live in mareo_v2/{uid}.reviewed as
// { sessionId: updatedAt }, so a session that moves again shows up again.

import { Store } from './store.js';
import { Meta } from './meta-repo.js';
import { identityFor } from './identity.js';
import { db, collection, query, where, getDocs } from './firebase-config.js';

const DAYS = 7;
const REFRESH_MS = 2 * 60 * 1000;
// A queued session touched this recently still counts as in process
const ACTIVE_MS = 3 * 60 * 60 * 1000;
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
let showSeen = false;
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

function isActive(it) {
  return it.status === 'running' || (it.status === 'paused' && Date.now() - (it.updatedAt || 0) < ACTIVE_MS);
}

function pctOf(it) {
  const steps = it.steps || [];
  if (!steps.length) return null;
  return Math.round((steps.filter(s => s.status === 'completed').length / steps.length) * 100);
}

function currentStep(it) {
  const steps = it.steps || [];
  return (steps.find(s => s.status === 'in_progress') || steps.find(s => s.status === 'pending') || {}).label || '';
}

function byProject(list) {
  const groups = new Map();
  for (const it of list) {
    const key = it.projectId || it.projectName;
    if (!groups.has(key)) groups.set(key, { name: it.projectName, color: projectColor(it), list: [] });
    groups.get(key).list.push(it);
  }
  return [...groups.values()]
    .map(g => ({ ...g, last: Math.max(...g.list.map(x => x.updatedAt || 0)) }))
    .sort((a, b) => b.last - a.last);
}

function sectionTitle(text, n) {
  const h = el('h2', 'rv-section');
  h.append(text, el('span', 'rv-section-n', String(n)));
  return h;
}

export function renderReview(container) {
  container.innerHTML = '';
  if (items === null) load();
  if (!timer) timer = setInterval(() => { if (document.getElementById('view-review')?.classList.contains('active')) load(); }, REFRESH_MS);

  const page = el('div', 'v2-page rv-page');
  const head = el('header', 'rv-head');
  head.appendChild(el('h1', 'rv-title', 'Revisar'));
  const refresh = el('button', 'pp-btn-outline', loading ? '…' : 'Actualizar');
  refresh.type = 'button';
  refresh.disabled = loading;
  refresh.title = `Leído ${ago(loadedAt)}`;
  refresh.addEventListener('click', () => load());
  head.appendChild(refresh);
  page.appendChild(head);

  if (items === null) {
    page.appendChild(el('p', 'pp-muted', 'Cargando…'));
    container.appendChild(page);
    return;
  }
  if (loadError) page.appendChild(el('p', 'rv-error', `No pude leer las sesiones (${loadError}).`));

  const human = items.filter(x => !x.auto);
  const active = human.filter(isActive);
  const waiting = human.filter(x => !isActive(x));
  const unseen = waiting.filter(x => !isReviewed(x));

  // One bar for everything queued
  const all = stepCounts(human);
  const total = el('section', 'v2-card rv-total');
  const tHead = el('div', 'rv-total-head');
  tHead.append(el('b', null, 'Todo lo encolado'), el('span', 'rv-total-pct', `${all.pct}%`));
  total.append(tHead, barRow('rv-total-bar', all));
  page.appendChild(total);

  // In process: one big row per process
  page.appendChild(sectionTitle('En proceso', active.length));
  if (!active.length) page.appendChild(el('p', 'rv-empty', 'Nada en proceso ahora.'));
  for (const g of byProject(active)) {
    const sec = el('section', 'v2-card rv-group');
    sec.style.setProperty('--proj', g.color);
    const name = el('h3', 'rv-group-name');
    name.append(el('span', 'rv-dot'), g.name);
    sec.appendChild(name);
    for (const it of g.list.sort((a, b) => b.updatedAt - a.updatedAt)) sec.appendChild(renderActive(it, g.color));
    page.appendChild(sec);
  }

  // Waiting: compact rows to review
  const list = showSeen ? waiting : unseen;
  page.appendChild(sectionTitle('Esperando', unseen.length));
  if (!list.length) page.appendChild(el('p', 'rv-empty', 'Nada para revisar.'));
  for (const g of byProject(list)) {
    const sec = el('section', 'v2-card rv-group rv-waiting');
    sec.style.setProperty('--proj', g.color);
    const name = el('h3', 'rv-group-name');
    name.append(el('span', 'rv-dot'), g.name);
    sec.appendChild(name);
    const sorted = g.list.sort((a, b) => (STATUS[a.status]?.rank ?? 9) - (STATUS[b.status]?.rank ?? 9) || b.updatedAt - a.updatedAt);
    for (const it of sorted) sec.appendChild(renderWaiting(it, g.color));
    page.appendChild(sec);
  }
  const seen = waiting.length - unseen.length;
  if (seen) {
    const t = el('button', 'rv-mark rv-seen-toggle', showSeen ? 'Ocultar vistos' : `Ver vistos (${seen})`);
    t.type = 'button';
    t.addEventListener('click', () => { showSeen = !showSeen; rerender(); });
    page.appendChild(t);
  }
  container.appendChild(page);
}

function renderActive(it, color) {
  const row = el('article', `rv-proc ${it.status}`);
  if (it.recap) row.title = it.recap;
  const top = el('div', 'rv-proc-top');
  top.appendChild(el('h4', 'rv-proc-name', it.process || it.title));
  const pct = pctOf(it);
  top.appendChild(el('span', 'rv-proc-pct', pct == null ? '' : `${pct}%`));
  row.appendChild(top);
  if (pct != null) row.appendChild(progressBar(pct, color));
  const now = currentStep(it);
  const meta = el('div', 'rv-proc-meta');
  meta.append(el('span', `rv-status ${it.status}`, STATUS[it.status]?.label || ''), el('span', 'rv-proc-now', now || it.title));
  row.appendChild(meta);

  const steps = it.steps || [];
  if (steps.length) {
    const det = el('details', 'rv-proc-steps');
    det.appendChild(el('summary', null, `${steps.filter(s => s.status === 'completed').length}/${steps.length} pasos`));
    const ol = el('ol', 'rv-steps');
    for (const s of steps) {
      const li = el('li', `rv-step ${s.status}`);
      li.append(el('span', 'rv-step-mark', s.status === 'completed' ? '✓' : s.status === 'in_progress' ? '●' : '○'), el('span', null, s.label));
      ol.appendChild(li);
    }
    det.appendChild(ol);
    row.appendChild(det);
  }
  return row;
}

function renderWaiting(it, color) {
  const reviewed = isReviewed(it);
  const row = el('div', `rv-wait ${it.status}${reviewed ? ' reviewed' : ''}`);
  row.title = it.ask || it.recap || it.title;
  row.appendChild(el('span', `rv-status ${it.status}`, STATUS[it.status]?.label || ''));
  const text = el('div', 'rv-wait-text');
  text.appendChild(el('b', null, it.process || it.title));
  if (it.status === 'decide' && it.ask) text.appendChild(el('span', 'rv-wait-ask', it.ask));
  row.appendChild(text);
  const pct = pctOf(it);
  const bar = el('div', 'rv-wait-bar');
  if (pct != null) bar.append(progressBar(pct, color), el('span', 'rv-pct', `${pct}%`));
  row.appendChild(bar);
  row.appendChild(el('span', 'rv-when', ago(it.updatedAt)));
  const b = el('button', 'rv-mark', reviewed ? '↺' : '✓ Visto');
  b.type = 'button';
  b.title = reviewed ? 'Volver a pendiente' : 'Marcar como revisado';
  b.addEventListener('click', () => markReviewed(it, !reviewed));
  row.appendChild(b);
  return row;
}
