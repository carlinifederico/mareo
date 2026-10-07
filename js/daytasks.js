import { Store } from './store.js';
import { icon } from './icons.js';
import { pickContrastColor } from './today.js';

// Hourly blocks: 11–12 … 18–19
const HOURS = [11, 12, 13, 14, 15, 16, 17, 18];
const DAY_NAMES = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
const MONTH_NAMES = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];

let selectedDate = startOfDay(new Date());

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

export function renderDayTasks(container) {
  if (!container) return;
  const key = dateKey(selectedDate);
  const plan = Store.getDayPlan(key);

  container.innerHTML = '';

  container.appendChild(createNav());

  const layout = document.createElement('div');
  layout.className = 'daytasks-layout';

  // Unscheduled: Today notes not yet placed in a block of this day
  const scheduled = new Set();
  for (const h of Object.keys(plan)) {
    for (const item of plan[h]) if (item.type === 'note') scheduled.add(item.noteId);
  }
  const unscheduled = Store.getTodayItems().filter(it => !scheduled.has(it.note.id));
  layout.appendChild(createUnscheduledColumn(unscheduled));

  const grid = document.createElement('div');
  grid.className = 'daytasks-grid';
  const nowHour = isToday(selectedDate) ? new Date().getHours() : null;
  for (const hour of HOURS) {
    grid.appendChild(createSlot(key, hour, plan[hour] || [], hour === nowHour));
  }
  layout.appendChild(grid);

  container.appendChild(layout);
  // container persists across renders — bind the drag handler only once
  if (!container._dayTasksDnD) {
    attachDayTasksDnD(container);
    container._dayTasksDnD = true;
  }
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
    empty.innerHTML = `Nada pendiente. Marcá notas con ${icon('dot')} en el Board y arrastralas a un horario.`;
    list.appendChild(empty);
  }
  for (const it of items) {
    const chip = document.createElement('div');
    chip.className = 'daytasks-item daytasks-chip' + (it.note.done ? ' done' : '');
    chip.dataset.projectId = it.projectId;
    chip.dataset.noteId = it.note.id;

    const grip = document.createElement('span');
    grip.className = 'today-drag-grip daytasks-grip';
    grip.innerHTML = icon('drag-handle');
    grip.title = 'Arrastrar a un horario';

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

function createProjectLabel(name, color) {
  const label = document.createElement('span');
  label.className = 'today-project-label';
  label.style.backgroundColor = color;
  label.style.color = pickContrastColor(color);
  label.textContent = name;
  return label;
}

function createSlot(key, hour, items, isNow) {
  const slot = document.createElement('div');
  slot.className = 'daytasks-slot' + (isNow ? ' now' : '');
  slot.dataset.hour = hour;

  const time = document.createElement('div');
  time.className = 'daytasks-time';
  time.textContent = `${hour}:00 – ${hour + 1}:00`;
  slot.appendChild(time);

  const list = document.createElement('div');
  list.className = 'daytasks-slot-list';
  for (const item of items) list.appendChild(createSlotItem(key, hour, item));
  slot.appendChild(list);

  const add = document.createElement('input');
  add.type = 'text';
  add.className = 'daytasks-add';
  add.placeholder = '+ agregar tarea';
  add.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    const val = add.value.trim();
    if (!val) return;
    Store.addDayPlanText(key, hour, val);
    rerender();
    // Keep typing in the same block after re-render
    requestAnimationFrame(() => {
      document.querySelector(`.daytasks-slot[data-hour="${hour}"] .daytasks-add`)?.focus();
    });
  });
  slot.appendChild(add);
  return slot;
}

