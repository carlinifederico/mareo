// Dedicación: how time splits across projects, per month.
//
// Two sources:
//  - Today Tasks blocks (Store.data.dayPlans): minutes per projectId. Blocks
//    of the same project that overlap on a day are merged, so nothing counts
//    twice. Untagged blocks go to "Sin proyecto".
//  - Google Calendar meetings: each timed event is assigned to a project by,
//    in order, a manual assignment (event id → series → exact title) stored in
//    mareo_v2/{uid}, then a name/alias match on the title. The rest is
//    "Sin asignar" and can be assigned with one click.
//
// Everything is recomputed on render, so the charts follow the blocks as
// they're edited. Calendar months are cached by gcal.js for 5 minutes.

import { Store } from './store.js';
import { GCal } from './gcal.js';
import { Meta } from './meta-repo.js';
import { identityFor, listProjects, normalizeText } from './identity.js';

export const NONE = '__none';       // block without project
export const UNASSIGNED = '__unassigned'; // meeting without project
export const IGNORED = '__ignore';   // meeting marked as "not a project"

const MONTHS = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
const MONTHS_SHORT = ['ENE', 'FEB', 'MAR', 'ABR', 'MAY', 'JUN', 'JUL', 'AGO', 'SEP', 'OCT', 'NOV', 'DIC'];

let viewMonth = monthKey(new Date());
let viewSource = 'all'; // 'all' | 'blocks' | 'meetings'
const meetingCache = new Map(); // ym → { at, events } | { needsAuth } | { error }
const pending = new Map();      // ym → promise

