// Home / Studio: the v2 landing view. Hubs online, today's agenda, every
// project as an identity card, and this month's dedication. Clicking a card
// opens the project page (#/p/<id>), rendered in the same view.

import { Store } from './store.js';
import { Auth } from './auth.js';
import { GCal } from './gcal.js';
import { identityFor, glyphSvg, listProjects } from './identity.js';
import { renderDedicationMini, openDedication } from './stats.js';
import { renderProjectPage } from './project-page.js';
import { showAddProjectModal } from './sidebar.js';

const DAYS = ['DOMINGO', 'LUNES', 'MARTES', 'MIÉRCOLES', 'JUEVES', 'VIERNES', 'SÁBADO'];
const MONTHS = ['ENE', 'FEB', 'MAR', 'ABR', 'MAY', 'JUN', 'JUL', 'AGO', 'SEP', 'OCT', 'NOV', 'DIC'];

let categoryFilter = 'all';

const ARROW = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><path d="M7 17L17 7M8 7h9v9"/></svg>';
const PLUS = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>';

export function currentRoute() {
  const m = /^#\/p\/(.+)$/.exec(location.hash);
  return m ? { projectId: decodeURIComponent(m[1]) } : {};
}

export function openProjectPage(projectId) {
  location.hash = `#/p/${encodeURIComponent(projectId)}`;
}

export function renderHome(container) {
  if (!container) return;
  const route = currentRoute();
  container.innerHTML = '';
  if (route.projectId && Store._findProject(route.projectId)) {
    renderProjectPage(container, route.projectId);
    return;
  }
  container.appendChild(renderStudio());
}

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}