function createSlotItem(key, hour, item) {
  const isNote = item.type === 'note';
  const done = isNote ? !!item.note.done : !!item.done;

  const row = document.createElement('div');
  row.className = 'daytasks-item' + (done ? ' done' : '');
  row.dataset.itemId = item.id;
  row.dataset.hour = hour;
  row.dataset.type = item.type;

  const grip = document.createElement('span');
  grip.className = 'today-drag-grip daytasks-grip';
  grip.innerHTML = icon('drag-handle');
  grip.title = 'Arrastrar para mover';

  const checkbox = document.createElement('input');
  checkbox.type = 'checkbox';
  checkbox.className = 'note-preview-check';
  checkbox.checked = done;
  checkbox.addEventListener('change', () => {
    if (isNote) Store.updateProjectNote(item.projectId, item.noteId, { done: checkbox.checked });
    else Store.updateDayPlanItem(key, hour, item.id, { done: checkbox.checked });
    rerender();
  });

  const text = document.createElement('textarea');
  text.rows = 1;
  text.className = 'today-text';
  text.value = isNote ? (item.note.title || item.note.content || '') : (item.text || '');
  text.placeholder = 'Tarea...';
  text.addEventListener('change', () => {
    if (isNote) Store.updateProjectNote(item.projectId, item.noteId, { title: text.value });
    else Store.updateDayPlanItem(key, hour, item.id, { text: text.value });
    rerender();
  });
  text.addEventListener('input', () => autoResize(text));
  requestAnimationFrame(() => autoResize(text));

  const removeBtn = document.createElement('button');
  removeBtn.className = 'btn-icon today-remove';
  removeBtn.title = isNote ? 'Quitar del horario' : 'Borrar tarea';
  removeBtn.innerHTML = icon('close');
  removeBtn.addEventListener('click', () => {
    Store.removeDayPlanItem(key, hour, item.id);
    rerender();
  });

  row.appendChild(grip);
  row.appendChild(checkbox);
  row.appendChild(text);
  if (isNote) row.appendChild(createProjectLabel(item.projectName, item.projectColor));
  row.appendChild(removeBtn);
  return row;
}

function autoResize(el) {
  el.style.height = 'auto';
  el.style.height = el.scrollHeight + 'px';
}

// Pointer-based drag (same approach as the Today panel reorder): grab a grip,
// drop on a block (optionally before another item) or back on SIN HORARIO.
function attachDayTasksDnD(container) {
  container.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    const grip = e.target.closest('.daytasks-grip');
    if (!grip) return;
    const dragEl = grip.closest('.daytasks-item');
    if (!dragEl) return;
    e.preventDefault();

    const fromChip = dragEl.classList.contains('daytasks-chip');
    dragEl.classList.add('dragging');
    try { grip.setPointerCapture(e.pointerId); } catch {}

    // Floating ghost that follows the pointer
    const rect = dragEl.getBoundingClientRect();
    const ghost = dragEl.cloneNode(true);
    ghost.classList.add('daytasks-ghost');
    ghost.style.width = rect.width + 'px';
    document.body.appendChild(ghost);
    const offX = e.clientX - rect.left, offY = e.clientY - rect.top;
    const moveGhost = (x, y) => { ghost.style.left = (x - offX) + 'px'; ghost.style.top = (y - offY) + 'px'; };
    moveGhost(e.clientX, e.clientY);

    const clearOver = () => {
      container.querySelectorAll('.drag-over').forEach(n => n.classList.remove('drag-over'));
    };

    // Resolve drop target: { hour, beforeId } | { unschedule: true } | null
    const findTarget = (x, y) => {
      ghost.style.display = 'none';
      const under = document.elementFromPoint(x, y);
      ghost.style.display = '';
      if (!under) return null;
      if (under.closest('.daytasks-unscheduled')) {
        return { unschedule: true, el: under.closest('.daytasks-unscheduled') };
      }
      const slot = under.closest('.daytasks-slot');
      if (!slot) return null;
      const overItem = under.closest('.daytasks-slot .daytasks-item');
      const beforeId = overItem && overItem !== dragEl ? overItem.dataset.itemId : null;
      return { hour: Number(slot.dataset.hour), beforeId, el: overItem && overItem !== dragEl ? overItem : slot };
    };

    const onMove = (mv) => {
      moveGhost(mv.clientX, mv.clientY);
      clearOver();
      const t = findTarget(mv.clientX, mv.clientY);
      if (t) t.el.classList.add('drag-over');
    };

    const cleanup = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onCancel);
      try { grip.releasePointerCapture(e.pointerId); } catch {}
      ghost.remove();
      dragEl.classList.remove('dragging');
      clearOver();
    };

    const onCancel = () => cleanup();

    const onUp = (up) => {
      const t = findTarget(up.clientX, up.clientY);
      cleanup();
      if (!t) return;
      const key = dateKey(selectedDate);
      if (fromChip) {
        if (t.unschedule) return;
        Store.scheduleNoteInDay(key, t.hour, dragEl.dataset.projectId, dragEl.dataset.noteId, t.beforeId);
      } else {
        const fromHour = Number(dragEl.dataset.hour);
        const id = dragEl.dataset.itemId;
        if (t.unschedule) {
          // Only project notes go back to SIN HORARIO; free-text tasks stay put
          if (dragEl.dataset.type !== 'note') return;
          Store.removeDayPlanItem(key, fromHour, id);
        } else {
          Store.moveDayPlanItem(key, fromHour, id, t.hour, t.beforeId);
        }
      }
      rerender();
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onCancel);
  });
}
