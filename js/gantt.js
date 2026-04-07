import { Store } from './store.js';
import { getWeekWidth, getDayWidth, isDayMode, getTotalWeeks, getTotalWidth, taskToPixels, taskToDisplayPixels, getTodayPixelX, getTodayWeekIndex } from './timeline.js';
import { showAddTaskModal } from './sidebar.js';
import { showModal } from './modal.js';

const LANE_HEIGHTS = [36, 28, 22, 18, 16, 16];
const DURATIONS = [7, 5, 3, 2, 2, 2];

function lightenColor(hex, amount) {
  if (!hex || hex[0] !== '#') return '#aaaaaa';
  let r = parseInt(hex.slice(1, 3), 16);
  let g = parseInt(hex.slice(3, 5), 16);
  let b = parseInt(hex.slice(5, 7), 16);
  r = Math.round(r + (255 - r) * amount);
  g = Math.round(g + (255 - g) * amount);
  b = Math.round(b + (255 - b) * amount);
  return '#' + [r, g, b].map(c => c.toString(16).padStart(2, '0')).join('');
}

function createTaskInline(projId, day, parentId) {
  const proj = Store._findProject(projId);
  if (!proj) return;
  const parent = parentId ? Store._findTask(parentId) : null;
  const depth = parent ? Store.getTaskDepth(parent.id) + 1 : 0;
  const color = parent ? lightenColor(parent.color, 0.2) : proj.color;
  const newTask = Store.addTask(projId, {
    label: '',
    startDay: day,
    durationDays: DURATIONS[Math.min(depth, DURATIONS.length - 1)],
    color: color,
    parentId: parentId || null
  });
  if (!newTask) return;

  // Re-render to get the bar in place, then focus its label for inline edit
  document.dispatchEvent(new Event('mareo:render'));
  requestAnimationFrame(() => {
    const bar = document.querySelector(`.task-bar[data-task-id="${newTask.id}"]`);
    if (!bar) return;
    startInlineEdit(bar, newTask);
  });
}

function startInlineEdit(bar, task) {
  const labelEl = bar.querySelector('.task-label');
  if (!labelEl) return;

  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'task-inline-input';
  input.value = task.label;
  input.placeholder = 'Task name...';

  labelEl.style.display = 'none';
  bar.insertBefore(input, labelEl);
  input.focus();
  input.select();

  const commit = () => {
    const val = input.value.trim() || 'New Task';
    Store.updateTask(task.id, { label: val });
    input.remove();
    labelEl.style.display = '';
    labelEl.textContent = val;
    document.dispatchEvent(new Event('mareo:render'));
  };

  input.addEventListener('blur', commit);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); input.blur(); }
    if (e.key === 'Escape') {
      input.removeEventListener('blur', commit);
      if (!task.label) {
        Store.removeTask(task.id);
      }
      input.remove();
      labelEl.style.display = '';
      document.dispatchEvent(new Event('mareo:render'));
    }
  });
  // Prevent drag from starting while editing
  input.addEventListener('pointerdown', (e) => e.stopPropagation());
  input.addEventListener('click', (e) => e.stopPropagation());
  input.addEventListener('dblclick', (e) => e.stopPropagation());
}