export function monthKey(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function shiftMonth(ym, delta) {
  const [y, m] = ym.split('-').map(Number);
  return monthKey(new Date(y, m - 1 + delta, 1));
}

function monthLabel(ym) {
  const [y, m] = ym.split('-').map(Number);
  return `${MONTHS[m - 1]} ${y}`;
}

export function fmtHours(min) {
  const h = min / 60;
  if (h >= 10) return `${Math.round(h)}h`;
  return `${+h.toFixed(1)}h`;
}

// ---- Blocks -------------------------------------------------------------

function unionMinutes(intervals) {
  intervals.sort((a, b) => a[0] - b[0]);
  let total = 0, curS = null, curE = null;
  for (const [s, e] of intervals) {
    if (curE == null || s > curE) {
      if (curE != null) total += curE - curS;
      curS = s; curE = e;
    } else if (e > curE) {
      curE = e;
    }
  }
  if (curE != null) total += curE - curS;
  return total;
}

// → Map(projectId | NONE → minutes) for a YYYY-MM month
export function blockMinutes(ym) {
  const out = new Map();
  const plans = Store.data.dayPlans || {};
  for (const key of Object.keys(plans)) {
    if (!key.startsWith(ym)) continue;
    const byProject = new Map();
    for (const it of Store.getDayPlan(key)) {
      const pid = it.projectId && Store._findProject(it.projectId) ? it.projectId : NONE;
      const s = it.start || 0, e = s + (it.duration || 0);
      if (e <= s) continue;
      if (!byProject.has(pid)) byProject.set(pid, []);
      byProject.get(pid).push([s, e]);
    }
    for (const [pid, ivs] of byProject) out.set(pid, (out.get(pid) || 0) + unionMinutes(ivs));
  }
  return out;
}

// ---- Meetings -----------------------------------------------------------

function matchTerms() {
  const terms = [];
  for (const { project } of listProjects({ includeArchived: true })) {
    const id = identityFor(project);
    const words = [project.name, ...id.aliases].map(normalizeText).filter(t => t.length >= 3);
    for (const t of words) terms.push({ term: t, projectId: project.id });
  }
  // Longest first so "opi and the quiet ones" wins over "opi"
  terms.sort((a, b) => b.term.length - a.term.length);
  return terms;
}

function escapeRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

// → { projectId, how: 'manual'|'auto'|null }
export function assignMeeting(ev, terms = matchTerms()) {
  const u = Meta.user();
  const manual = (u.eventAssignments || {})[ev.id]
    || (ev.recurringEventId && (u.seriesAssignments || {})[ev.recurringEventId])
    || (u.titleAssignments || {})[normalizeText(ev.title)];
  if (manual) return { projectId: manual, how: 'manual' };
  const title = normalizeText(ev.title);
  for (const { term, projectId } of terms) {
    if (new RegExp(`(^|[^a-z0-9])${escapeRe(term)}($|[^a-z0-9])`).test(title)) return { projectId, how: 'auto' };
  }
  return { projectId: UNASSIGNED, how: null };
}

// Manual assignment: remembered for the event, its series and its title.
export async function setMeetingProject(ev, projectId) {
  const u = Meta.user();
  const patch = {
    eventAssignments: { ...(u.eventAssignments || {}), [ev.id]: projectId },
    titleAssignments: { ...(u.titleAssignments || {}), [normalizeText(ev.title)]: projectId },
  };
  if (ev.recurringEventId) {
    patch.seriesAssignments = { ...(u.seriesAssignments || {}), [ev.recurringEventId]: projectId };
  }
  await Meta.updateUser(patch);
}

// Calendar events of a month: cached result now, fetch in the background,
// re-render when it lands.
function meetingsFor(ym) {
  const hit = meetingCache.get(ym);
  if (hit && (hit.events || hit.needsAuth || hit.error) && Date.now() - hit.at < 5 * 60 * 1000) return hit;
  if (!GCal.isConnected()) return { needsAuth: true };
  if (!pending.has(ym)) {
    const [y, m] = ym.split('-').map(Number);
    const p = GCal.getRange(new Date(y, m - 1, 1), new Date(y, m, 1))
      .then(res => {
        meetingCache.set(ym, { ...res, at: Date.now() });
        pending.delete(ym);
        document.dispatchEvent(new Event('mareo:render'));
      });
    pending.set(ym, p);
  }
  return hit || { loading: true };
}

// → { minutes: Map(pid → min), list: [{ev, projectId, how, minutes}], state }
export function meetingMinutes(ym) {
  const res = meetingsFor(ym);
  const out = { minutes: new Map(), list: [], state: res.needsAuth ? 'auth' : res.error ? 'error' : res.loading ? 'loading' : 'ok' };
  if (!res.events) return out;
  const terms = matchTerms();
  for (const ev of res.events) {
    if (ev.allDay || !ev.startMs) continue;
    const minutes = Math.round((ev.endMs - ev.startMs) / 60000);
    if (minutes <= 0 || minutes > 12 * 60) continue;
    const { projectId, how } = assignMeeting(ev, terms);
    out.list.push({ ev, projectId, how, minutes });
    if (projectId === IGNORED) continue;
    out.minutes.set(projectId, (out.minutes.get(projectId) || 0) + minutes);
  }
  return out;
}

// ---- Month summary ------------------------------------------------------

// → { rows:[{id,name,color,blocks,meetings,minutes,pct}], total, meetings }
// Only time assigned to a project counts: untagged blocks and unassigned
// meetings stay out of the rows and the total (meetings are still listed
// below the charts so they can be assigned).
export function monthSummary(ym, source = 'all') {
  const blocks = source === 'meetings' ? new Map() : blockMinutes(ym);
  const meetings = source === 'blocks' ? { minutes: new Map(), list: [], state: 'ok' } : meetingMinutes(ym);
  const ids = new Set([...blocks.keys(), ...meetings.minutes.keys()]);
  const rows = [];
  for (const id of ids) {
    const b = blocks.get(id) || 0;
    const m = meetings.minutes.get(id) || 0;
    if (id === NONE || id === UNASSIGNED) continue;
    const p = Store._findProject(id);
    if (!p) continue;
    const name = p.name;
    const color = identityFor(p).color;
    rows.push({ id, name, color, blocks: b, meetings: m, minutes: b + m });
  }
  rows.sort((a, b) => b.minutes - a.minutes);
  const total = rows.reduce((s, r) => s + r.minutes, 0);
  for (const r of rows) r.pct = total ? r.minutes / total : 0;
  return { rows, total, meetings };
}

// ---- Charts (hand-drawn canvas, same approach as balance.js) -------------

function setupCanvas(canvas, w, h) {
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(h * dpr);
  canvas.style.width = w + 'px';
  canvas.style.height = h + 'px';
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return ctx;
}

export function drawDonut(canvas, rows, size, { thickness = 0.26 } = {}) {
  const ctx = setupCanvas(canvas, size, size);
  const cx = size / 2, cy = size / 2, r = size / 2 - 2, inner = r * (1 - thickness * 2);
  const total = rows.reduce((s, x) => s + x.minutes, 0);
  ctx.clearRect(0, 0, size, size);
  if (!total) {
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.arc(cx, cy, inner, 0, Math.PI * 2, true);
    ctx.fillStyle = '#24262B';
    ctx.fill();
    return;
  }
  let a = -Math.PI / 2;
  const gap = rows.length > 1 ? 0.012 : 0;
  for (const row of rows) {
    if (!row.minutes) continue;
    const sweep = (row.minutes / total) * Math.PI * 2;
    ctx.beginPath();
    ctx.arc(cx, cy, r, a + gap, a + sweep - gap);
    ctx.arc(cx, cy, inner, a + sweep - gap, a + gap, true);
    ctx.closePath();
    ctx.fillStyle = row.color;
    ctx.fill();
    a += sweep;
  }
}

// 100% stacked bars, one per month
function drawStacked(canvas, months, width, height) {
  const ctx = setupCanvas(canvas, width, height);
  const labelH = 22, gap = 14;
  const n = months.length;
  const barW = Math.min(64, (width - gap * (n - 1)) / n);
  const totalW = barW * n + gap * (n - 1);
  const x0 = (width - totalW) / 2;
  const barH = height - labelH;
  ctx.clearRect(0, 0, width, height);
  ctx.font = '500 11px "JetBrains Mono", monospace';
  ctx.textAlign = 'center';
  months.forEach((m, i) => {
    const x = x0 + i * (barW + gap);
    const total = m.rows.reduce((s, r) => s + r.minutes, 0);
    if (!total) {
      ctx.fillStyle = '#1F2125';
      roundRect(ctx, x, 0, barW, barH, 8);
      ctx.fill();
    } else {
      ctx.save();
      roundRect(ctx, x, 0, barW, barH, 8);
      ctx.clip();
      let y = barH;
      for (const r of m.rows) {
        const h = (r.minutes / total) * barH;
        ctx.fillStyle = r.color;
        ctx.fillRect(x, y - h, barW, Math.max(h - 1, 0));
        y -= h;
      }
      ctx.restore();
    }
    ctx.fillStyle = m.current ? '#ECECEE' : '#A3A5AD';
    ctx.fillText(m.label, x + barW / 2, height - 6);
  });
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

// ---- Views --------------------------------------------------------------

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}

function rerender() {
  document.dispatchEvent(new Event('mareo:render'));
}

function calendarNotice(state) {
  if (state === 'ok') return null;
  const box = el('div', 'dd-notice');
  if (state === 'loading') {
    box.textContent = 'Cargando reuniones del Calendar…';
    return box;
  }
  if (state === 'error') {
    box.textContent = 'No se pudo leer Google Calendar. Las reuniones no están incluidas.';
    return box;
  }
  box.appendChild(el('span', null, GCal.isExpired()
    ? 'La conexión con Google Calendar venció. Reconectá para sumar las reuniones.'
    : 'Conectá Google Calendar para sumar las reuniones de cada proyecto.'));
  const btn = el('button', 'v2-btn v2-btn-primary', GCal.isExpired() ? 'Reconectar' : 'Conectar Calendar');
  btn.type = 'button';
  btn.addEventListener('click', async () => {
    btn.disabled = true;
    try { await GCal.connect(); meetingCache.clear(); } catch (err) { console.warn('Calendar connect failed', err); }
    btn.disabled = false;
    rerender();
  });
  box.appendChild(btn);
  return box;
}

// Full Dedicación view (inside the Today Tasks tab)
export function renderDedication(container) {
  const wrap = el('div', 'dd');

  // Header: month nav + source switch
  const head = el('div', 'dd-head');
  const nav = el('div', 'dd-monthnav');
  const prev = el('button', 'v2-icon-btn', '‹');
  prev.type = 'button';
  prev.setAttribute('aria-label', 'Mes anterior');
  prev.addEventListener('click', () => { viewMonth = shiftMonth(viewMonth, -1); rerender(); });
  const next = el('button', 'v2-icon-btn', '›');
  next.type = 'button';
  next.setAttribute('aria-label', 'Mes siguiente');
  next.addEventListener('click', () => { viewMonth = shiftMonth(viewMonth, 1); rerender(); });
  nav.append(prev, el('h2', 'dd-month', monthLabel(viewMonth)), next);
  if (viewMonth !== monthKey(new Date())) {
    const now = el('button', 'v2-btn', 'Este mes');
    now.type = 'button';
    now.addEventListener('click', () => { viewMonth = monthKey(new Date()); rerender(); });
    nav.appendChild(now);
  }
  head.appendChild(nav);
  head.appendChild(segmented([
    ['all', 'Todo'], ['blocks', 'Bloques'], ['meetings', 'Reuniones'],
  ], viewSource, (v) => { viewSource = v; rerender(); }));
  wrap.appendChild(head);

  const sum = monthSummary(viewMonth, viewSource);
  const notice = viewSource !== 'blocks' ? calendarNotice(sum.meetings.state) : null;
  if (notice) wrap.appendChild(notice);

  const grid = el('div', 'dd-grid');

  // Donut + legend table
  const card = el('section', 'v2-card dd-main');
  const donutWrap = el('div', 'dd-donut');
  const canvas = document.createElement('canvas');
  canvas.setAttribute('role', 'img');
  canvas.setAttribute('aria-label', `Dedicación de ${monthLabel(viewMonth)} por proyecto`);
  donutWrap.appendChild(canvas);
  const center = el('div', 'dd-donut-center');
  center.append(el('strong', null, fmtHours(sum.total)), el('span', null, 'en proyectos'));
  donutWrap.appendChild(center);
  card.appendChild(donutWrap);
  requestAnimationFrame(() => drawDonut(canvas, sum.rows, 220));

  const table = el('div', 'dd-table');
  const th = el('div', 'dd-row dd-row-head');
  th.append(el('span', null, 'Proyecto'), el('span', 'num', 'Bloques'), el('span', 'num', 'Reuniones'), el('span', 'num', '%'));
  table.appendChild(th);
  if (!sum.rows.length) {
    table.appendChild(el('div', 'dd-empty', 'Todavía no hay bloques ni reuniones en este mes. Cargá en qué estuviste en la Agenda y se suma acá.'));
  }
  for (const r of sum.rows) {
    const row = el('div', 'dd-row');
    const name = el('span', 'dd-name');
    const sw = el('span', 'dd-swatch');
    sw.style.background = r.color;
    name.append(sw, el('span', null, r.name));
    const pct = el('span', 'num dd-pct');
    const bar = el('span', 'dd-pct-bar');
    bar.style.setProperty('--w', `${Math.round(r.pct * 100)}%`);
    bar.style.setProperty('--c', r.color);
    pct.append(bar, el('span', null, `${Math.round(r.pct * 100)}%`));
    row.append(name, el('span', 'num', r.blocks ? fmtHours(r.blocks) : '—'), el('span', 'num', r.meetings ? fmtHours(r.meetings) : '—'), pct);
    table.appendChild(row);
  }
  card.appendChild(table);
  grid.appendChild(card);

  // Last 6 months
  const trend = el('section', 'v2-card dd-trend');
  trend.appendChild(el('h3', 'v2-card-title', 'Últimos 6 meses'));
  const tcanvas = document.createElement('canvas');
  tcanvas.setAttribute('role', 'img');
  tcanvas.setAttribute('aria-label', 'Reparto por proyecto en los últimos 6 meses');
  trend.appendChild(tcanvas);
  const months = [];
  for (let i = 5; i >= 0; i--) {
    const ym = shiftMonth(viewMonth, -i);
    const s = monthSummary(ym, viewSource);
    months.push({ label: MONTHS_SHORT[Number(ym.slice(5)) - 1], rows: s.rows, current: ym === viewMonth });
  }
  requestAnimationFrame(() => {
    const w = Math.max(260, trend.clientWidth - 40);
    drawStacked(tcanvas, months, w, 220);
  });
  // Legend: projects present across the 6 months
  const legend = el('div', 'dd-legend');
  const seen = new Map();
  for (const m of months) for (const r of m.rows) if (!seen.has(r.id)) seen.set(r.id, r);
  for (const r of seen.values()) {
    const it = el('span', 'dd-legend-item');
    const sw = el('span', 'dd-swatch');
    sw.style.background = r.color;
    it.append(sw, el('span', null, r.name));
    legend.appendChild(it);
  }
  trend.appendChild(legend);
  grid.appendChild(trend);
  wrap.appendChild(grid);

  // Meetings list: unassigned first, then the rest (correctable)
  if (viewSource !== 'blocks' && sum.meetings.list.length) {
    wrap.appendChild(renderMeetingList(sum.meetings.list));
  }

  container.appendChild(wrap);
}

function segmented(options, value, onPick) {
  const g = el('div', 'v2-segmented');
  g.setAttribute('role', 'group');
  for (const [v, label] of options) {
    const b = el('button', v === value ? 'on' : '', label);
    b.type = 'button';
    b.setAttribute('aria-pressed', String(v === value));
    b.addEventListener('click', () => onPick(v));
    g.appendChild(b);
  }
  return g;
}

let showAllMeetings = false;

function renderMeetingList(list) {
  const sec = el('section', 'v2-card dd-meetings');
  const unassigned = list.filter(m => m.projectId === UNASSIGNED);
  const head = el('div', 'dd-meetings-head');
  head.appendChild(el('h3', 'v2-card-title', unassigned.length
    ? `Reuniones sin asignar · ${unassigned.length}`
    : 'Reuniones del mes'));
  const toggle = el('button', 'v2-btn', showAllMeetings ? 'Ver solo sin asignar' : `Ver todas (${list.length})`);
  toggle.type = 'button';
  toggle.addEventListener('click', () => { showAllMeetings = !showAllMeetings; rerender(); });
  head.appendChild(toggle);
  sec.appendChild(head);
  if (!unassigned.length && !showAllMeetings) {
    sec.appendChild(el('p', 'dd-empty', 'Todas las reuniones de este mes están asignadas a un proyecto.'));
    return sec;
  }

  const projects = listProjects({ includeArchived: true }).map(x => x.project);
  const rows = showAllMeetings ? list : unassigned;
  const ul = el('div', 'dd-meeting-list');
  for (const m of rows) {
    const row = el('div', 'dd-meeting');
    const d = new Date(m.ev.startMs);
    const when = `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')} ${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;
    const info = el('div', 'dd-meeting-info');
    info.append(el('span', 'dd-meeting-title', m.ev.title), el('span', 'dd-meeting-meta', `${when} · ${fmtHours(m.minutes)}${m.how === 'auto' ? ' · automático' : ''}`));
    const label = el('label', 'v2-visually-hidden', `Proyecto de "${m.ev.title}"`);
    const selId = 'mt-' + m.ev.id.replace(/[^a-zA-Z0-9_-]/g, '');
    label.htmlFor = selId;
    const sel = document.createElement('select');
    sel.id = selId;
    sel.className = 'v2-select';
    const opts = [[UNASSIGNED, 'Sin asignar'], [IGNORED, 'No es de un proyecto'], ...projects.map(p => [p.id, p.name])];
    for (const [v, t] of opts) {
      const o = document.createElement('option');
      o.value = v;
      o.textContent = t;
      if (v === m.projectId) o.selected = true;
      sel.appendChild(o);
    }
    sel.addEventListener('change', async () => {
      if (sel.value === UNASSIGNED) return;
      await setMeetingProject(m.ev, sel.value);
      rerender();
    });
    row.append(info, label, sel);
    ul.appendChild(row);
  }
  sec.appendChild(ul);
  return sec;
}

// Compact card for Home: this month's donut + top projects
export function renderDedicationMini(onOpen) {
  const ym = monthKey(new Date());
  const sum = monthSummary(ym, 'all');
  const card = el('section', 'v2-card dd-mini');
  const head = el('div', 'v2-card-head');
  head.appendChild(el('h2', 'v2-card-title', `Dedicación · ${MONTHS[new Date().getMonth()]}`));
  const open = el('button', 'v2-link', 'Ver detalle');
  open.type = 'button';
  open.addEventListener('click', onOpen);
  head.appendChild(open);
  card.appendChild(head);

  const body = el('div', 'dd-mini-body');
  const donutWrap = el('div', 'dd-donut dd-donut-sm');
  const canvas = document.createElement('canvas');
  canvas.setAttribute('role', 'img');
  canvas.setAttribute('aria-label', 'Dedicación del mes por proyecto');
  donutWrap.appendChild(canvas);
  const center = el('div', 'dd-donut-center');
  center.append(el('strong', null, fmtHours(sum.total)), el('span', null, 'este mes'));
  donutWrap.appendChild(center);
  body.appendChild(donutWrap);
  requestAnimationFrame(() => drawDonut(canvas, sum.rows, 140));

  const list = el('div', 'dd-mini-list');
  const top = sum.rows.slice(0, 5);
  if (!top.length) list.appendChild(el('p', 'dd-empty', 'Cargá bloques en Today Tasks o conectá el Calendar para ver el reparto.'));
  for (const r of top) {
    const row = el('div', 'dd-mini-row');
    const sw = el('span', 'dd-swatch');
    sw.style.background = r.color;
    row.append(sw, el('span', 'dd-mini-name', r.name), el('span', 'dd-mini-pct', `${Math.round(r.pct * 100)}%`));
    list.appendChild(row);
  }
  body.appendChild(list);
  card.appendChild(body);
  return card;
}

// Per-project numbers for the project page: last 6 months
export function projectMonths(projectId) {
  const out = [];
  for (let i = 5; i >= 0; i--) {
    const ym = shiftMonth(monthKey(new Date()), -i);
    const s = monthSummary(ym, 'all');
    const r = s.rows.find(x => x.id === projectId);
    out.push({ ym, label: MONTHS_SHORT[Number(ym.slice(5)) - 1], minutes: r ? r.minutes : 0, pct: r ? r.pct : 0 });
  }
  return out;
}

export function openDedication() {
  viewMonth = monthKey(new Date());
}
