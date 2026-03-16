import { Store } from './store.js';

let dragState = null;
let boardZoom = 1;

export function renderBoard(container) {
  // Keep zoom wrapper if exists, or create
  let wrapper = container.querySelector('.board-zoom-wrapper');
  if (!wrapper) {
    wrapper = document.createElement('div');
    wrapper.className = 'board-zoom-wrapper';
    container.appendChild(wrapper);
  }
  wrapper.innerHTML = '';
  wrapper.style.transform = `scale(${boardZoom})`;
  wrapper.style.transformOrigin = '0 0';

  // --- Project cards (auto-generated) ---
  const projects = Store.getAllProjects();

  if (projects.length === 0 && Store.data.boardCards.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'empty-state';
    empty.textContent = "Your board is empty — click '+ Add Card' to start organizing";
    wrapper.appendChild(empty);
    return;
  }
  let px = 40, py = 40;

  for (const proj of projects) {
    // Check if a board card already exists for this project
    const existing = Store.data.boardCards.find(c => c.projectId === proj.id);
    if (existing) continue;

    const el = createProjectCard(proj, px, py);
    wrapper.appendChild(el);
    px += 230;
    if (px > 900) { px = 40; py += 200; }
  }

  // --- User board cards ---
  for (const card of Store.data.boardCards) {
    const el = createBoardCard(card);
    wrapper.appendChild(el);
  }
}

function createProjectCard(proj, x, y) {
  const el = document.createElement('div');
  el.className = 'board-card board-project-card';
  el.style.left = x + 'px';
  el.style.top = y + 'px';
  el.style.width = '210px';
  el.style.minHeight = '120px';
  el.style.borderLeft = `4px solid ${proj.color}`;

  const title = document.createElement('div');
  title.className = 'board-card-title';
  title.textContent = proj.name;
  title.style.cursor = 'default';

  const catLabel = document.createElement('div');
  catLabel.className = 'board-card-category';
  catLabel.textContent = proj.categoryName;

  const taskCount = document.createElement('div');
  taskCount.className = 'board-card-meta';
  const notesCount = (proj.projectNotes || []).length;
  taskCount.textContent = `${proj.tasks.length} tasks · ${notesCount} notes`;

  const viewBtn = document.createElement('button');
  viewBtn.className = 'btn btn-secondary board-card-view-btn';
  viewBtn.textContent = 'View Notes';
  viewBtn.addEventListener('click', () => {
    // Switch to notes view filtered by project
    Store.setView('notes');
    document.dispatchEvent(new CustomEvent('mareo:switchView', { detail: 'notes' }));
    document.dispatchEvent(new Event('mareo:render'));
  });

  el.appendChild(title);
  el.appendChild(catLabel);
  el.appendChild(taskCount);
  el.appendChild(viewBtn);
  return el;
}

function createBoardCard(card) {
  const el = document.createElement('div');
  el.className = 'board-card';
  el.dataset.cardId = card.id;
  el.style.left = (card.x || 100) + 'px';
  el.style.top = (card.y || 100) + 'px';
  el.style.width = (card.width || 200) + 'px';
  el.style.minHeight = (card.height || 150) + 'px';
  el.style.backgroundColor = card.color || '#1f2b47';

  const title = document.createElement('div');
  title.className = 'board-card-title';
  title.contentEditable = true;
  title.textContent = card.title;
  title.addEventListener('blur', () => {
    Store.updateBoardCard(card.id, { title: title.textContent });
  });
  title.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); title.blur(); }
  });

  title.addEventListener('pointerdown', (e) => {
    if (e.target.closest('.board-card-delete')) return;
    if (e.button !== 0) return;
    const rect = el.getBoundingClientRect();
    dragState = {
      cardId: card.id,
      el,
      offsetX: (e.clientX - rect.left) / boardZoom,
      offsetY: (e.clientY - rect.top) / boardZoom
    };
    el.classList.add('dragging');
    el.setPointerCapture(e.pointerId);
  });

  const deleteBtn = document.createElement('button');
  deleteBtn.className = 'board-card-delete btn-icon';
  deleteBtn.textContent = '✕';
  deleteBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    Store.removeBoardCard(card.id);
    document.dispatchEvent(new Event('mareo:render'));
  });

  const content = document.createElement('div');
  content.className = 'board-card-content';
  content.contentEditable = true;
  content.textContent = card.content;
  content.addEventListener('blur', () => {
    Store.updateBoardCard(card.id, { content: content.textContent });
  });

  const colorRow = document.createElement('div');
  colorRow.className = 'board-card-colors';
  const colors = ['#1f2b47', '#2d4a3e', '#4a2d2d', '#3d3a4a', '#2d3f4a', '#4a3d2d'];
  for (const c of colors) {
    const dot = document.createElement('div');
    dot.className = 'color-dot';
    dot.style.backgroundColor = c;
    if (c === card.color) dot.classList.add('active');
    dot.addEventListener('click', (ev) => {
      ev.stopPropagation();
      Store.updateBoardCard(card.id, { color: c });
      el.style.backgroundColor = c;
      colorRow.querySelectorAll('.color-dot').forEach(d => d.classList.remove('active'));
      dot.classList.add('active');
    });
    colorRow.appendChild(dot);
  }

  el.appendChild(deleteBtn);
  el.appendChild(title);
  el.appendChild(content);
  el.appendChild(colorRow);
  return el;
}

export function initBoardDrag() {
  document.addEventListener('pointermove', (e) => {
    if (!dragState) return;
    const canvas = document.getElementById('board-canvas');
    if (!canvas) return;
    const canvasRect = canvas.getBoundingClientRect();
    const x = (e.clientX - canvasRect.left + canvas.scrollLeft) / boardZoom - dragState.offsetX;
    const y = (e.clientY - canvasRect.top + canvas.scrollTop) / boardZoom - dragState.offsetY;
    dragState.el.style.left = Math.max(0, x) + 'px';
    dragState.el.style.top = Math.max(0, y) + 'px';
  });

  document.addEventListener('pointerup', () => {
    if (!dragState) return;
    const x = parseInt(dragState.el.style.left);
    const y = parseInt(dragState.el.style.top);
    Store.updateBoardCard(dragState.cardId, { x, y });
    dragState.el.classList.remove('dragging');
    dragState = null;
  });
}

export function initBoardZoom() {
  const canvas = document.getElementById('board-canvas');
  if (!canvas) return;

  canvas.addEventListener('wheel', (e) => {
    // Only zoom in board view
    if (!canvas.closest('.view-container.active')) return;
    e.preventDefault();

    const delta = e.deltaY > 0 ? -0.05 : 0.05;
    boardZoom = Math.max(0.25, Math.min(2, boardZoom + delta));

    const wrapper = canvas.querySelector('.board-zoom-wrapper');
    if (wrapper) {
      wrapper.style.transform = `scale(${boardZoom})`;
    }

    // Update zoom indicator
    const indicator = document.getElementById('board-zoom-level');
    if (indicator) indicator.textContent = Math.round(boardZoom * 100) + '%';
  }, { passive: false });
}