export function renderGantt(container) {
  container.innerHTML = '';
  const year = Store.data.currentYear;
  const ww = getWeekWidth();
  const dw = getDayWidth();
  const totalWeeks = getTotalWeeks();
  const totalWidth = getTotalWidth();
  const dayMode = isDayMode();
  const todayWeek = getTodayWeekIndex(year);
  const todayPx = getTodayPixelX(year);

  // Update CSS variable for dynamic zoom
  document.documentElement.style.setProperty('--week-width', ww + 'px');

  if (Store.data.categories.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'empty-state';
    empty.textContent = 'Your timeline is empty — add a category and project to get started';
    container.appendChild(empty);
    return;
  }

  const layout = Store.getRenderedLayout();

  for (const item of layout) {
    if (item.type === 'pinned-header' || item.type === 'category-header') {
      const catRow = document.createElement('div');
      catRow.className = 'gantt-category-row';
      catRow.style.width = totalWidth + 'px';
      container.appendChild(catRow);

    } else if (item.type === 'project') {
      const proj = item.proj;
      const rootTasks = proj.tasks.filter(t => !t.parentId);
      const { tasks, laneCount } = layoutTasks(rootTasks);
      const rowHeight = Math.max(1, laneCount) * 36 + 4;

      const projRow = document.createElement('div');
      projRow.className = 'gantt-project-row';
      projRow.dataset.projectId = proj.id;
      projRow.style.width = totalWidth + 'px';
      projRow.style.height = rowHeight + 'px';

      renderGridLines(projRow, dayMode, year, dw, ww, totalWeeks, todayPx, todayWeek);

      for (const task of tasks) {
        projRow.appendChild(createTaskBar(task, 36, year, proj));
      }

      projRow.addEventListener('dblclick', (e) => {
        if (e.target === projRow || e.target.classList.contains('gantt-grid-line')) {
          const rect = projRow.getBoundingClientRect();
          const x = e.clientX - rect.left + projRow.parentElement.scrollLeft;
          const day = Math.floor(x / dw);
          createTaskInline(proj.id, day, null);
        }
      });

      if (proj.notesExpanded) {
        projRow.classList.add('has-detail-row');
      }

      container.appendChild(projRow);

    } else if (item.type === 'task-children') {
      const { proj, parentTask, depth } = item;
      const children = proj.tasks.filter(t => t.parentId === parentTask.id);
      const lh = LANE_HEIGHTS[Math.min(depth, LANE_HEIGHTS.length - 1)];
      const { tasks: childSorted, laneCount: childLanes } = layoutTasks(children);
      const childRowHeight = Math.max(1, childLanes) * lh + 4;

      const childRow = document.createElement('div');
      childRow.className = `gantt-project-row gantt-subtask-row depth-${depth}`;
      childRow.dataset.projectId = proj.id;
      childRow.dataset.parentTaskId = parentTask.id;
      childRow.dataset.depth = depth;
      childRow.style.width = totalWidth + 'px';
      childRow.style.height = childRowHeight + 'px';

      renderGridLines(childRow, dayMode, year, dw, ww, totalWeeks, todayPx, todayWeek);

      for (const task of childSorted) {
        const bar = createTaskBar(task, lh, year, proj);
        bar.classList.add('task-bar-sub', `depth-${depth}`);
        childRow.appendChild(bar);
      }

      childRow.addEventListener('dblclick', (e) => {
        if (e.target === childRow || e.target.classList.contains('gantt-grid-line')) {
          const rect = childRow.getBoundingClientRect();
          const x = e.clientX - rect.left + childRow.parentElement.scrollLeft;
          const day = Math.floor(x / dw);
          createTaskInline(proj.id, day, parentTask.id);
        }
      });

      container.appendChild(childRow);

    } else if (item.type === 'add-project' || item.type === 'add-category') {
      const addRow = document.createElement('div');
      addRow.className = 'gantt-add-row';
      addRow.style.width = totalWidth + 'px';
      container.appendChild(addRow);
    }
  }

  // Today marker
  if (todayPx >= 0) {
    const marker = document.createElement('div');
    marker.className = 'today-marker';
    marker.style.left = todayPx + 'px';
    container.appendChild(marker);
  }
}

