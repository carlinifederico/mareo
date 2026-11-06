// "Revisar" tab (v2 only): a control room for every process Claude Code is
// running across the user's projects, so they can tell at a glance which ones
// need them. One card per project (projects with something running first);
// inside, the running processes on top with their percentage, then the ones
// waiting for the user: a question, stopped halfway, or finished to review;
// then one-time scheduled tasks that have not started, with their start date.
// Processes the user ticked ("ya lo vi, me olvido") move to "Terminadas".
// A filter shows one kind at a time: En proceso, Revisar, Programadas, Terminadas.
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
let claude = null;      // workItems/claude-status: plan limits, extra usage
let loadedAt = 0;
let loading = false;
let loadError = '';
let filter = 'all';
const FILTERS = [['all', 'Todo'], ['progress', 'En proceso'], ['check', 'Revisar'], ['scheduled', 'Programadas'], ['done', 'Terminadas']];
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
    const docs = snap.docs.map(d => d.data());
    claude = docs.find(x => x.kind === 'claude-status') || null;
    // A forked session repeats its parent's history: one row per project + process, the latest
    const latest = new Map();
    for (const x of docs.filter(d => !d.kind && !d.auto && (d.updatedAt || 0) >= since)) {
      const key = `${x.projectId || x.projectName}|${String(x.process || x.title).toLowerCase()}`;
      const cur = latest.get(key);
      if (!cur || x.status === 'running' || (cur.status !== 'running' && (x.updatedAt || 0) > (cur.updatedAt || 0))) latest.set(key, x);
    }
    items = [...latest.values()];
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

  // Every process falls in one kind; the filter shows one kind or all but the done ones
  const kinds = { progress: [], check: [], scheduled: [], done: [] };
  for (const it of items) kinds[kindOf(it)]?.push(it);
  page.appendChild(claudePanel(kinds));
  const filters = el('div', 'v2-segmented rv-filters');
  filters.setAttribute('role', 'group');
  filters.setAttribute('aria-label', 'Filtrar');
  for (const [id, label] of FILTERS) {
    const n = id === 'all' ? items.length - kinds.done.length : kinds[id].length;
    const b = el('button', filter === id ? 'on' : '', `${label} ${n}`);
    b.type = 'button';
    b.setAttribute('aria-pressed', String(filter === id));
    b.addEventListener('click', () => { filter = id; rerender(); });
    filters.appendChild(b);
  }
  page.appendChild(filters);

  const shown = items.filter(it => filter === 'all' ? kindOf(it) !== 'done' : kindOf(it) === filter);

  // One card per project; projects with something in progress first
  const groups = new Map();
  for (const it of shown) {
    const key = it.projectId || it.projectName;
    if (!groups.has(key)) groups.set(key, { name: it.projectName, color: projectColor(it), list: [] });
    groups.get(key).list.push(it);
  }
  const ordered = [...groups.values()].map(g => ({
    ...g,
    running: g.list.some(x => kindOf(x) === 'progress'),
    last: Math.max(...g.list.map(x => x.scheduledFor || x.updatedAt || 0)),
  })).sort((a, b) => (b.running - a.running) || b.last - a.last);
  if (!ordered.length) page.appendChild(el('p', 'pp-muted rv-empty', 'Nada acá.'));
  for (const g of ordered) page.appendChild(projectCard(g));
  container.appendChild(page);
}

function untilText(ms) {
  const min = Math.max(0, Math.round((ms - Date.now()) / 60000));
  const d = Math.floor(min / 1440), h = Math.floor((min % 1440) / 60), m = min % 60;
  return d ? `${d} d ${h} h` : h ? `${h} h ${m} min` : `${m} min`;
}

// General view of Claude: plan limits with their reset, extra usage, and how
// many processes are in each state across every project.
function claudePanel(kinds) {
  const card = el('section', 'v2-card rv-claude');
  const head = el('div', 'rv-claude-head');
  head.appendChild(el('h2', 'rv-claude-title', 'Claude'));
  if (claude?.plan) head.appendChild(el('span', 'rv-status', `Plan ${claude.plan}`));
  card.appendChild(head);

  const grid = el('div', 'rv-claude-grid');
  const limits = el('div', 'rv-limits');
  const windows = [...(claude?.windows || [])];
  if (claude?.fiveHour != null) windows.unshift({ id: 'five', label: 'Últimas 5 horas', percentUsed: claude.fiveHour });
  if (!windows.length) limits.appendChild(el('p', 'pp-muted', 'Sin datos de uso todavía.'));
  for (const w of windows) {
    const pct = Math.min(100, Math.max(0, Math.round(w.percentUsed || 0)));
    const l = el('div', `rv-limit${pct >= 90 ? ' full' : pct >= 70 ? ' high' : ''}`);
    const top = el('div', 'rv-limit-top');
    top.append(el('span', null, w.label), el('b', null, `${pct}%`));
    l.appendChild(top);
    l.appendChild(progressBar(pct, pct >= 90 ? '#E9705C' : pct >= 70 ? '#E9A15C' : '#8FCB86'));
    if (w.resetsAt) {
      const d = new Date(w.resetsAt);
      l.appendChild(el('span', 'rv-limit-reset', `Se reinicia ${WEEKDAYS[d.getDay()]} ${d.getDate()}/${d.getMonth() + 1} ${d.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })} · en ${untilText(w.resetsAt)}`));
    }
    limits.appendChild(l);
  }
  const ex = claude?.extraUsage;
  if (ex && ex.enabled) {
    const x = el('div', 'rv-extra');
    x.append(el('span', null, 'Uso extra activo'), el('b', null, `${ex.currency || 'USD'} ${Number(ex.spent || 0).toFixed(2)}`));
    if (claude.planTakenAt) x.appendChild(el('span', 'rv-limit-reset', `gastado · dato ${ago(claude.planTakenAt)}`));
    limits.appendChild(x);
  }
  grid.appendChild(limits);

  const counts = el('div', 'rv-counts');
  const working = kinds.progress.filter(x => x.status === 'running').length;
  for (const [n, label, cls] of [
    [working, 'trabajando ahora', 'running'],
    [kinds.progress.length - working, 'en curso', 'progress'],
    [kinds.check.length, 'para revisar', 'check'],
    [kinds.scheduled.length, 'programadas', 'scheduled'],
  ]) {
    const c = el('div', `rv-count ${cls}`);
    c.append(el('b', null, String(n)), el('span', null, label));
    counts.appendChild(c);
  }
  grid.appendChild(counts);
  card.appendChild(grid);
  return card;
}

