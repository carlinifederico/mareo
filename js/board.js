import { Store } from './store.js';

let dragState = null;
let boardZoom = 1;
let boardCentered = false;

export function renderBoard(container) {
  let wrapper = container.querySelector('.board-zoom-wrapper');
  if (!wrapper) {
    wrapper = document.createElement('div');
    wrapper.className = 'board-zoom-wrapper';
    container.appendChild(wrapper);
  }
  wrapper.innerHTML = '';
  wrapper.style.transform = `scale(${boardZoom})`;
  wrapper.style.transformOrigin = '0 0';

  const projects = Store.getAllProjects();

  // Diagnostic: how many notes does the board see for each project?
  console.log('[board] project notes count:',
    projects.map(p => ({ id: p.id, name: p.name, notesCount: (p.projectNotes || []).length })));

  if (projects.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'empty-state';
    empty.textContent = 'No projects yet — add one from the Timeline sidebar';
    wrapper.appendChild(empty);
    return;
  }

  // Auto-position projects that have no saved position — start near the
  // center of the 3000x3000 wrapper so the board feels "centered" on first use
  let autoPx = 1400, autoPy = 1400;
  const positions = [];
  for (const proj of projects) {
    let x = proj.boardX;
    let y = proj.boardY;
    if (x == null || y == null) {
      x = autoPx;
      y = autoPy;
      autoPx += 260;
      if (autoPx > 2400) { autoPx = 1400; autoPy += 240; }
      Store.updateProjectBoardPosition(proj.id, { x, y });
    }
    positions.push({ x, y });
    const el = createProjectCard(proj, x, y);
    wrapper.appendChild(el);
  }

  // Center scroll once per session on the bounding box of all cards
  if (!boardCentered) {
    boardCentered = true;
    requestAnimationFrame(() => centerBoardOn(container, positions));
  }
}

function centerBoardOn(canvas, positions) {
  if (!positions.length) return;
  const cardW = 240, cardH = 200; // approximate card size for centering math
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const { x, y } of positions) {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x + cardW > maxX) maxX = x + cardW;
    if (y + cardH > maxY) maxY = y + cardH;
  }
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  canvas.scrollLeft = Math.max(0, cx * boardZoom - canvas.clientWidth / 2);
  canvas.scrollTop = Math.max(0, cy * boardZoom - canvas.clientHeight / 2);
}

function createProjectCard(proj, x, y) {
  const minimized = !!proj.boardMinimized;
  const el = document.createElement('div');
  el.className = 'board-card board-project-card' + (minimized ? ' minimized' : '');
  el.dataset.projectId = proj.id;
  el.style.left = x + 'px';
  el.style.top = y + 'px';
  el.style.width = '240px';
  el.style.borderLeft = `3px solid ${proj.color}`;

  // --- Header (drag handle) ---
  const header = document.createElement('div');
  header.className = 'board-card-header';

  const title = document.createElement('div');
  title.className = 'board-card-title';
  title.textContent = proj.name;

  const minBtn = document.createElement('button');
  minBtn.className = 'btn-icon board-card-min';
  minBtn.title = minimized ? 'Expand' : 'Minimize';
  minBtn.textContent = minimized ? '+' : '−';
  minBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    Store.updateProjectBoardPosition(proj.id, { minimized: !minimized });
    document.dispatchEvent(new Event('mareo:render'));
  });

  header.appendChild(title);
  header.appendChild(minBtn);
  el.appendChild(header);

  // Drag from header
  header.addEventListener('pointerdown', (e) => {
    if (e.target.closest('button')) return;
    if (e.button !== 0) return;
    const rect = el.getBoundingClientRect();
    dragState = {
      projectId: proj.id,
      el,
      offsetX: (e.clientX - rect.left) / boardZoom,
      offsetY: (e.clientY - rect.top) / boardZoom
    };
    el.classList.add('dragging');
    header.setPointerCapture(e.pointerId);
  });

  if (minimized) return el;

  // --- Body: project notes (checklist) ---
  const body = document.createElement('div');
  body.className = 'board-card-body';

  const notes = proj.projectNotes || [];
  if (notes.length === 0) {
    const placeholder = document.createElement('div');
    placeholder.className = 'board-card-empty-notes';
    placeholder.textContent = 'no notes yet';
    body.appendChild(placeholder);
  }
  for (const note of notes) {
    body.appendChild(createNoteRow(proj, note));
  }

  const addBtn = document.createElement('div');
  addBtn.className = 'note-preview-add board-card-add-note';
  addBtn.textContent = '+ Note';
  addBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    Store.addProjectNote(proj.id, { title: '', content: '' });
    document.dispatchEvent(new Event('mareo:render'));
  });
  body.appendChild(addBtn);

  el.appendChild(body);
  return el;
}

