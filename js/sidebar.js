import { Store } from './store.js';
import { showModal } from './modal.js';

let onProjectClick = null;

export function setSidebarProjectClickHandler(handler) {
  onProjectClick = handler;
}

export function renderSidebar(container) {
  container.innerHTML = '';
  const layout = Store.getRenderedLayout();

  if (Store.data.categories.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'empty-state';
    empty.textContent = 'Start by creating your first project category';
    container.appendChild(empty);
  }

  for (const item of layout) {
    if (item.type === 'pinned-header') {
      const header = document.createElement('div');
      header.className = 'sidebar-category pinned-section-header';
      header.innerHTML = `<span class="cat-name">📌 PINNED</span>`;
      container.appendChild(header);

    } else if (item.type === 'category-header') {
      const cat = item.cat;
      const catHeader = document.createElement('div');
      catHeader.className = 'sidebar-category';
      catHeader.innerHTML = `
        <span class="cat-toggle">${cat.collapsed ? '▶' : '▼'}</span>
        <span class="cat-name">${cat.name}</span>
        <button class="btn-icon cat-menu-btn" title="Category options">⋯</button>
      `;

      catHeader.querySelector('.cat-toggle').addEventListener('click', () => {
        Store.toggleCollapse(cat.id);
        document.dispatchEvent(new Event('mareo:render'));
      });
      catHeader.querySelector('.cat-name').addEventListener('click', () => {
        Store.toggleCollapse(cat.id);
        document.dispatchEvent(new Event('mareo:render'));
      });
      catHeader.querySelector('.cat-menu-btn').addEventListener('click', (e) => {
        e.stopPropagation();
        showCategoryMenu(e, cat);
      });
      container.appendChild(catHeader);

    } else if (item.type === 'project') {
      container.appendChild(renderProjectRow(item.proj, item.cat, item.pinned));

    } else if (item.type === 'task-children') {
      const { proj, parentTask, depth } = item;
      const children = proj.tasks.filter(t => t.parentId === parentTask.id);
      const groupRow = document.createElement('div');
      groupRow.className = `sidebar-subtask-group depth-${depth}`;
      groupRow.style.marginLeft = (12 + depth * 8) + 'px';

      const header = document.createElement('div');
      header.className = 'subtask-group-header';
      const dot = document.createElement('span');
      dot.className = 'detail-task-dot';
      dot.style.backgroundColor = parentTask.color;
      header.appendChild(dot);
      const headerText = document.createElement('span');
      headerText.textContent = (parentTask.label || 'Untitled') + ' subtasks';
      header.appendChild(headerText);
      groupRow.appendChild(header);

      for (const task of children) {
        const taskItem = document.createElement('div');
        taskItem.className = 'detail-task-item';

        const childDot = document.createElement('span');
        childDot.className = 'detail-task-dot';
        childDot.style.backgroundColor = task.color;
        taskItem.appendChild(childDot);

        const hasGrandchildren = proj.tasks.some(t => t.parentId === task.id);
        if (hasGrandchildren) {
          const toggle = document.createElement('span');
          toggle.className = 'subtask-toggle';
          toggle.textContent = task.expanded ? '\u25BC' : '\u25B6';
          toggle.addEventListener('click', (e) => {
            e.stopPropagation();
            Store.toggleTaskExpanded(task.id);
            document.dispatchEvent(new Event('mareo:render'));
          });
          taskItem.appendChild(toggle);
        }

        const nameEl = document.createElement('span');
        nameEl.className = 'detail-task-name';
        nameEl.textContent = task.label || 'Untitled';
        taskItem.appendChild(nameEl);

        const delBtn = document.createElement('button');
        delBtn.className = 'btn-icon note-preview-delete';
        delBtn.textContent = '\u2715';
        delBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          Store.removeTask(task.id);
          document.dispatchEvent(new Event('mareo:render'));
        });
        taskItem.appendChild(delBtn);

        groupRow.appendChild(taskItem);
      }

      if (depth < 5) {
        const addBtn = document.createElement('div');
        addBtn.className = 'note-preview-add';
        addBtn.textContent = '+ Subtask';
        addBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          showAddTaskModal(proj.id, parentTask.startDay || 0, parentTask.id);
        });
        groupRow.appendChild(addBtn);
      }

      container.appendChild(groupRow);

    } else if (item.type === 'add-project') {
      const addProjBtn = document.createElement('div');
      addProjBtn.className = 'sidebar-add-project';
      addProjBtn.textContent = '+ Add Project';
      addProjBtn.addEventListener('click', () => {
        showAddProjectModal(item.cat.id);
      });
      container.appendChild(addProjBtn);

    } else if (item.type === 'add-category') {
      const addCatBtn = document.createElement('div');
      addCatBtn.className = 'sidebar-add-category';
      addCatBtn.textContent = '+ Add Category';
      addCatBtn.addEventListener('click', () => {
        showAddCategoryModal();
      });
      container.appendChild(addCatBtn);
    }
  }

  initSidebarDragDrop(container);
}