// --- Task Popover (click on task bar) ---
function showTaskPopover(e, task) {
  closeAllPopovers();

  const popover = document.createElement('div');
  popover.className = 'task-popover';

  // Header with title + actions
  const header = document.createElement('div');
  header.className = 'popover-header';
  header.innerHTML = `<strong>${task.label}</strong>`;

  const actions = document.createElement('div');
  actions.className = 'popover-actions';

  const editBtn = document.createElement('button');
  editBtn.className = 'btn-icon';
  editBtn.textContent = '✎';
  editBtn.title = 'Edit task';
  editBtn.addEventListener('click', (ev) => {
    ev.stopPropagation();
    popover.remove();
    showEditTaskModal(task);
  });

  const deleteBtn = document.createElement('button');
  deleteBtn.className = 'btn-icon popover-delete-btn';
  deleteBtn.textContent = '🗑';
  deleteBtn.title = 'Delete task';
  deleteBtn.addEventListener('click', (ev) => {
    ev.stopPropagation();
    if (confirm(`Delete task "${task.label}"?`)) {
      popover.remove();
      Store.removeTask(task.id);
      document.dispatchEvent(new Event('mareo:render'));
    }
  });

  const closeBtn = document.createElement('button');
  closeBtn.className = 'btn-icon';
  closeBtn.textContent = '✕';
  closeBtn.title = 'Close';
  closeBtn.addEventListener('click', (ev) => {
    ev.stopPropagation();
    popover.remove();
  });

  actions.appendChild(editBtn);
  actions.appendChild(deleteBtn);
  actions.appendChild(closeBtn);
  header.appendChild(actions);
  popover.appendChild(header);

  // Deadline display
  if (task.deadline) {
    const deadlineRow = document.createElement('div');
    deadlineRow.className = 'popover-deadline';
    deadlineRow.textContent = 'Deadline: ' + task.deadline;
    popover.appendChild(deadlineRow);
  }

  // Description / Notes
  const notesLabel = document.createElement('div');
  notesLabel.className = 'popover-label';
  notesLabel.textContent = 'Description';
  popover.appendChild(notesLabel);

  const notesArea = document.createElement('textarea');
  notesArea.className = 'popover-notes';
  notesArea.placeholder = 'Add a description...';
  notesArea.value = task.notes || '';
  notesArea.addEventListener('input', () => {
    Store.updateTask(task.id, { notes: notesArea.value });
  });
  popover.appendChild(notesArea);

  // Links
  const linksLabel = document.createElement('div');
  linksLabel.className = 'popover-label';
  linksLabel.textContent = 'Links';
  popover.appendChild(linksLabel);

  const linksContainer = document.createElement('div');
  linksContainer.className = 'popover-links';

  function renderPopoverLinks() {
    linksContainer.innerHTML = '';
    const links = task.links || [];
    for (let i = 0; i < links.length; i++) {
      const row = document.createElement('div');
      row.className = 'popover-link-row';

      const a = document.createElement('a');
      a.href = links[i].url;
      a.target = '_blank';
      a.rel = 'noopener';
      a.textContent = links[i].label || links[i].url || 'Link';
      row.appendChild(a);

      const removeBtn = document.createElement('button');
      removeBtn.className = 'btn-icon btn-tiny';
      removeBtn.textContent = '✕';
      removeBtn.addEventListener('click', (ev) => {
        ev.stopPropagation();
        task.links.splice(i, 1);
        Store.updateTask(task.id, { links: task.links });
        renderPopoverLinks();
      });
      row.appendChild(removeBtn);

      linksContainer.appendChild(row);
    }

    const addLinkBtn = document.createElement('button');
    addLinkBtn.className = 'popover-add-link';
    addLinkBtn.textContent = '+ Add link';
    addLinkBtn.addEventListener('click', (ev) => {
      ev.stopPropagation();
      const label = prompt('Link label:');
      if (label === null) return;
      const url = prompt('URL:');
      if (url === null) return;
      if (!task.links) task.links = [];
      task.links.push({ label, url });
      Store.updateTask(task.id, { links: task.links });
      renderPopoverLinks();
    });
    linksContainer.appendChild(addLinkBtn);
  }

  renderPopoverLinks();
  popover.appendChild(linksContainer);

  // Position
  const bar = e.target.closest('.task-bar') || e.target;
  const rect = bar.getBoundingClientRect();
  popover.style.position = 'fixed';
  popover.style.left = Math.min(rect.left, window.innerWidth - 320) + 'px';
  popover.style.top = (rect.bottom + 6) + 'px';
  popover.style.zIndex = '10000';

  document.body.appendChild(popover);

  // Close on outside click (delayed to avoid immediate close)
  setTimeout(() => {
    const closeHandler = (ev) => {
      if (!popover.contains(ev.target) && !ev.target.closest('.task-bar')) {
        popover.remove();
        document.removeEventListener('mousedown', closeHandler);
      }
    };
    document.addEventListener('mousedown', closeHandler);
  }, 50);
}

function closeAllPopovers() {
  document.querySelectorAll('.task-popover').forEach(p => p.remove());
}

