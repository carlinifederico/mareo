import { Store } from './store.js';
import { icon } from './icons.js';
import { pickContrastColor } from './today.js';

// Visible range 11:00–19:00, in minutes from midnight
const DAY_START = 11 * 60;
const DAY_END = 19 * 60;
const HOUR_PX = 80;
const SNAP = 15;          // minutes
const MIN_DURATION = 15;
const DEFAULT_DURATION = 60;

const PALETTE = ['#a78bfa', '#60a5fa', '#34d399', '#fbbf24', '#f87171', '#f472b6', '#22d3ee', '#fb923c', '#a3e635', '#94a3b8'];

const DAY_NAMES = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
const MONTH_NAMES = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];

let selectedDate = startOfDay(new Date());
let focusItemId = null;   // focus this block's text after the next render
let nowTimer = null;

function startOfDay(d) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function dateKey(d) {
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mm}-${dd}`;
}

function isToday(d) {
  return dateKey(d) === dateKey(new Date());
}

function rerender() {
  document.dispatchEvent(new Event('mareo:render'));
}

const minToPx = (min) => (min / 60) * HOUR_PX;
const pxToMin = (px) => (px / HOUR_PX) * 60;
const snap = (min) => Math.round(min / SNAP) * SNAP;
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

function fmtTime(min) {
  return `${Math.floor(min / 60)}:${String(min % 60).padStart(2, '0')}`;
}

function fmtDuration(min) {
  const h = min / 60;
  return Number.isInteger(h) ? `${h}h` : (h >= 1 ? `${+h.toFixed(2)}h` : `${min}m`);
}

function itemColor(item) {
  return item.color || item.projectColor || PALETTE[0];
}

export function renderDayTasks(container) {
  if (!container) return;
  const key = dateKey(selectedDate);
  const items = Store.getDayPlan(key);

  container.innerHTML = '';
  container.appendChild(createNav());

  const layout = document.createElement('div');
  layout.className = 'daytasks-layout';

  // Unscheduled: Today notes not yet placed on this day
  const scheduled = new Set(items.filter(i => i.type === 'note').map(i => i.noteId));
  const unscheduled = Store.getTodayItems().filter(it => !scheduled.has(it.note.id));
  const side = document.createElement('div');
  side.className = 'daytasks-side';
  side.appendChild(createUnscheduledColumn(unscheduled));
  side.appendChild(createProjectsColumn());
  layout.appendChild(side);
  layout.appendChild(createCalendar(key, items));
  container.appendChild(layout);

  // container persists across renders — bind pointer handlers only once
  if (!container._dayTasksBound) {
    attachChipDrag(container);
    container._dayTasksBound = true;
  }

  if (focusItemId) {
    const ta = container.querySelector(`.daytasks-event[data-item-id="${focusItemId}"] .daytasks-event-text`);
    focusItemId = null;
    if (ta) requestAnimationFrame(() => ta.focus());
  }

  // Keep the "now" line moving while the tab is open
  clearInterval(nowTimer);
  if (isToday(selectedDate)) nowTimer = setInterval(updateNowLine, 60000);
}

function createNav() {
  const nav = document.createElement('div');
  nav.className = 'exp-month-nav daytasks-nav';

  const prevBtn = document.createElement('button');
  prevBtn.className = 'btn btn-secondary';
  prevBtn.innerHTML = icon('chevron-left');
  prevBtn.title = 'Día anterior';
  prevBtn.addEventListener('click', () => shiftDay(-1));

  const nextBtn = document.createElement('button');
  nextBtn.className = 'btn btn-secondary';
  nextBtn.innerHTML = icon('chevron-right');
  nextBtn.title = 'Día siguiente';
  nextBtn.addEventListener('click', () => shiftDay(1));

  const title = document.createElement('span');
  title.className = 'exp-month-title daytasks-title';
  title.textContent = `${DAY_NAMES[selectedDate.getDay()]} ${selectedDate.getDate()} ${MONTH_NAMES[selectedDate.getMonth()]} ${selectedDate.getFullYear()}`;
  if (isToday(selectedDate)) title.classList.add('current');

  const hint = document.createElement('span');
  hint.className = 'daytasks-hint';
  hint.textContent = 'Clic o arrastrá en la grilla para crear un bloque';

  const todayBtn = document.createElement('button');
  todayBtn.className = 'btn btn-secondary exp-today-btn';
  todayBtn.textContent = 'Hoy';
  todayBtn.addEventListener('click', () => {
    selectedDate = startOfDay(new Date());
    rerender();
  });

  nav.appendChild(prevBtn);
  nav.appendChild(title);
  nav.appendChild(nextBtn);
  nav.appendChild(hint);
  nav.appendChild(todayBtn);
  return nav;
}

function shiftDay(delta) {
  selectedDate = new Date(selectedDate.getFullYear(), selectedDate.getMonth(), selectedDate.getDate() + delta);
  rerender();
}

function createUnscheduledColumn(items) {
  const col = document.createElement('div');
  col.className = 'daytasks-unscheduled';

  const header = document.createElement('div');
  header.className = 'daytasks-col-header';
  header.textContent = 'SIN HORARIO';
  const count = document.createElement('span');
  count.className = 'today-count';
  count.textContent = items.length;
  header.appendChild(count);
  col.appendChild(header);

  const list = document.createElement('div');
  list.className = 'daytasks-unscheduled-list';
  if (items.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'today-empty';
    empty.innerHTML = `Nada pendiente. Marcá notas con ${icon('dot')} en el Board y arrastralas a la grilla.`;
    list.appendChild(empty);
  }
  for (const it of items) {
    const chip = document.createElement('div');
    chip.className = 'daytasks-chip' + (it.note.done ? ' done' : '');
    chip.dataset.kind = 'note';
    chip.dataset.projectId = it.projectId;
    chip.dataset.noteId = it.note.id;
    chip.style.borderLeftColor = it.projectColor;
    chip.title = 'Arrastrar a la grilla';

    const grip = document.createElement('span');
    grip.className = 'today-drag-grip';
    grip.innerHTML = icon('drag-handle');

    const text = document.createElement('span');
    text.className = 'daytasks-chip-text';
    text.textContent = it.note.title || it.note.content || '';

    chip.appendChild(grip);
    chip.appendChild(text);
    chip.appendChild(createProjectLabel(it.projectName, it.projectColor));
    list.appendChild(chip);
  }
  col.appendChild(list);
  return col;
}

// Active (non-archived) projects, own + shared with me
function getPlannableProjects() {
  const seen = new Set();
  const out = [];
  const add = (p) => {
    if (!p || typeof p !== 'object' || seen.has(p.id) || Store.isProjectArchived(p.id)) return;
    seen.add(p.id);
    out.push(p);
  };
  for (const cat of Store.data.categories) for (const p of cat.projects) add(p);
  for (const p of Store._sharedProjects || []) add(p);
  return out;
}

function createProjectsColumn() {
  const col = document.createElement('div');
  col.className = 'daytasks-unscheduled daytasks-projects';

  const header = document.createElement('div');
  header.className = 'daytasks-col-header';
  header.textContent = 'PROYECTOS';
  col.appendChild(header);

  const list = document.createElement('div');
  list.className = 'daytasks-unscheduled-list';
  const projects = getPlannableProjects();
  if (projects.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'today-empty';
    empty.textContent = 'No hay proyectos activos.';
    list.appendChild(empty);
  }
  for (const p of projects) {
    const chip = document.createElement('div');
    chip.className = 'daytasks-chip daytasks-project-chip';
    chip.dataset.kind = 'project';
    chip.dataset.projectId = p.id;
    chip.style.borderLeftColor = p.color;
    chip.style.setProperty('--ev-color', p.color);
    chip.title = 'Arrastrar a la grilla para bloquear tiempo para este proyecto';

    const grip = document.createElement('span');
    grip.className = 'today-drag-grip';
    grip.innerHTML = icon('drag-handle');

    const name = document.createElement('span');
    name.className = 'daytasks-chip-text daytasks-project-name';
    name.textContent = p.name;

    chip.appendChild(grip);
    chip.appendChild(name);
    list.appendChild(chip);
  }
  col.appendChild(list);
  return col;
}

function createProjectLabel(name, color) {
  const label = document.createElement('span');
  label.className = 'today-project-label';
  label.style.backgroundColor = color;
  label.style.color = pickContrastColor(color);
  label.style.setProperty('--tag-color', color);
  label.textContent = name;
  return label;
}

function createCalendar(key, items) {
  const cal = document.createElement('div');
  cal.className = 'daytasks-calendar';

  const hours = document.createElement('div');
  hours.className = 'daytasks-hours';
  hours.style.height = minToPx(DAY_END - DAY_START) + 'px';
  for (let m = DAY_START; m <= DAY_END; m += 60) {
    const lbl = document.createElement('div');
    lbl.className = 'daytasks-hour-label';
    lbl.style.top = minToPx(m - DAY_START) + 'px';
    lbl.textContent = fmtTime(m);
    hours.appendChild(lbl);
  }

  const grid = document.createElement('div');
  grid.className = 'daytasks-grid';
  grid.style.height = minToPx(DAY_END - DAY_START) + 'px';
  grid.style.setProperty('--hour-px', HOUR_PX + 'px');

  for (const [item, col, cols] of layoutColumns(items)) {
    grid.appendChild(createEvent(key, item, col, cols));
  }

  const nowLine = document.createElement('div');
  nowLine.className = 'daytasks-now';
  grid.appendChild(nowLine);

  attachGridCreate(grid, key);
  cal.appendChild(hours);
  cal.appendChild(grid);
  requestAnimationFrame(updateNowLine);
  return cal;
}

function updateNowLine() {
  const line = document.querySelector('.daytasks-now');
  if (!line) return;
  const now = new Date();
  const min = now.getHours() * 60 + now.getMinutes();
  const show = isToday(selectedDate) && min >= DAY_START && min <= DAY_END;
  line.style.display = show ? '' : 'none';
  if (show) line.style.top = minToPx(min - DAY_START) + 'px';
}

// Overlapping blocks share the width side by side (calendar-style columns).
function layoutColumns(items) {
  const sorted = [...items].sort((a, b) => a.start - b.start || b.duration - a.duration);
  const out = [];
  let cluster = [], clusterEnd = -1, colEnds = [];
  const flush = () => {
    for (const entry of cluster) entry[2] = colEnds.length;
    out.push(...cluster);
    cluster = []; colEnds = [];
  };
  for (const item of sorted) {
    if (item.start >= clusterEnd) { flush(); clusterEnd = -1; }
    let col = colEnds.findIndex(end => end <= item.start);
    if (col < 0) { col = colEnds.length; colEnds.push(0); }
    colEnds[col] = item.start + item.duration;
    clusterEnd = Math.max(clusterEnd, item.start + item.duration);
    cluster.push([item, col, 1]);
  }
  flush();
  return out;
}

function positionEvent(el, start, duration) {
  el.style.top = minToPx(start - DAY_START) + 'px';
  el.style.height = Math.max(minToPx(duration) - 2, 14) + 'px';
  const time = el.querySelector('.daytasks-event-time');
  if (time) time.textContent = `${fmtTime(start)} – ${fmtTime(start + duration)} · ${fmtDuration(duration)}`;
  el.classList.toggle('compact', duration <= 30);
}

function createEvent(key, item, col, cols) {
  const isNote = item.type === 'note';
  const isProjectBlock = !isNote && !!item.projectName;
  const done = isNote ? !!item.note.done : !!item.done;
  const color = itemColor(item);

  const el = document.createElement('div');
  el.className = 'daytasks-event' + (done ? ' done' : '');
  el.dataset.itemId = item.id;
  el.dataset.type = item.type;
  el.style.setProperty('--ev-color', color);
  el.style.left = `calc(${(col / cols) * 100}% + 2px)`;
  el.style.width = `calc(${100 / cols}% - 4px)`;

  const head = document.createElement('div');
  head.className = 'daytasks-event-head';

  const time = document.createElement('span');
  time.className = 'daytasks-event-time';

  const colorBtn = document.createElement('button');
  colorBtn.className = 'daytasks-color-btn';
  colorBtn.title = isNote ? 'Cambiar color' : 'Cambiar color / proyecto';
  colorBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    openColorPicker(colorBtn, color, (c) => {
      Store.updateDayPlanItem(key, item.id, { color: c });
      rerender();
    }, isNote ? null : {
      current: item.projectId || null,
      // Picking a project drops any custom color so the block takes the project's
      onPick: (pid) => {
        Store.updateDayPlanItem(key, item.id, { projectId: pid, color: null });
        rerender();
      },
    });
  });

  const removeBtn = document.createElement('button');
  removeBtn.className = 'btn-icon today-remove daytasks-remove';
  removeBtn.title = isNote ? 'Quitar de la grilla' : 'Borrar bloque';
  removeBtn.innerHTML = icon('close');
  removeBtn.addEventListener('click', () => {
    Store.removeDayPlanItem(key, item.id);
    rerender();
  });

  head.appendChild(time);
  head.appendChild(colorBtn);
  head.appendChild(removeBtn);

  const body = document.createElement('div');
  body.className = 'daytasks-event-body';

  const checkbox = document.createElement('input');
  checkbox.type = 'checkbox';
  checkbox.className = 'note-preview-check';
  checkbox.checked = done;
  checkbox.addEventListener('change', () => {
    if (isNote) Store.updateProjectNote(item.projectId, item.noteId, { done: checkbox.checked });
    else Store.updateDayPlanItem(key, item.id, { done: checkbox.checked });
    rerender();
  });

  const text = document.createElement('textarea');
  text.rows = 1;
  text.className = 'today-text daytasks-event-text';
  text.value = isNote ? (item.note.title || item.note.content || '') : (item.text || '');
  text.placeholder = isProjectBlock ? 'Detalle...' : 'Tarea...';
  text.addEventListener('change', () => {
    if (isNote) Store.updateProjectNote(item.projectId, item.noteId, { title: text.value });
    else Store.updateDayPlanItem(key, item.id, { text: text.value });
    rerender();
  });
  text.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); text.blur(); }
  });

  body.appendChild(checkbox);
  body.appendChild(text);
  if (isNote) body.appendChild(createProjectLabel(item.projectName, item.projectColor));

  const resize = document.createElement('div');
  resize.className = 'daytasks-resize';
  resize.title = 'Arrastrar para cambiar la duración';

  el.appendChild(head);
  if (isProjectBlock) {
    const projTitle = document.createElement('div');
    projTitle.className = 'daytasks-event-project';
    projTitle.textContent = item.projectName;
    el.appendChild(projTitle);
  }
  el.appendChild(body);
  el.appendChild(resize);
  positionEvent(el, item.start, item.duration);

  attachEventDrag(el, key, item);
  return el;
}

// projectOpts: { current, onPick(projectId|null) } → also lists projects to tag the block
function openColorPicker(anchor, current, onPick, projectOpts = null) {
  document.querySelector('.daytasks-color-pop')?.remove();
  const pop = document.createElement('div');
  pop.className = 'daytasks-color-pop';
  const swatches = document.createElement('div');
  swatches.className = 'daytasks-swatches';
  for (const c of PALETTE) {
    const sw = document.createElement('button');
    sw.className = 'daytasks-swatch' + (c === current ? ' active' : '');
    sw.style.background = c;
    sw.addEventListener('click', (e) => {
      e.stopPropagation();
      pop.remove();
      onPick(c);
    });
    swatches.appendChild(sw);
  }
  pop.appendChild(swatches);

  if (projectOpts) {
    const title = document.createElement('div');
    title.className = 'daytasks-pop-title';
    title.textContent = 'PROYECTO';
    pop.appendChild(title);
    const list = document.createElement('div');
    list.className = 'daytasks-pop-projects';
    const addOption = (pid, name, color) => {
      const opt = document.createElement('button');
      opt.className = 'daytasks-pop-project' + (pid === projectOpts.current ? ' active' : '');
      const dot = document.createElement('span');
      dot.className = 'daytasks-pop-dot';
      dot.style.background = color || 'transparent';
      opt.appendChild(dot);
      opt.appendChild(document.createTextNode(name));
      opt.addEventListener('click', (e) => {
        e.stopPropagation();
        pop.remove();
        projectOpts.onPick(pid);
      });
      list.appendChild(opt);
    };
    addOption(null, 'Sin proyecto', null);
    for (const p of getPlannableProjects()) addOption(p.id, p.name, p.color);
    pop.appendChild(list);
  }

  document.body.appendChild(pop);
  const r = anchor.getBoundingClientRect();
  pop.style.top = Math.max(8, Math.min(r.bottom + 4, window.innerHeight - pop.offsetHeight - 8)) + 'px';
  pop.style.left = Math.min(r.left, window.innerWidth - pop.offsetWidth - 8) + 'px';
  setTimeout(() => {
    document.addEventListener('pointerdown', function close(e) {
      if (pop.contains(e.target)) return;
      pop.remove();
      document.removeEventListener('pointerdown', close);
    });
  });
}

// Move (drag the block) and resize (drag the bottom edge). Changes are shown
// live and committed on release. Dropping a note block on SIN HORARIO
// unschedules it.
function attachEventDrag(el, key, item) {
  el.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    if (e.target.closest('textarea, input, button')) return;
    e.preventDefault();
    e.stopPropagation();

    const mode = e.target.closest('.daytasks-resize') ? 'resize' : 'move';
    const startX = e.clientX, startY = e.clientY;
    let start = item.start, duration = item.duration;
    let moved = false;
    let overUnscheduled = false;
    const unscheduledEl = document.querySelector('.daytasks-unscheduled:not(.daytasks-projects)');
    try { el.setPointerCapture(e.pointerId); } catch {}

    const onMove = (mv) => {
      const dy = mv.clientY - startY;
      if (!moved && Math.hypot(mv.clientX - startX, dy) < 3) return;
      moved = true;
      el.classList.add('dragging');
      const delta = snap(pxToMin(dy));
      if (mode === 'move') {
        start = clamp(item.start + delta, DAY_START, DAY_END - item.duration);
      } else {
        duration = clamp(item.duration + delta, MIN_DURATION, DAY_END - item.start);
      }
      positionEvent(el, start, duration);

      if (mode === 'move' && item.type === 'note' && unscheduledEl) {
        const r = unscheduledEl.getBoundingClientRect();
        overUnscheduled = mv.clientX >= r.left && mv.clientX <= r.right && mv.clientY >= r.top && mv.clientY <= r.bottom;
        unscheduledEl.classList.toggle('drag-over', overUnscheduled);
      }
    };

    const onUp = () => {
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerup', onUp);
      el.removeEventListener('pointercancel', onUp);
      try { el.releasePointerCapture(e.pointerId); } catch {}
      el.classList.remove('dragging');
      unscheduledEl?.classList.remove('drag-over');
      if (overUnscheduled) {
        Store.removeDayPlanItem(key, item.id);
        rerender();
      } else if (moved && (start !== item.start || duration !== item.duration)) {
        Store.updateDayPlanItem(key, item.id, { start, duration });
        rerender();
      }
    };

    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerup', onUp);
    el.addEventListener('pointercancel', onUp);
  });
}

// Click on empty grid → 1h block; click-and-drag → block spanning the drag.
function attachGridCreate(grid, key) {
  grid.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || e.target !== grid) return;
    const rect = grid.getBoundingClientRect();
    const minAt = (y) => clamp(DAY_START + snap(pxToMin(y - rect.top)), DAY_START, DAY_END);
    const anchor = clamp(DAY_START + Math.floor(pxToMin(e.clientY - rect.top) / SNAP) * SNAP, DAY_START, DAY_END - MIN_DURATION);
    const startY = e.clientY;
    let dragging = false;

    const preview = document.createElement('div');
    preview.className = 'daytasks-event daytasks-preview';
    preview.style.left = '2px';
    preview.style.width = 'calc(100% - 4px)';
    const pTime = document.createElement('span');
    pTime.className = 'daytasks-event-time';
    preview.appendChild(pTime);

    const range = (y) => {
      const m = minAt(y);
      const s = Math.min(anchor, m);
      const end = Math.max(anchor + MIN_DURATION, m);
      return [s, end - s];
    };

    const onMove = (mv) => {
      if (!dragging && Math.abs(mv.clientY - startY) < 4) return;
      if (!dragging) { dragging = true; grid.appendChild(preview); }
      const [s, d] = range(mv.clientY);
      positionEvent(preview, s, d);
    };

    const onUp = (up) => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onCancel);
      preview.remove();
      let s, d;
      if (dragging) {
        [s, d] = range(up.clientY);
      } else {
        s = Math.min(anchor, DAY_END - DEFAULT_DURATION);
        d = DEFAULT_DURATION;
      }
      const color = PALETTE[Store.getDayPlan(key).length % PALETTE.length];
      focusItemId = Store.addDayPlanItem(key, { type: 'text', start: s, duration: d, color });
      rerender();
    };

    const onCancel = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onCancel);
      preview.remove();
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onCancel);
  });
}

// Drag a SIN HORARIO chip onto the grid → note block at the drop time.
function attachChipDrag(container) {
  container.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    const chip = e.target.closest('.daytasks-chip');
    if (!chip) return;
    e.preventDefault();

    const rect = chip.getBoundingClientRect();
    const ghost = chip.cloneNode(true);
    ghost.classList.add('daytasks-ghost');
    ghost.style.width = rect.width + 'px';
    document.body.appendChild(ghost);
    const offX = e.clientX - rect.left, offY = e.clientY - rect.top;
    const moveGhost = (x, y) => { ghost.style.left = (x - offX) + 'px'; ghost.style.top = (y - offY) + 'px'; };
    moveGhost(e.clientX, e.clientY);
    chip.classList.add('dragging');

    // Drop time = top edge of the ghost, so what you see is where it lands
    const dropStart = (x, y) => {
      const grid = document.querySelector('.daytasks-grid');
      if (!grid) return null;
      const r = grid.getBoundingClientRect();
      if (x < r.left || x > r.right || y < r.top - 20 || y > r.bottom) return null;
      return clamp(DAY_START + snap(pxToMin(y - offY - r.top)), DAY_START, DAY_END - DEFAULT_DURATION);
    };

    const onMove = (mv) => {
      moveGhost(mv.clientX, mv.clientY);
      const s = dropStart(mv.clientX, mv.clientY);
      document.querySelector('.daytasks-grid')?.classList.toggle('drag-over', s != null);
    };

    const cleanup = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', cleanup);
      ghost.remove();
      chip.classList.remove('dragging');
      document.querySelector('.daytasks-grid')?.classList.remove('drag-over');
    };

    const onUp = (up) => {
      const s = dropStart(up.clientX, up.clientY);
      cleanup();
      if (s == null) return;
      const key = dateKey(selectedDate);
      if (chip.dataset.kind === 'project') {
        focusItemId = Store.addDayPlanItem(key, { type: 'text', projectId: chip.dataset.projectId, start: s, duration: DEFAULT_DURATION });
      } else {
        Store.scheduleNoteInDay(key, chip.dataset.projectId, chip.dataset.noteId, s, DEFAULT_DURATION);
      }
      rerender();
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', cleanup);
  });
}