function renderProjectRow(proj, cat, pinned) {
  const projRow = document.createElement('div');
  projRow.className = 'sidebar-project' + (pinned ? ' pinned' : '');
  projRow.dataset.projectId = proj.id;
  projRow.dataset.categoryId = cat.id;
  projRow.dataset.pinned = pinned ? '1' : '0';
  projRow.draggable = true;

  const header = document.createElement('div');
  header.className = 'sidebar-project-header';

  // Drag handle
  const grip = document.createElement('span');
  grip.className = 'drag-handle';
  grip.textContent = '⠿';
  header.appendChild(grip);

  const notes = proj.projectNotes || [];
  const hasNotes = notes.length > 0;
  const expanded = !!proj.notesExpanded;

  const toggle = document.createElement('span');
  toggle.className = 'proj-notes-toggle';
  toggle.textContent = expanded ? '▼' : '▶';
  toggle.addEventListener('click', (e) => {
    e.stopPropagation();
    Store.updateProject(proj.id, { notesExpanded: !expanded });
    document.dispatchEvent(new Event('mareo:render'));
  });
  header.appendChild(toggle);

  const nameEl = document.createElement('span');
  nameEl.className = 'project-name';
  nameEl.style.backgroundColor = proj.color;
  nameEl.style.color = getContrastColor(proj.color);
  nameEl.textContent = proj.name;
  nameEl.addEventListener('click', (e) => {
    e.stopPropagation();
    if (onProjectClick) onProjectClick(e, proj);
  });

  const isPinned = Store.isProjectPinned(proj.id);
  const pinBtn = document.createElement('button');
  pinBtn.className = 'btn-icon proj-pin-btn' + (isPinned ? ' pinned' : '');
  pinBtn.title = isPinned ? 'Unpin' : 'Pin to top';
  pinBtn.innerHTML = '<svg width="10" height="10" viewBox="0 0 16 16" fill="currentColor"><path d="M9.828.722a.5.5 0 0 1 .354.146l4.95 4.95a.5.5 0 0 1-.707.707l-.71-.71-3.18 3.18a3.5 3.5 0 0 1-.4.3L11 11.07l.71.71a.5.5 0 0 1-.708.707l-2.83-2.83-3.54 3.54a.5.5 0 0 1-.707-.708l3.54-3.54-2.83-2.83a.5.5 0 1 1 .707-.707l.71.71.78-.86a3.5 3.5 0 0 1 .3-.4l3.18-3.18-.71-.71a.5.5 0 0 1 .146-.354z"/></svg>';
  pinBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (isPinned) Store.unpinProject(proj.id);
    else Store.pinProject(proj.id);
    document.dispatchEvent(new Event('mareo:render'));
  });

  const menuBtn = document.createElement('button');
  menuBtn.className = 'btn-icon proj-menu-btn';
  menuBtn.title = 'Project options';
  menuBtn.textContent = '⋯';
  menuBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    showProjectMenu(e, proj, cat);
  });

  header.appendChild(nameEl);
  header.appendChild(pinBtn);
  header.appendChild(menuBtn);
  projRow.appendChild(header);

  // Notes preview (last 3 notes with checkboxes + add button)
  if (expanded) {
    const preview = document.createElement('div');
    preview.className = 'project-notes-preview';

    for (let i = 0; i < notes.length; i++) {
      const note = notes[i];
      const noteItem = document.createElement('div');
      const depth = Math.min(1, Math.max(0, note.depth || 0));
      noteItem.className = 'note-preview-item'
        + (note.done ? ' done' : '')
        + (depth > 0 ? ' indented' : '');
      noteItem.draggable = true;
      noteItem.dataset.noteId = note.id;
      noteItem.dataset.depth = String(depth);

      const grip = document.createElement('span');
      grip.className = 'note-drag-grip';
      grip.textContent = '⠿';

      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.className = 'note-preview-check';
      checkbox.checked = !!note.done;
      checkbox.addEventListener('change', (e) => {
        e.stopPropagation();
        Store.updateProjectNote(proj.id, note.id, { done: checkbox.checked });
        document.dispatchEvent(new Event('mareo:render'));
      });

      const textInput = document.createElement('input');
      textInput.type = 'text';
      textInput.className = 'note-preview-text';
      textInput.value = note.title || note.content || '';
      textInput.placeholder = 'Note...';
      textInput.dataset.noteId = note.id;
      textInput.addEventListener('change', () => {
        Store.updateProjectNote(proj.id, note.id, { title: textInput.value });
      });
      textInput.addEventListener('focus', () => { noteItem.draggable = false; });
      textInput.addEventListener('blur', () => { noteItem.draggable = true; });
      textInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          Store.updateProjectNote(proj.id, note.id, { title: textInput.value });
          const newNote = Store.addProjectNoteAfter(proj.id, note.id, { title: '', content: '' });
          document.dispatchEvent(new Event('mareo:render'));
          requestAnimationFrame(() => {
            const newInput = document.querySelector(`.note-preview-text[data-note-id="${newNote.id}"]`);
            if (newInput) newInput.focus();
          });
        } else if (e.key === 'Tab') {
          e.preventDefault();
          Store.updateProjectNote(proj.id, note.id, { title: textInput.value });
          if (e.shiftKey) Store.outdentProjectNote(proj.id, note.id);
          else            Store.indentProjectNote(proj.id, note.id);
          document.dispatchEvent(new Event('mareo:render'));
          requestAnimationFrame(() => {
            const sameInput = document.querySelector(`.note-preview-text[data-note-id="${note.id}"]`);
            if (sameInput) sameInput.focus();
          });
        } else if (e.key === 'Backspace' && textInput.value === '') {
          e.preventDefault();
          const notes = proj.projectNotes || [];
          const idx = notes.findIndex(n => n.id === note.id);
          const prev = idx > 0 ? notes[idx - 1] : null;
          Store.removeProjectNote(proj.id, note.id);
          document.dispatchEvent(new Event('mareo:render'));
          if (prev) {
            requestAnimationFrame(() => {
              const prevInput = document.querySelector(`.note-preview-text[data-note-id="${prev.id}"]`);
              if (prevInput) { prevInput.focus(); prevInput.select(); }
            });
          }
        }
      });

      const delBtn = document.createElement('button');
      delBtn.className = 'btn-icon note-preview-delete';
      delBtn.textContent = '✕';
      delBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        Store.removeProjectNote(proj.id, note.id);
        document.dispatchEvent(new Event('mareo:render'));
      });

      noteItem.appendChild(grip);
      noteItem.appendChild(checkbox);
      noteItem.appendChild(textInput);
      noteItem.appendChild(delBtn);
      preview.appendChild(noteItem);
    }

    // Note drag reorder within preview
    let dragNoteId = null;
    preview.addEventListener('dragstart', (e) => {
      const item = e.target.closest('.note-preview-item');
      if (!item) return;
      dragNoteId = item.dataset.noteId;
      item.classList.add('dragging');
      e.stopPropagation();
    });
    preview.addEventListener('dragend', (e) => {
      const item = e.target.closest('.note-preview-item');
      if (item) item.classList.remove('dragging');
      preview.querySelectorAll('.note-preview-item').forEach(n => n.classList.remove('drag-over'));
      dragNoteId = null;
    });
    preview.addEventListener('dragover', (e) => {
      const item = e.target.closest('.note-preview-item');
      if (!item || item.dataset.noteId === dragNoteId) return;
      e.preventDefault();
      e.stopPropagation();
      preview.querySelectorAll('.note-preview-item').forEach(n => n.classList.remove('drag-over'));
      item.classList.add('drag-over');
    });
    preview.addEventListener('drop', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const item = e.target.closest('.note-preview-item');
      if (!item || item.dataset.noteId === dragNoteId || !dragNoteId) return;
      const allNotes = proj.projectNotes || [];
      const fromIdx = allNotes.findIndex(n => n.id === dragNoteId);
      const toIdx = allNotes.findIndex(n => n.id === item.dataset.noteId);
      if (fromIdx < 0 || toIdx < 0) return;
      const [moved] = allNotes.splice(fromIdx, 1);
      allNotes.splice(toIdx, 0, moved);
      Store.save();
      document.dispatchEvent(new Event('mareo:render'));
    });

    // Add note button
    const addBtn = document.createElement('div');
    addBtn.className = 'note-preview-add';
    addBtn.textContent = '+ Note';
    addBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      Store.addProjectNote(proj.id, { title: '', content: '' });
      document.dispatchEvent(new Event('mareo:render'));
    });
    preview.appendChild(addBtn);

    projRow.appendChild(preview);
  }

  return projRow;
}