function createNoteRow(proj, note) {
  const row = document.createElement('div');
  row.className = 'note-preview-item board-note-row' + (note.done ? ' done' : '');
  row.dataset.noteId = note.id;

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
  textInput.addEventListener('change', () => {
    Store.updateProjectNote(proj.id, note.id, { title: textInput.value });
  });
  textInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      Store.updateProjectNote(proj.id, note.id, { title: textInput.value });
      Store.addProjectNoteAfter(proj.id, note.id, { title: '', content: '' });
      document.dispatchEvent(new Event('mareo:render'));
    }
  });
  // Block drag from text input
  textInput.addEventListener('pointerdown', (e) => e.stopPropagation());

  const todayDot = document.createElement('button');
  todayDot.className = 'today-dot' + (note.today ? ' active' : '');
  todayDot.title = note.today ? 'Remove from Today' : 'Add to Today';
  todayDot.textContent = '●';
  todayDot.addEventListener('click', (e) => {
    e.stopPropagation();
    Store.toggleTodayNote(proj.id, note.id);
    document.dispatchEvent(new Event('mareo:render'));
  });

  const delBtn = document.createElement('button');
  delBtn.className = 'btn-icon note-preview-delete';
  delBtn.textContent = '✕';
  delBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    Store.removeProjectNote(proj.id, note.id);
    document.dispatchEvent(new Event('mareo:render'));
  });

  row.appendChild(checkbox);
  row.appendChild(textInput);
  row.appendChild(todayDot);
  row.appendChild(delBtn);
  return row;
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
    Store.updateProjectBoardPosition(dragState.projectId, { x, y });
    dragState.el.classList.remove('dragging');
    dragState = null;
  });
}

export function initBoardZoom() {
  const canvas = document.getElementById('board-canvas');
  if (!canvas) return;

  canvas.addEventListener('wheel', (e) => {
    if (!canvas.closest('.view-container.active')) return;
    e.preventDefault();

    const wrapper = canvas.querySelector('.board-zoom-wrapper');
    if (!wrapper) return;

    // Cursor position relative to the canvas viewport
    const rect = canvas.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;

    // World coordinates under the cursor BEFORE zooming
    const worldX = (canvas.scrollLeft + mouseX) / boardZoom;
    const worldY = (canvas.scrollTop + mouseY) / boardZoom;

    // Apply zoom (multiplicative for smooth feel)
    const factor = e.deltaY > 0 ? 0.92 : 1.08;
    const newZoom = Math.max(0.2, Math.min(3, boardZoom * factor));
    if (newZoom === boardZoom) return;
    boardZoom = newZoom;

    wrapper.style.transform = `scale(${boardZoom})`;

    // Re-anchor: keep the same world point under the cursor after zoom
    canvas.scrollLeft = worldX * boardZoom - mouseX;
    canvas.scrollTop = worldY * boardZoom - mouseY;

    const indicator = document.getElementById('board-zoom-level');
    if (indicator) indicator.textContent = Math.round(boardZoom * 100) + '%';
  }, { passive: false });
}