function renderGridLines(row, dayMode, year, dw, ww, totalWeeks, todayPx, todayWeek) {
  if (dayMode) {
    const jan1 = new Date(year, 0, 1);
    const numDays = ((year % 4 === 0 && year % 100 !== 0) || year % 400 === 0) ? 366 : 365;
    for (let d = 0; d < numDays; d++) {
      const date = new Date(jan1);
      date.setDate(jan1.getDate() + d);
      const dow = date.getDay();
      const line = document.createElement('div');
      line.className = 'gantt-grid-line day-line';
      if (dow === 0 || dow === 6) line.classList.add('weekend-col');
      if (dow === 1) line.classList.add('week-start');
      if (todayPx >= 0 && d * dw <= todayPx && todayPx < (d + 1) * dw) {
        line.classList.add('current-day-col');
      }
      line.style.left = (d * dw) + 'px';
      line.style.width = dw + 'px';
      row.appendChild(line);
    }
  } else {
    for (let w = 0; w < totalWeeks; w++) {
      const line = document.createElement('div');
      line.className = 'gantt-grid-line';
      if (w === todayWeek) line.classList.add('current-week-col');
      line.style.left = (w * ww) + 'px';
      line.style.width = ww + 'px';
      row.appendChild(line);
    }
  }
}

function createTaskBar(task, laneHeight, year, proj) {
  const pos = taskToDisplayPixels(task.startDay, task.durationDays);
  const bar = document.createElement('div');
  bar.className = 'task-bar';
  bar.dataset.taskId = task.id;
  bar.style.left = pos.left + 'px';
  bar.style.width = pos.width + 'px';
  bar.style.top = ((task._lane || 0) * laneHeight + 4) + 'px';
  bar.style.backgroundColor = task.color;
  bar.style.color = getContrastColor(task.color);
  bar.style.setProperty('--bar-color', task.color);

  const startDateStr = _formatDateReadable(year, task.startDay || 0);
  const endDateStr = _formatDateReadable(year, (task.startDay || 0) + (task.durationDays || 1) - 1);
  let tooltip = task.label + '\n' + startDateStr + (task.durationDays > 1 ? ' – ' + endDateStr : '');
  if (task.deadline) tooltip += '\nDeadline: ' + task.deadline;
  bar.title = tooltip;

  if (pos.width < 40) bar.classList.add('task-bar-compact');

  // Expand toggle for tasks with children
  const hasChildren = proj && proj.tasks.some(t => t.parentId === task.id);
  if (hasChildren) {
    const toggle = document.createElement('span');
    toggle.className = 'task-expand-toggle';
    toggle.textContent = task.expanded ? '\u25BE' : '\u25B8';
    toggle.addEventListener('click', (e) => {
      e.stopPropagation();
      Store.toggleTaskExpanded(task.id);
      document.dispatchEvent(new Event('mareo:render'));
    });
    toggle.addEventListener('pointerdown', (e) => e.stopPropagation());
    bar.appendChild(toggle);
  }

  const label = document.createElement('span');
  label.className = 'task-label';
  label.textContent = task.label;
  bar.appendChild(label);

  const resizeHandleLeft = document.createElement('div');
  resizeHandleLeft.className = 'resize-handle resize-handle-left';
  bar.appendChild(resizeHandleLeft);

  const resizeHandle = document.createElement('div');
  resizeHandle.className = 'resize-handle resize-handle-right';
  bar.appendChild(resizeHandle);

  bar.addEventListener('click', (e) => {
    if (e.target.classList.contains('resize-handle')) return;
    e.stopPropagation();
    showTaskPopover(e, task);
  });

  bar.addEventListener('dblclick', (e) => {
    e.stopPropagation();
    closeAllPopovers();
    showEditTaskModal(task);
  });

  bar.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    e.stopPropagation();
    showTaskContextMenu(e, task);
  });

  return bar;
}

function layoutTasks(tasks) {
  const sorted = [...tasks].sort((a, b) => (a.startDay || 0) - (b.startDay || 0));
  const lanes = [];

  for (const task of sorted) {
    const start = task.startDay || 0;
    const dur = task.durationDays || 7;
    const laneStart = start;
    const laneEnd = start + dur;
    let placed = false;
    for (let i = 0; i < lanes.length; i++) {
      if (laneStart >= lanes[i]) {
        lanes[i] = laneEnd;
        task._lane = i;
        placed = true;
        break;
      }
    }
    if (!placed) {
      task._lane = lanes.length;
      lanes.push(laneEnd);
    }
  }

  return { tasks: sorted, laneCount: lanes.length };
}

const _monthNames = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

function _formatDateReadable(year, doy) {
  const d = new Date(year, 0, 1);
  d.setDate(d.getDate() + doy);
  return _monthNames[d.getMonth()] + ' ' + d.getDate();
}