function initSidebarDragDrop(container) {
  let draggedId = null;
  let draggedPinned = false;
  let draggedCatId = null;

  container.addEventListener('dragstart', (e) => {
    const row = e.target.closest('.sidebar-project');
    if (!row) return;
    draggedId = row.dataset.projectId;
    draggedPinned = row.dataset.pinned === '1';
    draggedCatId = row.dataset.categoryId;
    row.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
  });

  container.addEventListener('dragend', (e) => {
    const row = e.target.closest('.sidebar-project');
    if (row) row.classList.remove('dragging');
    container.querySelectorAll('.sidebar-project').forEach(r => r.classList.remove('drag-over'));
    draggedId = null;
    draggedCatId = null;
  });

  container.addEventListener('dragover', (e) => {
    const row = e.target.closest('.sidebar-project');
    if (!row || row.dataset.projectId === draggedId) return;

    const targetPinned = row.dataset.pinned === '1';
    // Pinned can only reorder among pinned
    if (draggedPinned !== targetPinned) return;

    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    container.querySelectorAll('.sidebar-project').forEach(r => r.classList.remove('drag-over'));
    row.classList.add('drag-over');
  });

  container.addEventListener('drop', (e) => {
    e.preventDefault();
    const row = e.target.closest('.sidebar-project');
    if (!row || row.dataset.projectId === draggedId) return;

    const targetId = row.dataset.projectId;
    const targetCatId = row.dataset.categoryId;

    if (draggedPinned) {
      // Reorder within pinned
      const pinned = [...Store.data.pinnedProjects];
      const fromIdx = pinned.indexOf(draggedId);
      const toIdx = pinned.indexOf(targetId);
      if (fromIdx < 0 || toIdx < 0) return;
      pinned.splice(fromIdx, 1);
      pinned.splice(toIdx, 0, draggedId);
      Store.reorderPinnedProjects(pinned);
    } else if (draggedCatId === targetCatId) {
      // Reorder within same category
      const targetActualIdx = Store._findCategory(targetCatId).projects.findIndex(p => p.id === targetId);
      Store.reorderProject(targetCatId, draggedId, targetActualIdx);
    } else {
      // Move to different category
      const targetActualIdx = Store._findCategory(targetCatId).projects.findIndex(p => p.id === targetId);
      Store.moveProjectToCategory(draggedId, draggedCatId, targetCatId, targetActualIdx);
    }

    document.dispatchEvent(new Event('mareo:render'));
  });
}

