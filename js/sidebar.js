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

  if (hasNotes) {
    const toggle = document.createElement('span');
    toggle.className = 'proj-notes-toggle';
    toggle.textContent = expanded ? '▼' : '▶';
    toggle.addEventListener('click', (e) => {
      e.stopPropagation();
      Store.updateProject(proj.id, { notesExpanded: !expanded });
      document.dispatchEvent(new Event('mareo:render'));
    });
    header.appendChild(toggle);
  }

  const nameEl = document.createElement('span');
  nameEl.className = 'project-name';
  nameEl.style.backgroundColor = proj.color;
  nameEl.style.color = getContrastColor(proj.color);
  nameEl.textContent = proj.name;
  nameEl.addEventListener('click', (e) => {
    e.stopPropagation();
    if (onProjectClick) onProjectClick(e, proj);
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
  header.appendChild(menuBtn);
  projRow.appendChild(header);

  // Notes preview (last 3 notes with checkboxes)
  if (hasNotes && expanded) {
    const preview = document.createElement('div');
    preview.className = 'project-notes-preview';
    for (const note of notes.slice(0, 3)) {
      const noteItem = document.createElement('label');
      noteItem.className = 'note-preview-item' + (note.done ? ' done' : '');

      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.className = 'note-preview-check';
      checkbox.checked = !!note.done;
      checkbox.addEventListener('change', (e) => {
        e.stopPropagation();
        Store.updateProjectNote(proj.id, note.id, { done: checkbox.checked });
        document.dispatchEvent(new Event('mareo:render'));
      });

      const text = document.createElement('span');
      text.className = 'note-preview-text';
      text.textContent = note.title || note.content || 'Untitled';

      noteItem.appendChild(checkbox);
      noteItem.appendChild(text);
      preview.appendChild(noteItem);
    }
    projRow.appendChild(preview);
  }

  return projRow;
}

function initSidebarDragDrop(container) {
  let draggedId = null;
  let draggedPinned = false;

  container.addEventListener('dragstart', (e) => {
    const row = e.target.closest('.sidebar-project');
    if (!row) return;
    draggedId = row.dataset.projectId;
    draggedPinned = row.dataset.pinned === '1';
    row.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
  });

  container.addEventListener('dragend', (e) => {
    const row = e.target.closest('.sidebar-project');
    if (row) row.classList.remove('dragging');
    container.querySelectorAll('.sidebar-project').forEach(r => r.classList.remove('drag-over'));
    draggedId = null;
  });

  container.addEventListener('dragover', (e) => {
    const row = e.target.closest('.sidebar-project');
    if (!row || row.dataset.projectId === draggedId) return;

    // Only allow drop in same zone (pinned↔pinned or same category)
    const targetPinned = row.dataset.pinned === '1';
    if (draggedPinned !== targetPinned) {
      if (!draggedPinned && !targetPinned && row.dataset.categoryId !== document.querySelector(`.sidebar-project[data-project-id="${draggedId}"]`)?.dataset.categoryId) return;
      if (draggedPinned !== targetPinned) return;
    }
    if (!draggedPinned && !targetPinned) {
      const draggedRow = container.querySelector(`.sidebar-project[data-project-id="${draggedId}"]`);
      if (draggedRow && draggedRow.dataset.categoryId !== row.dataset.categoryId) return;
    }

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

    if (draggedPinned) {
      // Reorder within pinned
      const pinned = [...Store.data.pinnedProjects];
      const fromIdx = pinned.indexOf(draggedId);
      const toIdx = pinned.indexOf(targetId);
      if (fromIdx < 0 || toIdx < 0) return;
      pinned.splice(fromIdx, 1);
      pinned.splice(toIdx, 0, draggedId);
      Store.reorderPinnedProjects(pinned);
    } else {
      // Reorder within category
      const catId = row.dataset.categoryId;
      const cat = Store._findCategory(catId);
      if (!cat) return;
      const unpinnedProjects = cat.projects.filter(p => !Store.isProjectPinned(p.id));
      const targetUnpinnedIdx = unpinnedProjects.findIndex(p => p.id === targetId);
      // Find actual target index in cat.projects
      const targetActualIdx = cat.projects.findIndex(p => p.id === targetId);
      Store.reorderProject(catId, draggedId, targetActualIdx);
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
  const isPinned = Store.isProjectPinned(proj.id);

  menu.innerHTML = `
    <div class="context-menu-item" data-action="pin">${isPinned ? '📌 Unpin' : '📌 Pin to Top'}</div>
    <div class="context-menu-item" data-action="edit">Edit Project</div>
    <div class="context-menu-item" data-action="addtask">Add Task</div>
    <div class="context-menu-item danger" data-action="delete">Delete Project</div>
  `;

  menu.addEventListener('click', (ev) => {
    const action = ev.target.dataset.action;
    if (action === 'pin') {
      if (isPinned) Store.unpinProject(proj.id);
      else Store.pinProject(proj.id);
      document.dispatchEvent(new Event('mareo:render'));
    } else if (action === 'edit') {
      showEditProjectModal(proj);
    } else if (action === 'addtask') {
      showAddTaskModal(proj.id);
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

export function showAddTaskModal(projectId, startWeek) {
  const proj = Store._findProject(projectId);
  showModal({
    title: 'Add Task',
    fields: [
      { name: 'label', label: 'Label', type: 'text', value: '' },
      { name: 'startWeek', label: 'Start Week (1-53)', type: 'number', value: startWeek != null ? startWeek + 1 : 1, min: 1, max: 53 },
      { name: 'durationWeeks', label: 'Duration (weeks)', type: 'number', value: 2, min: 1, max: 52 },
      { name: 'color', label: 'Color', type: 'color', value: proj ? proj.color : '#bdc3c7' }
    ],
    onSave: (values) => {
      Store.addTask(projectId, {
        label: values.label.trim() || 'New Task',
        startWeek: parseInt(values.startWeek) - 1,
        durationWeeks: parseInt(values.durationWeeks),
        color: values.color
      });
      document.dispatchEvent(new Event('mareo:render'));
    }
  });
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
