import { Store } from './store.js';
import { getWeekWidth, getDayWidth, isDayMode, getTotalWeeks, getTotalWidth, taskToPixels, taskToDisplayPixels, getTodayPixelX, getTodayWeekIndex } from './timeline.js';
import { showAddTaskModal } from './sidebar.js';
import { showModal } from './modal.js';

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
      const mainTasks = proj.tasks.filter(t => (t.type || 'main') === 'main');
      const { tasks, laneCount } = layoutTasks(mainTasks);
      const rowHeight = Math.max(1, laneCount) * 36 + 4;

      const projRow = document.createElement('div');
      projRow.className = 'gantt-project-row';
      projRow.dataset.projectId = proj.id;
      projRow.style.width = totalWidth + 'px';
      projRow.style.height = rowHeight + 'px';

      renderGridLines(projRow, dayMode, year, dw, ww, totalWeeks, todayPx, todayWeek);

      for (const task of tasks) {
        projRow.appendChild(createTaskBar(task, 36, year));
      }

      projRow.addEventListener('dblclick', (e) => {
        if (e.target === projRow || e.target.classList.contains('gantt-grid-line')) {
          const rect = projRow.getBoundingClientRect();
          const x = e.clientX - rect.left + projRow.parentElement.scrollLeft;
          const day = Math.floor(x / dw);
          showAddTaskModal(proj.id, day);
        }
      });

      container.appendChild(projRow);

    } else if (item.type === 'detail-tasks') {
      const proj = item.proj;
      const detailTasks = proj.tasks.filter(t => t.type === 'detail');
      const { tasks: dtSorted, laneCount: dtLanes } = layoutTasks(detailTasks);
      const dtRowHeight = Math.max(1, dtLanes) * 30 + 4;

      const detailRow = document.createElement('div');
      detailRow.className = 'gantt-project-row gantt-detail-row';
      detailRow.dataset.projectId = proj.id;
      detailRow.dataset.rowType = 'detail';
      detailRow.style.width = totalWidth + 'px';
      detailRow.style.height = dtRowHeight + 'px';

      renderGridLines(detailRow, dayMode, year, dw, ww, totalWeeks, todayPx, todayWeek);

      for (const task of dtSorted) {
        const bar = createTaskBar(task, 30, year);
        bar.classList.add('task-bar-detail');
        detailRow.appendChild(bar);
      }

      detailRow.addEventListener('dblclick', (e) => {
        if (e.target === detailRow || e.target.classList.contains('gantt-grid-line')) {
          const rect = detailRow.getBoundingClientRect();
          const x = e.clientX - rect.left + detailRow.parentElement.scrollLeft;
          const day = Math.floor(x / dw);
          showAddTaskModal(proj.id, day, 'detail');
        }
      });

      container.appendChild(detailRow);

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

function createTaskBar(task, laneHeight, year) {
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
  const taskType = task.type || 'main';
  const toggleLabel = taskType === 'main' ? 'Move to Detail' : 'Move to Main';
  menu.innerHTML = `
    <div class="context-menu-item" data-action="edit">Edit Task</div>
    <div class="context-menu-item" data-action="toggle-type">${toggleLabel}</div>
    <div class="context-menu-item" data-action="notes">Notes</div>
    <div class="context-menu-item" data-action="links">Links</div>
    <div class="context-menu-item context-menu-deadline">
      <label>Deadline</label>
      <input type="date" class="context-menu-date" value="${task.deadline || ''}">
    </div>
    <div class="context-menu-item danger" data-action="delete">Delete Task</div>
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
    } else if (action === 'toggle-type') {
      const newType = (task.type || 'main') === 'main' ? 'detail' : 'main';
      Store.updateTask(task.id, { type: newType });
      document.dispatchEvent(new Event('mareo:render'));
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