function _doyToDateStr(year, doy) {
  const d = new Date(year, 0, 1);
  d.setDate(d.getDate() + doy);
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mm}-${dd}`;
}

function _dateStrToDoy(year, dateStr) {
  const parts = dateStr.split('-');
  const d = new Date(parseInt(parts[0]), parseInt(parts[1]) - 1, parseInt(parts[2]));
  const jan1 = new Date(year, 0, 1);
  return Math.floor((d - jan1) / 86400000);
}

function showEditTaskModal(task) {
  const year = Store.data.currentYear;
  const dateStr = _doyToDateStr(year, task.startDay || 0);
  showModal({
    title: 'Edit Task',
    fields: [
      { name: 'label', label: 'Label', type: 'text', value: task.label },
      { name: 'startDate', label: 'Start Date', type: 'date', value: dateStr },
      { name: 'durationDays', label: 'Duration (days)', type: 'number', value: task.durationDays || 7, min: 1, max: 366 },
      { name: 'deadline', label: 'Deadline', type: 'date', value: task.deadline || '' },
      { name: 'color', label: 'Color', type: 'color', value: task.color }
    ],
    onSave: (values) => {
      Store.updateTask(task.id, {
        label: values.label.trim() || task.label,
        startDay: _dateStrToDoy(year, values.startDate),
        durationDays: parseInt(values.durationDays),
        deadline: values.deadline || null,
        color: values.color
      });
      document.dispatchEvent(new Event('mareo:render'));
    },
    onDelete: () => {
      Store.removeTask(task.id);
      document.dispatchEvent(new Event('mareo:render'));
    }
  });
}

function showTaskContextMenu(e, task) {
  document.querySelectorAll('.context-menu').forEach(m => m.remove());
  const menu = document.createElement('div');
  menu.className = 'context-menu';
  const depth = Store.getTaskDepth(task.id);
  const hasChildren = Store._findProjectForTask(task.id)?.tasks.some(t => t.parentId === task.id);
  const showAddSub = depth < 5;
  menu.innerHTML = `
    <div class="context-menu-item" data-action="edit">Edit Task</div>
    ${showAddSub ? '<div class="context-menu-item" data-action="add-subtask">Add Subtask</div>' : ''}
    <div class="context-menu-item" data-action="notes">Notes</div>
    <div class="context-menu-item" data-action="links">Links</div>
    <div class="context-menu-item context-menu-deadline">
      <label>Deadline</label>
      <input type="date" class="context-menu-date" value="${task.deadline || ''}">
    </div>
    <div class="context-menu-item danger" data-action="delete">Delete${hasChildren ? ' (+ subtasks)' : ''}</div>
  `;
  menu.style.position = 'fixed';
  menu.style.left = e.clientX + 'px';
  menu.style.top = e.clientY + 'px';
  menu.style.zIndex = '10000';

  const deadlineInput = menu.querySelector('.context-menu-date');
  deadlineInput.addEventListener('change', () => {
    Store.updateTask(task.id, { deadline: deadlineInput.value || null });
    document.dispatchEvent(new Event('mareo:render'));
  });
  deadlineInput.addEventListener('click', (ev) => ev.stopPropagation());

  menu.addEventListener('click', (ev) => {
    const action = ev.target.dataset.action;
    if (!action) return;
    if (action === 'edit') {
      showEditTaskModal(task);
    } else if (action === 'add-subtask') {
      const proj = Store._findProjectForTask(task.id);
      if (proj) {
        // Auto-expand the task and project to show the new subtask row
        if (!task.expanded) Store.updateTask(task.id, { expanded: true });
        const p = Store._findProject(proj.id);
        if (p && !p.notesExpanded) Store.updateProject(proj.id, { notesExpanded: true });
        createTaskInline(proj.id, task.startDay, task.id);
      }
    } else if (action === 'notes') {
      menu.remove();
      showTaskPopover(e, task);
      return;
    } else if (action === 'links') {
      menu.remove();
      showTaskPopover(e, task);
      return;
    } else if (action === 'delete') {
      Store.removeTask(task.id);
      document.dispatchEvent(new Event('mareo:render'));
    }
    menu.remove();
  });

  document.body.appendChild(menu);
  setTimeout(() => {
    document.addEventListener('click', () => menu.remove(), { once: true });
  });
}

function getContrastColor(hex) {
  if (!hex || hex[0] !== '#') return '#000';
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.5 ? '#000' : '#fff';
}