// progress: in course · check: finished, asked or stopped, waiting for the user
// scheduled: a one-time scheduled task that has not started · done: ticked by the user
function kindOf(it) {
  if (it.status === 'scheduled') return (it.scheduledFor || 0) > Date.now() ? 'scheduled' : null;
  if (isSleeping(it)) return 'done';
  return inCourse(it) ? 'progress' : 'check';
}

// A project: in progress on top with its percentage, then what waits for the
// user, then what is scheduled to start (and, under Terminadas, what is done).
function projectCard(g) {
  const sec = el('section', `v2-card rv-project${g.running ? ' live' : ''}`);
  sec.style.setProperty('--proj', g.color);
  const head = el('h2', 'rv-project-name');
  head.append(el('span', 'rv-dot'), g.name);
  if (g.running) head.appendChild(el('span', 'rv-status running', 'En curso'));
  sec.appendChild(head);
  const of = (k) => g.list.filter(x => kindOf(x) === k);
  const progress = of('progress').sort((a, b) => b.updatedAt - a.updatedAt);
  const check = of('check').sort((a, b) => (NEEDS[a.status]?.rank ?? 9) - (NEEDS[b.status]?.rank ?? 9) || b.updatedAt - a.updatedAt);
  const scheduled = of('scheduled').sort((a, b) => a.scheduledFor - b.scheduledFor);
  const done = of('done').sort((a, b) => b.updatedAt - a.updatedAt);
  if (progress.length) sec.appendChild(part('En progreso', 'progress', progress, 'working'));
  if (check.length) sec.appendChild(part('Terminadas · para chequear', 'check', check, 'needs'));
  if (scheduled.length) sec.appendChild(part('Programadas', 'scheduled', scheduled, 'scheduled'));
  if (done.length) sec.appendChild(part('Terminadas', 'done', done, 'sleeping'));
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

function inTime(ms) {
  const h = Math.round((ms - Date.now()) / 3600000);
  if (h < 1) return 'en minutos';
  if (h < 24) return `en ${h} h`;
  const d = Math.round(h / 24);
  return d === 1 ? 'en 1 día' : `en ${d} días`;
}

const WEEKDAYS = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'];
function whenScheduled(ms) {
  const d = new Date(ms);
  const days = Math.round((new Date(d).setHours(0, 0, 0, 0) - new Date().setHours(0, 0, 0, 0)) / 86400000);
  const hm = d.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' });
  const day = days === 0 ? 'hoy' : days === 1 ? 'mañana' : `${WEEKDAYS[d.getDay()]} ${d.getDate()}/${d.getMonth() + 1}`;
  return `${day} · ${hm}`;
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
  // Nothing to tick on work that has not started yet
  if (kind === 'scheduled') box.style.visibility = 'hidden';
  r.appendChild(box);

  const name = el('div', 'rv-name');
  const proj = el('span', 'rv-proj');
  proj.append(el('span', 'rv-dot'), it.projectName);
  name.append(proj, el('b', 'rv-proc', it.process || it.title));
  r.appendChild(name);

  // What it is about right now: the question, the step being worked on, or the status
  const hint = kind === 'working' ? (currentStep(it) || it.lastPrompt || 'Trabajando')
    : kind === 'scheduled' ? (it.recap || '')
    : it.status === 'decide' && it.ask ? it.ask
    : (NEEDS[it.status]?.label || '');
  const info = el('div', 'rv-info');
  if (kind === 'working') info.appendChild(el('span', 'rv-status running', it.status === 'running' ? 'Trabajando' : 'En curso'));
  else if (kind === 'scheduled') info.appendChild(el('span', 'rv-status scheduled', `Empieza ${whenScheduled(it.scheduledFor)}`));
  else if (!sleeping && NEEDS[it.status]) info.appendChild(el('span', `rv-status ${it.status}`, NEEDS[it.status].label));
  if (hint && hint !== NEEDS[it.status]?.label && hint !== 'Trabajando') info.appendChild(el('span', 'rv-hint', hint));
  r.appendChild(info);

  const pct = pctOf(it);
  const prog = el('div', 'rv-prog');
  // Only work in progress gets a bar; a finished one at 100% would read as progress too
  if (kind === 'working' && pct != null) prog.append(progressBar(pct, color), el('span', 'rv-pct', `${pct}%`));
  r.appendChild(prog);
  r.appendChild(el('span', 'rv-when', kind === 'scheduled' ? inTime(it.scheduledFor) : ago(it.updatedAt)));

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
