// "Revisar" tab (v2 only): a control room for every process Claude Code is
// running across the user's projects, so they can tell at a glance which ones
// need them. One card per project (projects with something running first);
// inside, the running processes on top with their percentage, then the ones
// waiting for the user: a question, stopped halfway, or finished to review.
// Processes the user ticked ("ya lo vi, me olvido") fold into "Dormidas".
// A ticked process sleeps until the user asks that session something new
// (its userTurns grows), whatever Claude keeps doing on its own.
// Data comes from workItems/{sessionId}, written by tools/mareo-work.mjs from
// the local session transcripts. Sleep marks live in
// mareo_v2/{uid}.hibernated as { sessionId: userTurns at the time }.

import { Store } from './store.js';
import { Meta } from './meta-repo.js';
import { identityFor } from './identity.js';
import { db, collection, query, where, getDocs } from './firebase-config.js';

const DAYS = 7;
const REFRESH_MS = 2 * 60 * 1000;
const NEEDS = {
  decide: { label: 'Te pregunta',      rank: 0 },
  paused: { label: 'Se frenó',         rank: 1 },
  review: { label: 'Terminó · revisá', rank: 2 },
};

let items = null;       // null = not loaded yet
let loadedAt = 0;
let loading = false;
let loadError = '';
let showSleeping = false;
const open = new Set(); // rows with their steps unfolded
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
    items = snap.docs.map(d => d.data()).filter(x => !x.auto && (x.updatedAt || 0) >= since);
    loadError = '';
  } catch (err) {
    loadError = err?.code || String(err);
    items = items || [];
  }
  loadedAt = Date.now();
  loading = false;
  rerender();
}

// In course: writing now, or halfway through its task list and touched today
// (between two messages a session sits idle, but the work is still going)
const IN_COURSE_MS = 24 * 60 * 60 * 1000;
function inCourse(it) {
  return it.status === 'running' || (it.status === 'paused' && Date.now() - (it.updatedAt || 0) < IN_COURSE_MS);
}

function sleepMap() {
  return Meta.user().hibernated || {};
}

function isSleeping(it) {
  const mark = sleepMap()[it.sessionId];
  return mark != null && (it.userTurns || 0) <= mark;
}

function setSleeping(it, on) {
  const hibernated = { ...sleepMap() };
  if (on) hibernated[it.sessionId] = it.userTurns || 0;
  else delete hibernated[it.sessionId];
  Meta.updateUser({ hibernated });
  rerender();
}

