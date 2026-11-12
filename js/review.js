// "Revisar" tab (v2 only): what is in progress right now, by project.
// One card per project, with its big processes ("Site", "Pitch") as rows.
// Only live work shows: a process Claude is working on, or one touched in the
// last day. What nobody touched for a day clears itself, and a process the
// user ticks ("listo") hides until they ask that session something new (its
// userTurns grows). Upcoming one-time scheduled tasks show as a small line.
// Data comes from workItems/{sessionId}, written by tools/mareo-work.mjs from
// the local session transcripts. Tick marks live in
// mareo_v2/{uid}.hibernated as { sessionId: userTurns at the time }.

import { Store } from './store.js';
import { Meta } from './meta-repo.js';
import { identityFor } from './identity.js';
import { db, collection, query, where, getDocs } from './firebase-config.js';

const DAYS = 7;
const LIVE_MS = 24 * 60 * 60 * 1000; // untouched longer than this: it clears itself
const REFRESH_MS = 2 * 60 * 1000;

let items = null;       // null = not loaded yet
let claude = null;      // workItems/claude-status: plan limits, extra usage
let loadedAt = 0;
let loading = false;
let loadError = '';
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
    for (const x of docs.filter(d => !d.kind && !d.auto && ((d.updatedAt || 0) >= since || d.status === 'scheduled'))) {
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

function sleepMap() {
  return Meta.user().hibernated || {};
}

function isTicked(it) {
  const mark = sleepMap()[it.sessionId];
  return mark != null && (it.userTurns || 0) <= mark;
}

function tick(it) {
  Meta.updateUser({ hibernated: { ...sleepMap(), [it.sessionId]: it.userTurns || 0 } });
  rerender();
}

// working: Claude is on it now · asks: it asked the user something
// waiting: touched in the last day, Claude's turn is over · scheduled: starts later
// null: finished long ago, ticked, or a scheduled task that already fired
function kindOf(it) {
  if (it.status === 'scheduled') return (it.scheduledFor || 0) > Date.now() ? 'scheduled' : null;
  if (isTicked(it)) return null;
  if (it.status === 'running') return 'working';
  if (Date.now() - (it.updatedAt || 0) > LIVE_MS) return null;
  return it.status === 'decide' ? 'asks' : 'waiting';
}

const KIND = {
  working: { label: 'Trabajando', rank: 0 },
  asks: { label: 'Te pregunta', rank: 1 },
  waiting: { label: 'Esperándote', rank: 2 },
};

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
  const titles = el('div');
  titles.append(el('h1', 'rv-title', 'En curso'), el('p', 'pp-muted rv-sub', 'Lo que se está haciendo ahora, por proyecto. Lo que nadie toca en un día se limpia solo.'));
  head.appendChild(titles);
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

  const live = items.map(it => ({ it, kind: kindOf(it) })).filter(x => x.kind);
  page.appendChild(claudePanel(live));

  // One card per project; the one with something working now first, then the most recent
  const groups = new Map();
  for (const x of live) {
    const key = x.it.projectId || x.it.projectName;
    if (!groups.has(key)) groups.set(key, { name: x.it.projectName, color: projectColor(x.it), list: [] });
    groups.get(key).list.push(x);
  }
  const ordered = [...groups.values()]
    .filter(g => g.list.some(x => x.kind !== 'scheduled'))
    .map(g => ({
      ...g,
      working: g.list.some(x => x.kind === 'working'),
      last: Math.max(...g.list.map(x => x.it.updatedAt || 0)),
    }))
    .sort((a, b) => (b.working - a.working) || b.last - a.last);
  if (!ordered.length) page.appendChild(el('p', 'pp-muted rv-empty', 'No hay nada en curso.'));
  const grid = el('div', 'rv-grid');
  for (const g of ordered) grid.appendChild(projectCard(g));
  page.appendChild(grid);

  // Scheduled tasks of projects with nothing live: one line at the bottom
  const later = live.filter(x => x.kind === 'scheduled' && !ordered.some(g => g.list.includes(x)))
    .sort((a, b) => a.it.scheduledFor - b.it.scheduledFor);
  if (later.length) {
    const box = el('div', 'rv-later');
    box.appendChild(el('span', 'rv-later-title', 'Programado'));
    for (const { it } of later) box.appendChild(el('span', 'rv-later-item', `${it.projectName} · ${it.process} · ${whenScheduled(it.scheduledFor)}`));
    page.appendChild(box);
  }
  container.appendChild(page);
}