function showCategoryMenu(e, cat) {
  closeAllMenus();
  const menu = document.createElement('div');
  menu.className = 'context-menu';

  menu.innerHTML = `
    <div class="context-menu-item" data-action="rename">Rename</div>
    <div class="context-menu-item danger" data-action="delete">Delete</div>
  `;

  menu.addEventListener('click', (ev) => {
    const action = ev.target.dataset.action;
    if (action === 'rename') {
      showRenameCategoryModal(cat);
    } else if (action === 'delete') {
      if (confirm(`Delete category "${cat.name}" and all its projects?`)) {
        Store.removeCategory(cat.id);
        document.dispatchEvent(new Event('mareo:render'));
      }
    }
    menu.remove();
  });

  positionMenu(menu, e.target);
  document.body.appendChild(menu);
  setTimeout(() => {
    document.addEventListener('click', () => menu.remove(), { once: true });
  });
}

function showProjectMenu(e, proj, cat) {
  closeAllMenus();
  const menu = document.createElement('div');
  menu.className = 'context-menu';
  menu.innerHTML = `
    <div class="context-menu-item" data-action="edit">Edit Project</div>
    <div class="context-menu-item" data-action="addtask">Add Task</div>
    <div class="context-menu-item" data-action="expand-subcal">Show Sub-calendar</div>
    <div class="context-menu-item danger" data-action="delete">Delete Project</div>
  `;

  menu.addEventListener('click', (ev) => {
    const action = ev.target.dataset.action;
    if (action === 'edit') {
      showEditProjectModal(proj);
    } else if (action === 'addtask') {
      showAddTaskModal(proj.id, 0);
    } else if (action === 'expand-subcal') {
      Store.updateProject(proj.id, { notesExpanded: !proj.notesExpanded });
      document.dispatchEvent(new Event('mareo:render'));
    } else if (action === 'delete') {
      if (confirm(`Delete project "${proj.name}"?`)) {
        Store.removeProject(proj.id);
        document.dispatchEvent(new Event('mareo:render'));
      }
    }
    menu.remove();
  });

  positionMenu(menu, e.target);
  document.body.appendChild(menu);
  setTimeout(() => {
    document.addEventListener('click', () => menu.remove(), { once: true });
  });
}

