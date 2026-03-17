import { Store } from './store.js';
import { getWeekWidth, getTotalWeeks, getTodayWeekIndex } from './timeline.js';
import { showAddTaskModal } from './sidebar.js';
import { showModal } from './modal.js';

export function renderGantt(container) {
  container.innerHTML = '';
  const weekWidth = getWeekWidth();
  const totalWeeks = getTotalWeeks();
  const totalWidth = totalWeeks * weekWidth;
  const todayWeek = getTodayWeekIndex(Store.data.currentYear);

  if (Store.data.categories.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'empty-state';
    empty.textContent = 'Your timeline is empty — add a category and project to get started';
    container.appendChild(empty);
    return;
  }

  for (const cat of Store.data.categories) {
    // Category spacer row
    const catRow = document.createElement('div');
    catRow.className = 'gantt-category-row';
    catRow.style.width = totalWidth + 'px';
    container.appendChild(catRow);

    if (cat.collapsed) continue;

    for (const proj of cat.projects) {
      const { tasks, laneCount } = layoutTasks(proj.tasks);
      const rowHeight = Math.max(1, laneCount) * 36 + 4;

      const projRow = document.createElement('div');
      projRow.className = 'gantt-project-row';
      projRow.dataset.projectId = proj.id;
      projRow.style.width = totalWidth + 'px';
      projRow.style.height = rowHeight + 'px';

      // Week grid lines + current week highlight
      for (let w = 0; w < totalWeeks; w++) {
        const line = document.createElement('div');
        line.className = 'gantt-grid-line';
        if (w === todayWeek) line.classList.add('current-week-col');
        line.style.left = (w * weekWidth) + 'px';
        line.style.width = weekWidth + 'px';
        projRow.appendChild(line);
      }

      // Task bars
      for (const task of tasks) {
        const bar = document.createElement('div');
        bar.className = 'task-bar';
        bar.dataset.taskId = task.id;
        bar.style.setProperty('--start-week', task.startWeek);
        bar.style.setProperty('--duration', task.durationWeeks);
        bar.style.setProperty('--lane', task._lane || 0);
        bar.style.backgroundColor = task.color;
        bar.style.color = getContrastColor(task.color);

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

        // Left click -> show task popover with notes & links
        bar.addEventListener('click', (e) => {
          if (e.target.classList.contains('resize-handle')) return;
          e.stopPropagation();
          showTaskPopover(e, task);
        });

        // Double-click to edit
        bar.addEventListener('dblclick', (e) => {
          e.stopPropagation();
          closeAllPopovers();
          showEditTaskModal(task);
        });

        // Right-click context menu
        bar.addEventListener('contextmenu', (e) => {
          e.preventDefault();
          e.stopPropagation();
          showTaskContextMenu(e, task);
        });

        projRow.appendChild(bar);
      }

      // Double-click on empty area to add task
      projRow.addEventListener('dblclick', (e) => {
        if (e.target === projRow || e.target.classList.contains('gantt-grid-line')) {
          const rect = projRow.getBoundingClientRect();
          const x = e.clientX - rect.left + projRow.parentElement.scrollLeft;
          const week = Math.floor(x / weekWidth);
          showAddTaskModal(proj.id, week);
        }
      });

      container.appendChild(projRow);
    }

    // Add project spacer
    const addRow = document.createElement('div');
    addRow.className = 'gantt-add-row';
    addRow.style.width = totalWidth + 'px';
    container.appendChild(addRow);
  }

  // Add category spacer
  const addCatRow = document.createElement('div');
  addCatRow.className = 'gantt-add-row';
  addCatRow.style.width = totalWidth + 'px';
  container.appendChild(addCatRow);

  // Today marker
  if (todayWeek >= 0) {
    const marker = document.createElement('div');
    marker.className = 'today-marker';
    marker.style.left = ((todayWeek + 0.5) * weekWidth) + 'px';
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
  deleteBtn.textContent = '✕';
  deleteBtn.title = 'Delete task';
  deleteBtn.addEventListener('click', (ev) => {
    ev.stopPropagation();
    if (confirm(`Delete task "${task.label}"?`)) {
      popover.remove();
      Store.removeTask(task.id);
      document.dispatchEvent(new Event('mareo:render'));
    }
  });

  actions.appendChild(editBtn);
  actions.appendChild(deleteBtn);
  header.appendChild(actions);
  popover.appendChild(header);

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

function layoutTasks(tasks) {
  const sorted = [...tasks].sort((a, b) => a.startWeek - b.startWeek);
  const lanes = [];

  for (const task of sorted) {
    let placed = false;
    for (let i = 0; i < lanes.length; i++) {
      if (task.startWeek >= lanes[i]) {
        lanes[i] = task.startWeek + task.durationWeeks;
        task._lane = i;
        placed = true;
        break;
      }
    }
    if (!placed) {
      task._lane = lanes.length;
      lanes.push(task.startWeek + task.durationWeeks);
    }
  }

  return { tasks: sorted, laneCount: lanes.length };
}

function showEditTaskModal(task) {
  showModal({
    title: 'Edit Task',
    fields: [
      { name: 'label', label: 'Label', type: 'text', value: task.label },
      { name: 'startWeek', label: 'Start Week (1-53)', type: 'number', value: task.startWeek + 1, min: 1, max: 53 },
      { name: 'durationWeeks', label: 'Duration (weeks)', type: 'number', value: task.durationWeeks, min: 1, max: 52 },
      { name: 'color', label: 'Color', type: 'color', value: task.color }
    ],
    onSave: (values) => {
      Store.updateTask(task.id, {
        label: values.label.trim() || task.label,
        startWeek: parseInt(values.startWeek) - 1,
        durationWeeks: parseInt(values.durationWeeks),
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
  menu.innerHTML = `
    <div class="context-menu-item" data-action="edit">Edit Task</div>
    <div class="context-menu-item" data-action="notes">Notes</div>
    <div class="context-menu-item" data-action="links">Links</div>
    <div class="context-menu-item danger" data-action="delete">Delete Task</div>
  `;
  menu.style.position = 'fixed';
  menu.style.left = e.clientX + 'px';
  menu.style.top = e.clientY + 'px';
  menu.style.zIndex = '10000';

  menu.addEventListener('click', (ev) => {
    const action = ev.target.dataset.action;
    if (action === 'edit') {
      showEditTaskModal(task);
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