function untilText(ms) {
  const min = Math.max(0, Math.round((ms - Date.now()) / 60000));
  const d = Math.floor(min / 1440), h = Math.floor((min % 1440) / 60), m = min % 60;
  return d ? `${d} d ${h} h` : h ? `${h} h ${m} min` : `${m} min`;
}

// Claude's plan limits with their reset, extra usage, and live counts.
function claudePanel(live) {
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
  const n = (k) => live.filter(x => x.kind === k).length;
  for (const [v, label, cls] of [
    [n('working'), 'trabajando ahora', 'running'],
    [n('asks'), 'te preguntan', 'decide'],
    [n('waiting'), 'esperándote', 'check'],
    [new Set(live.filter(x => x.kind !== 'scheduled').map(x => x.it.projectId || x.it.projectName)).size, 'proyectos activos', 'progress'],
  ]) {
    const c = el('div', `rv-count ${cls}`);
    c.append(el('b', null, String(v)), el('span', null, label));
    counts.appendChild(c);
  }
  grid.appendChild(counts);
  card.appendChild(grid);
  return card;
}

// A project: its processes, working ones first, then the ones that ask, then
// the rest by recency; its upcoming scheduled tasks as a small line.
function projectCard(g) {
  const sec = el('section', `v2-card rv-project${g.working ? ' live' : ''}`);
  sec.style.setProperty('--proj', g.color);
  const procs = g.list.filter(x => x.kind !== 'scheduled')
    .sort((a, b) => KIND[a.kind].rank - KIND[b.kind].rank || (b.it.updatedAt || 0) - (a.it.updatedAt || 0));
  const head = el('h2', 'rv-project-name');
  head.append(el('span', 'rv-dot'), g.name, el('span', 'rv-part-n', String(procs.length)));
  if (g.working) head.appendChild(el('span', 'rv-status running', 'Trabajando'));
  sec.appendChild(head);
  for (const x of procs) sec.appendChild(row(x.it, x.kind));
  const sched = g.list.filter(x => x.kind === 'scheduled').sort((a, b) => a.it.scheduledFor - b.it.scheduledFor);
  for (const { it } of sched) sec.appendChild(el('div', 'rv-sched-line', `Programado · ${it.process} · ${whenScheduled(it.scheduledFor)}`));
  return sec;
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
  const wrap = el('div', 'rv-row-wrap');
  const r = el('div', `rv-row rv-${kind}${kind === 'working' ? ' live' : ''}`);
  r.style.setProperty('--proj', color);

  const name = el('div', 'rv-name');
  name.appendChild(el('b', 'rv-proc', it.process || it.title));
  // What it is about right now: the question, or the step being worked on
  const hint = kind === 'asks' && it.ask ? it.ask
    : currentStep(it) || (kind === 'working' ? it.lastPrompt : '') || '';
  if (hint) name.appendChild(el('span', 'rv-hint', hint));
  r.appendChild(name);

  const side = el('div', 'rv-side');
  side.appendChild(el('span', `rv-status ${kind === 'working' ? 'running' : kind === 'asks' ? 'decide' : 'review'}`, KIND[kind].label));
  const pct = pctOf(it);
  if (pct != null && pct < 100) {
    const prog = el('div', 'rv-prog');
    prog.append(progressBar(pct, color), el('span', 'rv-pct', `${pct}%`));
    side.appendChild(prog);
  }
  side.appendChild(el('span', 'rv-when', ago(it.updatedAt)));
  r.appendChild(side);

  const actions = el('div', 'rv-actions');
  const steps = it.steps || [];
  if (steps.length) {
    const more = el('button', 'rv-more', open.has(it.sessionId) ? '▾' : '▸');
    more.type = 'button';
    more.title = 'Ver pasos';
    more.setAttribute('aria-expanded', String(open.has(it.sessionId)));
    more.addEventListener('click', () => {
      if (open.has(it.sessionId)) open.delete(it.sessionId); else open.add(it.sessionId);
      rerender();
    });
    actions.appendChild(more);
  }
  if (kind !== 'working') {
    const done = el('button', 'rv-done', '✓');
    done.type = 'button';
    done.title = 'Listo: sacarlo de acá hasta que le pida algo nuevo';
    done.setAttribute('aria-label', `Listo: ${it.projectName} · ${it.process || it.title}`);
    done.addEventListener('click', () => tick(it));
    actions.appendChild(done);
  }
  r.appendChild(actions);
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