function showAddCategoryModal() {
  showModal({
    title: 'Add Category',
    fields: [
      { name: 'name', label: 'Name', type: 'text', value: '' }
    ],
    onSave: (values) => {
      if (values.name.trim()) {
        Store.addCategory(values.name.trim().toUpperCase());
        document.dispatchEvent(new Event('mareo:render'));
      }
    }
  });
}

function showRenameCategoryModal(cat) {
  showModal({
    title: 'Rename Category',
    fields: [
      { name: 'name', label: 'Name', type: 'text', value: cat.name }
    ],
    onSave: (values) => {
      if (values.name.trim()) {
        Store.renameCategory(cat.id, values.name.trim().toUpperCase());
        document.dispatchEvent(new Event('mareo:render'));
      }
    }
  });
}

function showAddProjectModal(categoryId) {
  showModal({
    title: 'Add Project',
    fields: [
      { name: 'name', label: 'Name', type: 'text', value: '' },
      { name: 'color', label: 'Color', type: 'color', value: '#bdc3c7' }
    ],
    onSave: (values) => {
      if (values.name.trim()) {
        Store.addProject(categoryId, values.name.trim(), values.color);
        document.dispatchEvent(new Event('mareo:render'));
      }
    }
  });
}

function showEditProjectModal(proj) {
  showModal({
    title: 'Edit Project',
    fields: [
      { name: 'name', label: 'Name', type: 'text', value: proj.name },
      { name: 'color', label: 'Color', type: 'color', value: proj.color }
    ],
    onSave: (values) => {
      Store.updateProject(proj.id, {
        name: values.name.trim() || proj.name,
        color: values.color
      });
      document.dispatchEvent(new Event('mareo:render'));
    }
  });
}

export function showAddTaskModal(projectId, startDay, parentId) {
  const proj = Store._findProject(projectId);
  const parentTask = parentId ? Store._findTask(parentId) : null;
  const year = Store.data.currentYear;
  const dateStr = _doyToDateStr(year, startDay != null ? startDay : 0);
  const isSubtask = !!parentId;
  const defaultColor = parentTask ? _lightenColor(parentTask.color, 0.2) : (proj ? proj.color : '#bdc3c7');
  const depth = parentTask ? Store.getTaskDepth(parentTask.id) + 1 : 0;
  showModal({
    title: isSubtask ? 'Add Subtask' : 'Add Task',
    fields: [
      { name: 'label', label: 'Label', type: 'text', value: '' },
      { name: 'startDate', label: 'Start Date', type: 'date', value: dateStr },
      { name: 'durationDays', label: 'Duration (days)', type: 'number', value: Math.max(2, 7 - depth * 2), min: 1, max: 366 },
      { name: 'color', label: 'Color', type: 'color', value: defaultColor }
    ],
    onSave: (values) => {
      Store.addTask(projectId, {
        label: values.label.trim() || 'New Task',
        startDay: _dateStrToDoy(year, values.startDate),
        durationDays: parseInt(values.durationDays),
        color: values.color,
        parentId: parentId || null
      });
      document.dispatchEvent(new Event('mareo:render'));
    }
  });
}

function _lightenColor(hex, amount) {
  if (!hex || hex[0] !== '#') return '#aaaaaa';
  let r = parseInt(hex.slice(1, 3), 16);
  let g = parseInt(hex.slice(3, 5), 16);
  let b = parseInt(hex.slice(5, 7), 16);
  r = Math.round(r + (255 - r) * amount);
  g = Math.round(g + (255 - g) * amount);
  b = Math.round(b + (255 - b) * amount);
  return '#' + [r, g, b].map(c => c.toString(16).padStart(2, '0')).join('');
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

function closeAllMenus() {
  document.querySelectorAll('.context-menu').forEach(m => m.remove());
  document.querySelectorAll('.project-links-dropdown').forEach(m => m.remove());
}

function positionMenu(menu, target) {
  const rect = target.getBoundingClientRect();
  menu.style.position = 'fixed';
  menu.style.left = rect.right + 'px';
  menu.style.top = rect.top + 'px';
  menu.style.zIndex = '10000';
}

function getContrastColor(hex) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.5 ? '#000' : '#fff';
}