function dateKey(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function fmtTime(min) {
  return `${Math.floor(min / 60)}:${String(min % 60).padStart(2, '0')}`;
}

function firstName() {
  const n = Auth.getDisplayName() || '';
  return n.split(' ')[0] || '';
}

function greeting() {
  const h = new Date().getHours();
  if (h < 13) return 'Buen día';
  if (h < 20) return 'Buenas tardes';
  return 'Buenas noches';
}

function renderStudio() {
  const page = el('div', 'v2-page studio');
  const projects = listProjects();
  const withHub = projects.filter(({ project }) => identityFor(project).hub);
  const todayItems = Store.getDayPlan(dateKey(new Date())).sort((a, b) => a.start - b.start);

  // --- Greeting + Today ---
  const top = el('section', 'studio-top');
  const hello = el('div', 'studio-hello');
  const now = new Date();
  hello.appendChild(el('div', 'v2-eyebrow', `${DAYS[now.getDay()]} ${now.getDate()} ${MONTHS[now.getMonth()]} ${now.getFullYear()}`));
  hello.appendChild(el('h1', 'studio-title', `${greeting()}${firstName() ? ', ' + firstName() : ''}.`));
  const parts = [`${projects.length} proyectos activos`, `${withHub.length} ${withHub.length === 1 ? 'hub online' : 'hubs online'}`];
  if (todayItems.length) parts.push(`${todayItems.length} ${todayItems.length === 1 ? 'bloque' : 'bloques'} hoy`);
  hello.appendChild(el('p', 'studio-sub', parts.join(' · ')));
  const actions = el('div', 'studio-actions');
  const add = el('button', 'v2-btn v2-btn-primary');
  add.type = 'button';
  add.innerHTML = `${PLUS}<span>Nuevo proyecto</span>`;
  add.addEventListener('click', () => showAddProjectModal());
  actions.appendChild(add);
  hello.appendChild(actions);
  top.appendChild(hello);
  top.appendChild(renderTodayCard(todayItems));
  page.appendChild(top);

  // --- Hubs online ---
  if (withHub.length) {
    const sec = el('section', 'studio-section');
    const head = el('div', 'studio-section-head');
    head.appendChild(el('h2', 'studio-h2', 'Production hubs online'));
    sec.appendChild(head);
    const grid = el('div', 'hub-grid');
    for (const { project } of withHub) grid.appendChild(renderHubCard(project));
    sec.appendChild(grid);
    page.appendChild(sec);
  }

  // --- Dedication + all projects ---
  const sec = el('section', 'studio-section');
  const head = el('div', 'studio-section-head');
  head.appendChild(el('h2', 'studio-h2', 'Todos los proyectos'));

  const cats = [];
  for (const { categoryId, categoryName } of projects) {
    if (!cats.find(c => c.id === categoryId)) cats.push({ id: categoryId, name: categoryName });
  }
  if (!cats.find(c => c.id === categoryFilter)) categoryFilter = 'all';
  if (cats.length > 1) {
    const seg = el('div', 'v2-segmented');
    seg.setAttribute('role', 'group');
    seg.setAttribute('aria-label', 'Filtrar por categoría');
    for (const c of [{ id: 'all', name: 'Todos' }, ...cats]) {
      const b = el('button', c.id === categoryFilter ? 'on' : '', titleCase(c.name));
      b.type = 'button';
      b.setAttribute('aria-pressed', String(c.id === categoryFilter));
      b.addEventListener('click', () => { categoryFilter = c.id; document.dispatchEvent(new Event('mareo:render')); });
      seg.appendChild(b);
    }
    head.appendChild(seg);
  }
  sec.appendChild(head);

  const layout = el('div', 'studio-projects');
  const groups = el('div', 'studio-groups');
  for (const cat of cats) {
    if (categoryFilter !== 'all' && categoryFilter !== cat.id) continue;
    const items = projects.filter(p => p.categoryId === cat.id);
    const group = el('div', 'studio-group');
    group.appendChild(el('div', 'v2-eyebrow', `${cat.name.toUpperCase()} · ${items.length}`));
    const grid = el('div', 'project-grid');
    for (const { project } of items) grid.appendChild(renderProjectCard(project));
    group.appendChild(grid);
    groups.appendChild(group);
  }
  if (!projects.length) {
    groups.appendChild(el('p', 'dd-empty', 'Todavía no hay proyectos. Creá el primero con "Nuevo proyecto".'));
  }
  layout.appendChild(groups);
  const aside = el('div', 'studio-aside');
  aside.appendChild(renderDedicationMini(() => {
    openDedication();
    document.dispatchEvent(new CustomEvent('mareo:openDedication'));
  }));
  layout.appendChild(aside);
  sec.appendChild(layout);
  page.appendChild(sec);

  return page;
}

function titleCase(s) {
  return (s || '').toLowerCase().replace(/(^|\s)\S/g, c => c.toUpperCase());
}

function renderTodayCard(items) {
  const card = el('aside', 'v2-card today-card');
  card.setAttribute('aria-label', 'Hoy');
  const head = el('div', 'v2-card-head');
  head.appendChild(el('h2', 'v2-card-title', 'Hoy'));
  const open = el('button', 'v2-link', 'Abrir agenda');
  open.type = 'button';
  open.addEventListener('click', () => document.dispatchEvent(new CustomEvent('mareo:switchView', { detail: 'daytasks' })));
  head.appendChild(open);
  card.appendChild(head);

  const list = el('div', 'today-list');
  for (const it of items) list.appendChild(todayRow(fmtTime(it.start), it.projectName || '', it.type === 'note' ? (it.note.title || it.note.content || '') : (it.text || ''), it.color || it.projectColor || '#3A3C42', !!it.projectId));
  card.appendChild(list);

  const empty = el('p', 'dd-empty', 'Nada agendado para hoy.');
  if (!items.length) list.appendChild(empty);

  // Calendar events land asynchronously
  if (GCal.isConnected() && GCal.isEnabled()) {
    GCal.getEvents(dateKey(new Date())).then(res => {
      if (!res.events || !list.isConnected) return;
      const timed = res.events.filter(e => !e.allDay);
      if (!timed.length) return;
      empty.remove();
      for (const ev of timed) list.appendChild(todayRow(fmtTime(ev.start), 'CALENDAR', ev.title, null, false, ev.color));
      // Re-sort by time
      [...list.children].sort((a, b) => (a.dataset.t || '').localeCompare(b.dataset.t || '', undefined, { numeric: true }))
        .forEach(n => list.appendChild(n));
    });
  } else {
    const hint = el('button', 'v2-link today-gcal', GCal.isExpired() ? 'Reconectar Google Calendar' : 'Conectar Google Calendar');
    hint.type = 'button';
    hint.addEventListener('click', async () => {
      try { await GCal.connect(); } catch (err) { console.warn('Calendar connect failed', err); }
      document.dispatchEvent(new Event('mareo:render'));
    });
    card.appendChild(hint);
  }
  return card;
}

function todayRow(time, label, text, color, filled, dotColor) {
  const row = el('div', 'today-row');
  const [h, m] = time.split(':');
  row.dataset.t = `${h.padStart(2, '0')}:${m}`;
  row.appendChild(el('span', 'today-time', time));
  const block = el('div', 'today-block' + (filled ? ' filled' : ''));
  if (filled && color) {
    block.style.background = color;
    block.style.color = identityInk(color);
  } else if (dotColor) {
    block.style.setProperty('--dot', dotColor);
    block.classList.add('event');
  }
  if (label) block.appendChild(el('span', 'today-block-label', label.toUpperCase()));
  block.appendChild(el('span', 'today-block-text', text || '—'));
  row.appendChild(block);
  return row;
}

function identityInk(color) {
  const m = /^#?([0-9a-f]{6})$/i.exec(color || '');
  if (!m) return '#141416';
  const v = parseInt(m[1], 16);
  const lum = (0.299 * ((v >> 16) & 255) + 0.587 * ((v >> 8) & 255) + 0.114 * (v & 255)) / 255;
  return lum > 0.55 ? '#141416' : '#F4F4F6';
}

function coverEl(project, id, size) {
  const cover = el('div', 'identity-cover');
  cover.style.background = id.color;
  cover.style.color = id.ink;
  if (id.thumb) {
    const img = document.createElement('img');
    img.src = id.thumb;
    img.alt = '';
    img.loading = 'lazy';
    cover.appendChild(img);
    cover.classList.add('has-thumb');
    const badge = el('span', 'identity-badge');
    badge.style.background = id.color;
    badge.style.color = id.ink;
    badge.innerHTML = glyphSvg(id.glyph, { size: 20, stroke: 3 });
    cover.appendChild(badge);
  } else {
    cover.innerHTML = glyphSvg(id.glyph, { size, stroke: size > 90 ? 2 : 2.4 });
  }
  return cover;
}

function renderHubCard(project) {
  const id = identityFor(project);
  const card = el('article', 'hub-card');
  const cover = el('a', 'hub-cover');
  cover.href = `#/p/${encodeURIComponent(project.id)}`;
  cover.setAttribute('aria-label', `Abrir ${project.name}`);
  cover.appendChild(coverEl(project, id, 112));
  card.appendChild(cover);

  const body = el('div', 'hub-body');
  const top = el('div', 'hub-top');
  const name = el('a', 'hub-name', project.name);
  name.href = `#/p/${encodeURIComponent(project.id)}`;
  top.appendChild(name);
  top.appendChild(statusPill(true));
  body.appendChild(top);

  const pills = el('div', 'v2-pills');
  if (id.stage) pills.appendChild(el('span', 'v2-pill', id.stage));
  const cur = currentTask(project);
  if (cur) pills.appendChild(el('span', 'v2-pill', cur.label));
  if (pills.childElementCount) body.appendChild(pills);

  const sections = (id.hub.sections || []).slice(0, 4);
  if (sections.length) {
    const grid = el('div', 'hub-sections');
    for (const s of sections) {
      const a = el('a', 'hub-section', s.label);
      a.href = s.url || id.hub.url;
      a.target = '_blank';
      a.rel = 'noopener';
      grid.appendChild(a);
    }
    body.appendChild(grid);
  }

  const open = el('a', 'v2-btn hub-open');
  open.href = id.hub.url;
  open.target = '_blank';
  open.rel = 'noopener';
  open.style.background = id.color;
  open.style.color = id.ink;
  open.innerHTML = `<span>Abrir hub</span>${ARROW}`;
  body.appendChild(open);
  card.appendChild(body);
  return card;
}

export function statusPill(online) {
  const s = el('span', 'hub-status' + (online ? ' on' : ''));
  s.innerHTML = `<svg width="8" height="8" aria-hidden="true"><circle cx="4" cy="4" r="4" fill="currentColor"/></svg>`;
  s.appendChild(document.createTextNode(online ? 'Hub online' : 'Sin hub'));
  return s;
}

// Top-level task running today (day-of-year in the current year), if any
export function currentTask(project) {
  const now = new Date();
  const doy = Math.floor((now - new Date(now.getFullYear(), 0, 1)) / 86400000);
  const top = (project.tasks || []).filter(t => !t.parentId);
  return top.find(t => doy >= (t.startDay || 0) && doy < (t.startDay || 0) + (t.durationDays || 1)) || null;
}

function renderProjectCard(project) {
  const id = identityFor(project);
  const a = el('a', 'project-card');
  a.href = `#/p/${encodeURIComponent(project.id)}`;
  a.appendChild(coverEl(project, id, 64));
  const body = el('div', 'project-card-body');
  const top = el('div', 'project-card-top');
  top.appendChild(el('span', 'project-card-name', project.name));
  if (id.hub) {
    const dot = el('span', 'hub-dot');
    dot.title = 'Hub online';
    dot.setAttribute('aria-label', 'Hub online');
    top.appendChild(dot);
  } else {
    top.appendChild(el('span', 'project-card-mono', id.monogram));
  }
  body.appendChild(top);
  const cur = currentTask(project);
  const meta = [id.stage, cur && cur.label].filter(Boolean).join(' · ');
  body.appendChild(el('span', 'project-card-meta', meta || (project._shared ? 'Compartido' : '—')));
  a.appendChild(body);
  return a;
}