function projectColor(it) {
  const p = it.projectId && Store._findProject(it.projectId);
  return p ? identityFor(p).color : '#8A8D96';
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

function pctOf(it) {
  const steps = it.steps || [];
  if (!steps.length) return null;
  return Math.round((steps.filter(s => s.status === 'completed').length / steps.length) * 100);
}

function currentStep(it) {
  const steps = it.steps || [];
  return (steps.find(s => s.status === 'in_progress') || steps.find(s => s.status === 'pending') || {}).label || '';
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

  const awake = items.filter(x => !isSleeping(x));
  const sleeping = items.filter(isSleeping).sort((a, b) => b.updatedAt - a.updatedAt);

  // One card per project; projects with something running first
  const groups = new Map();
  for (const it of awake) {
    const key = it.projectId || it.projectName;
    if (!groups.has(key)) groups.set(key, { name: it.projectName, color: projectColor(it), list: [] });
    groups.get(key).list.push(it);
  }
  const ordered = [...groups.values()].map(g => ({
    ...g,
    running: g.list.some(inCourse),
    last: Math.max(...g.list.map(x => x.updatedAt || 0)),
  })).sort((a, b) => (b.running - a.running) || b.last - a.last);
  if (!ordered.length) page.appendChild(el('p', 'pp-muted rv-empty', 'Nada pendiente.'));
  for (const g of ordered) page.appendChild(projectCard(g));

  if (sleeping.length) {
    const t = el('button', 'rv-sleep-toggle', `${showSleeping ? '▾' : '▸'} Dormidas (${sleeping.length})`);
    t.type = 'button';
    t.setAttribute('aria-expanded', String(showSleeping));
    t.addEventListener('click', () => { showSleeping = !showSleeping; rerender(); });
    page.appendChild(t);
    if (showSleeping) page.appendChild(block(null, sleeping, '', 'sleeping'));
  }
  container.appendChild(page);
}

// A project: its running processes on top with their progress, then what
// waits for the user (question, stopped halfway, finished to review).
function projectCard(g) {
  const sec = el('section', `v2-card rv-project${g.running ? ' live' : ''}`);
  sec.style.setProperty('--proj', g.color);
  const head = el('h2', 'rv-project-name');
  head.append(el('span', 'rv-dot'), g.name);
  if (g.running) head.appendChild(el('span', 'rv-status running', 'En curso'));
  sec.appendChild(head);
  const running = g.list.filter(inCourse).sort((a, b) => b.updatedAt - a.updatedAt);
  const rest = g.list.filter(x => !inCourse(x))
    .sort((a, b) => (NEEDS[a.status]?.rank ?? 9) - (NEEDS[b.status]?.rank ?? 9) || b.updatedAt - a.updatedAt);
  if (running.length) sec.appendChild(part('En progreso', 'progress', running, 'working'));
  if (rest.length) sec.appendChild(part('Terminadas · para chequear', 'check', rest, 'needs'));
  return sec;
}

function part(title, cls, list, kind) {
  const box = el('div', `rv-part ${cls}`);
  const h = el('div', 'rv-part-title');
  h.append(title, el('span', 'rv-part-n', String(list.length)));
  box.appendChild(h);
  for (const it of list) box.appendChild(row(it, kind));
  return box;
}

function block(title, list, emptyText, kind) {
  const sec = el('section', `v2-card rv-block ${kind}`);
  if (title) {
    const h = el('h2', 'rv-block-title');
    h.append(title, el('span', 'rv-block-n', String(list.length)));
    sec.appendChild(h);
  }
  if (!list.length) sec.appendChild(el('p', 'pp-muted rv-empty', emptyText));
  for (const it of list) sec.appendChild(row(it, kind));
  return sec;
}

function row(it, kind) {
  const color = projectColor(it);
  const sleeping = kind === 'sleeping';
  const wrap = el('div', 'rv-row-wrap');
  const r = el('div', `rv-row ${it.status}${kind === 'working' ? ' live' : ''}`);
  r.style.setProperty('--proj', color);

  const box = document.createElement('input');
  box.type = 'checkbox';
  box.className = 'rv-check';
  box.checked = sleeping;
  box.title = sleeping ? 'Despertar' : 'Listo, ya lo vi: dormir hasta que le pida algo';
  box.setAttribute('aria-label', `${box.title}: ${it.projectName} · ${it.process || it.title}`);
  box.addEventListener('change', () => setSleeping(it, box.checked));
  r.appendChild(box);

  const name = el('div', 'rv-name');
  const proj = el('span', 'rv-proj');
  proj.append(el('span', 'rv-dot'), it.projectName);
  name.append(proj, el('b', 'rv-proc', it.process || it.title));
  r.appendChild(name);

  // What it is about right now: the question, the step being worked on, or the status
  const hint = kind === 'working' ? (currentStep(it) || 'Trabajando')
    : it.status === 'decide' && it.ask ? it.ask
    : (NEEDS[it.status]?.label || '');
  const info = el('div', 'rv-info');
  if (kind === 'working') info.appendChild(el('span', 'rv-status running', it.status === 'running' ? 'Trabajando' : 'En curso'));
  else if (!sleeping && NEEDS[it.status]) info.appendChild(el('span', `rv-status ${it.status}`, NEEDS[it.status].label));
  if (hint && hint !== NEEDS[it.status]?.label && hint !== 'Trabajando') info.appendChild(el('span', 'rv-hint', hint));
  r.appendChild(info);

  const pct = pctOf(it);
  const prog = el('div', 'rv-prog');
  // Only work in progress gets a bar; a finished one at 100% would read as progress too
  if (kind === 'working' && pct != null) prog.append(progressBar(pct, color), el('span', 'rv-pct', `${pct}%`));
  r.appendChild(prog);
  r.appendChild(el('span', 'rv-when', ago(it.updatedAt)));

  const steps = it.steps || [];
  const more = el('button', 'rv-more', open.has(it.sessionId) ? '▾' : '▸');
  more.type = 'button';
  more.disabled = !steps.length;
  more.title = steps.length ? 'Ver pasos' : 'Sin lista de pasos';
  more.setAttribute('aria-expanded', String(open.has(it.sessionId)));
  more.addEventListener('click', () => {
    if (open.has(it.sessionId)) open.delete(it.sessionId); else open.add(it.sessionId);
    rerender();
  });
  r.appendChild(more);
  wrap.appendChild(r);

  if (open.has(it.sessionId) && steps.length) {
    const ol = el('ol', 'rv-steps');
    for (const s of steps) {
      const li = el('li', `rv-step ${s.status}`);
      li.append(el('span', 'rv-step-mark', s.status === 'completed' ? '✓' : s.status === 'in_progress' ? '●' : '○'), el('span', null, s.label));
      ol.appendChild(li);
    }
    if (it.recap) ol.appendChild(el('li', 'rv-recap', it.recap));
    wrap.appendChild(ol);
  }
  return wrap;
}
