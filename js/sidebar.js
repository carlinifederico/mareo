import { Store } from './store.js';
import { showModal } from './modal.js';

let onProjectClick = null;

export function setSidebarProjectClickHandler(handler) {
  onProjectClick = handler;
}

export function renderSidebar(container) {
  container.innerHTML = '';

  if (Store.data.categories.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'empty-state';
    empty.textContent = 'Start by creating your first project category';
    container.appendChild(empty);
  }

  for (const cat of Store.data.categories) {
    // Category header
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

    // Projects
    if (!cat.collapsed) {
      for (const proj of cat.projects) {
        const projRow = document.createElement('div');
        projRow.className = 'sidebar-project';
        projRow.dataset.projectId = proj.id;

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

        projRow.appendChild(nameEl);
        projRow.appendChild(menuBtn);
        container.appendChild(projRow);
      }

      // Add project button
      const addProjBtn = document.createElement('div');
      addProjBtn.className = 'sidebar-add-project';
      addProjBtn.textContent = '+ Add Project';
      addProjBtn.addEventListener('click', () => {
        showAddProjectModal(cat.id);
      });
      container.appendChild(addProjBtn);
    }
  }

  // Add category button
  const addCatBtn = document.createElement('div');
  addCatBtn.className = 'sidebar-add-category';
  addCatBtn.textContent = '+ Add Category';
  addCatBtn.addEventListener('click', () => {
    showAddCategoryModal();
  });
  container.appendChild(addCatBtn);
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
    <div class="context-menu-item danger" data-action="delete">Delete Project</div>
  `;

  menu.addEventListener('click', (ev) => {
    const action = ev.target.dataset.action;
    if (action === 'edit') {
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
