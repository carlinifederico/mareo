import { Store } from './store.js';

const GRID = 24; // matches the dot background in CSS
const CLICK_DRAG_THRESHOLD = 4; // px movement before a click becomes a drag

let dragState = null;
let marqueeState = null;
let pendingClick = null;
let boardZoom = 1;
let boardCentered = false;
const selectedIds = new Set();

// Remember the note id just created via Enter, so we can focus it after re-render
let focusNoteIdAfterRender = null;

function snap(v) { return Math.round(v / GRID) * GRID; }

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

  const allProjects = Store.getAllProjects();
  const pinnedIds = Store.data.pinnedProjects || [];
  const projById = new Map(allProjects.map(p => [p.id, p]));
  const pinnedProjects = pinnedIds.map(id => projById.get(id)).filter(Boolean);
  const unpinnedProjects = allProjects.filter(p => !pinnedIds.includes(p.id));

  // Render pinned bar (sticky, outside the zoom/pan world)
  renderPinnedBar(pinnedProjects);

  if (allProjects.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'empty-state';
    empty.textContent = 'No projects yet — add one from the Timeline sidebar';
    wrapper.appendChild(empty);
    return;
  }

  // Unpinned: auto-position cards that have no saved position — start near the
  // center of the 6000x6000 wrapper so the board feels "centered" on first use
  let autoPx = snap(2900), autoPy = snap(2900);
  const positions = [];
  for (const proj of unpinnedProjects) {
    let x = proj.boardX;
    let y = proj.boardY;
    if (x == null || y == null) {
      x = autoPx;
      y = autoPy;
      autoPx += 264; // 11 * GRID
      if (autoPx > 3900) { autoPx = snap(2900); autoPy += 240; } // 240 = 10 * GRID
      Store.updateProjectBoardPosition(proj.id, { x, y });
    }
    positions.push({ x, y });
    const el = createProjectCard(proj, { x, y, isPinned: false });
    wrapper.appendChild(el);
  }

  // Center scroll once per session on the bounding box of all cards
  if (!boardCentered && positions.length > 0) {
    boardCentered = true;
    requestAnimationFrame(() => centerBoardOn(container, positions));
  }

  // Restore focus to the note input that was just created via Enter
  if (focusNoteIdAfterRender) {
    const id = focusNoteIdAfterRender;
    focusNoteIdAfterRender = null;
    requestAnimationFrame(() => {
      const input = document.querySelector(`.board-pinned-bar .note-preview-text[data-note-id="${id}"]`)
                 || document.querySelector(`.board-zoom-wrapper .note-preview-text[data-note-id="${id}"]`);
      if (input) { input.focus(); input.select(); }
    });
  }
}

function renderPinnedBar(pinnedProjects) {
  const bar = document.getElementById('board-pinned-bar');
  if (!bar) return;
  bar.innerHTML = '';

  if (pinnedProjects.length === 0) {
    bar.classList.remove('has-pins');
    return;
  }
  bar.classList.add('has-pins');

  const label = document.createElement('div');
  label.className = 'board-pinned-label';
  label.textContent = '📌 PINNED';
  bar.appendChild(label);

  const strip = document.createElement('div');
  strip.className = 'board-pinned-strip';
  bar.appendChild(strip);

  for (const proj of pinnedProjects) {
    const el = createProjectCard(proj, { isPinned: true });
    strip.appendChild(el);
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

function createProjectCard(proj, { x, y, isPinned = false } = {}) {
  const minimized = !!proj.boardMinimized;
  const isSelected = selectedIds.has(proj.id);
  const el = document.createElement('div');
  el.className = 'board-card board-project-card'
    + (minimized ? ' minimized' : '')
    + (isSelected ? ' selected' : '')
    + (isPinned ? ' board-card-pinned' : '');
  el.dataset.projectId = proj.id;
  if (!isPinned) {
    el.style.left = x + 'px';
    el.style.top = y + 'px';
    el.style.width = '240px';
  }
  el.style.borderLeft = `3px solid ${proj.color}`;

  // --- Header (drag handle + click to toggle minimize) ---
  const header = document.createElement('div');
  header.className = 'board-card-header';

  const title = document.createElement('div');
  title.className = 'board-card-title';
  title.textContent = proj.name;

  const chevron = document.createElement('span');
  chevron.className = 'board-card-chevron';
  chevron.textContent = minimized ? '▸' : '▾';

  header.appendChild(title);
  header.appendChild(chevron);
  el.appendChild(header);

  // Pointerdown on header: start drag candidate, handle selection
  header.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    e.stopPropagation();

    // Pinned cards are locked in the sticky bar: no drag, no group select.
    // A plain click on the header toggles minimize.
    if (isPinned) {
      Store.updateProjectBoardPosition(proj.id, { minimized: !minimized });
      document.dispatchEvent(new Event('mareo:render'));
      return;
    }

    // Shift+click → toggle this card in the selection, no drag, no minimize
    if (e.shiftKey) {
      if (selectedIds.has(proj.id)) selectedIds.delete(proj.id);
      else selectedIds.add(proj.id);
      document.dispatchEvent(new Event('mareo:render'));
      return;
    }

    // If clicking a card not in selection, replace selection with just this one.
    // If clicking a card already in a multi-selection, keep the selection (so we can drag the group).
    if (!selectedIds.has(proj.id)) {
      selectedIds.clear();
      selectedIds.add(proj.id);
      document.querySelectorAll('.board-project-card.selected').forEach(c => c.classList.remove('selected'));
      el.classList.add('selected');
    }

    const wrapper = document.querySelector('.board-zoom-wrapper');
    const groupEls = [];
    for (const id of selectedIds) {
      const cardEl = wrapper?.querySelector(`.board-project-card[data-project-id="${id}"]`);
      if (cardEl && !cardEl.classList.contains('board-card-pinned')) {
        groupEls.push({
          id,
          el: cardEl,
          startLeft: parseInt(cardEl.style.left) || 0,
          startTop: parseInt(cardEl.style.top) || 0,
        });
      }
    }

    dragState = {
      primaryId: proj.id,
      group: groupEls,
      startClientX: e.clientX,
      startClientY: e.clientY,
      moved: false,
      pointerId: e.pointerId,
    };
    pendingClick = { projectId: proj.id, minimized };
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

  // Wire up drag-drop reorder on the body
  attachNoteReorderDnD(body, proj);

  const addBtn = document.createElement('div');
  addBtn.className = 'note-preview-add board-card-add-note';
  addBtn.textContent = '+ Note';
  addBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    const n = Store.addProjectNote(proj.id, { title: '', content: '' });
    if (n) focusNoteIdAfterRender = n.id;
    document.dispatchEvent(new Event('mareo:render'));
  });
  body.appendChild(addBtn);

  el.appendChild(body);
  return el;
}

function createNoteRow(proj, note) {
  const depth = Math.min(1, Math.max(0, note.depth || 0));
  const row = document.createElement('div');
  row.className = 'note-preview-item board-note-row'
    + (note.done ? ' done' : '')
    + (depth > 0 ? ' indented' : '');
  row.dataset.noteId = note.id;
  row.dataset.depth = String(depth);
  row.draggable = true;

  const grip = document.createElement('span');
  grip.className = 'note-drag-grip';
  grip.textContent = '⠿';
  grip.addEventListener('pointerdown', (e) => e.stopPropagation());

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
  // Disable row dragging while typing
  textInput.addEventListener('focus', () => { row.draggable = false; });
  textInput.addEventListener('blur',  () => { row.draggable = true;  });
  textInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      Store.updateProjectNote(proj.id, note.id, { title: textInput.value });
      const newNote = Store.addProjectNoteAfter(proj.id, note.id, { title: '', content: '' });
      if (newNote) focusNoteIdAfterRender = newNote.id;
      document.dispatchEvent(new Event('mareo:render'));
    } else if (e.key === 'Tab') {
      e.preventDefault();
      Store.updateProjectNote(proj.id, note.id, { title: textInput.value });
      if (e.shiftKey) Store.outdentProjectNote(proj.id, note.id);
      else            Store.indentProjectNote(proj.id, note.id);
      focusNoteIdAfterRender = note.id;
      document.dispatchEvent(new Event('mareo:render'));
    } else if (e.key === 'Backspace' && textInput.value === '') {
      // Backspace on an empty note: remove it, focus the previous note
      e.preventDefault();
      const notes = proj.projectNotes || [];
      const idx = notes.findIndex(n => n.id === note.id);
      const prev = idx > 0 ? notes[idx - 1] : null;
      Store.removeProjectNote(proj.id, note.id);
      if (prev) focusNoteIdAfterRender = prev.id;
      document.dispatchEvent(new Event('mareo:render'));
    }
  });
  // Block card drag from text input
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

  row.appendChild(grip);
  row.appendChild(checkbox);
  row.appendChild(textInput);
  row.appendChild(todayDot);
  row.appendChild(delBtn);
  return row;
}

function attachNoteReorderDnD(body, proj) {
  let dragNoteId = null;
  body.addEventListener('dragstart', (e) => {
    const item = e.target.closest('.board-note-row');
    if (!item) return;
    dragNoteId = item.dataset.noteId;
    item.classList.add('dragging');
    // Allow drop
    if (e.dataTransfer) { e.dataTransfer.effectAllowed = 'move'; }
    e.stopPropagation();
  });
  body.addEventListener('dragend', (e) => {
    const item = e.target.closest('.board-note-row');
    if (item) item.classList.remove('dragging');
    body.querySelectorAll('.board-note-row').forEach(n => n.classList.remove('drag-over'));
    dragNoteId = null;
  });
  body.addEventListener('dragover', (e) => {
    const item = e.target.closest('.board-note-row');
    if (!item || item.dataset.noteId === dragNoteId) return;
    e.preventDefault();
    e.stopPropagation();
    body.querySelectorAll('.board-note-row').forEach(n => n.classList.remove('drag-over'));
    item.classList.add('drag-over');
  });
  body.addEventListener('drop', (e) => {
    e.preventDefault();
    e.stopPropagation();
    const item = e.target.closest('.board-note-row');
    if (!item || !dragNoteId || item.dataset.noteId === dragNoteId) return;
    const allNotes = proj.projectNotes || [];
    const fromIdx = allNotes.findIndex(n => n.id === dragNoteId);
    const toIdx   = allNotes.findIndex(n => n.id === item.dataset.noteId);
    if (fromIdx < 0 || toIdx < 0) return;
    const [moved] = allNotes.splice(fromIdx, 1);
    allNotes.splice(toIdx, 0, moved);
    Store.save();
    document.dispatchEvent(new Event('mareo:render'));
  });
}

export function initBoardDrag() {
  document.addEventListener('pointermove', (e) => {
    if (!dragState) return;
    const dx = (e.clientX - dragState.startClientX) / boardZoom;
    const dy = (e.clientY - dragState.startClientY) / boardZoom;

    if (!dragState.moved) {
      const rawDx = e.clientX - dragState.startClientX;
      const rawDy = e.clientY - dragState.startClientY;
      if (Math.hypot(rawDx, rawDy) < CLICK_DRAG_THRESHOLD) return;
      dragState.moved = true;
      pendingClick = null; // movement past threshold = it's a drag, not a click
      for (const g of dragState.group) g.el.classList.add('dragging');
    }

    for (const g of dragState.group) {
      const nx = Math.max(0, snap(g.startLeft + dx));
      const ny = Math.max(0, snap(g.startTop + dy));
      g.el.style.left = nx + 'px';
      g.el.style.top = ny + 'px';
    }
  });

  document.addEventListener('pointerup', (e) => {
    if (!dragState) return;
    if (dragState.moved) {
      for (const g of dragState.group) {
        const x = parseInt(g.el.style.left);
        const y = parseInt(g.el.style.top);
        Store.updateProjectBoardPosition(g.id, { x, y });
        g.el.classList.remove('dragging');
      }
    } else if (pendingClick) {
      Store.updateProjectBoardPosition(pendingClick.projectId, { minimized: !pendingClick.minimized });
      pendingClick = null;
      document.dispatchEvent(new Event('mareo:render'));
    }
    dragState = null;
  });
}

export function initBoardSelection() {
  const canvas = document.getElementById('board-canvas');
  if (!canvas) return;

  canvas.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    if (e.target.closest('.board-project-card')) return;
    const wrapper = canvas.querySelector('.board-zoom-wrapper');
    if (!wrapper) return;

    const canvasRect = canvas.getBoundingClientRect();
    const startWX = (e.clientX - canvasRect.left + canvas.scrollLeft) / boardZoom;
    const startWY = (e.clientY - canvasRect.top + canvas.scrollTop) / boardZoom;

    const box = document.createElement('div');
    box.className = 'board-marquee';
    box.style.left = startWX + 'px';
    box.style.top = startWY + 'px';
    wrapper.appendChild(box);

    marqueeState = { startWX, startWY, box, additive: e.shiftKey, moved: false };
  });

  document.addEventListener('pointermove', (e) => {
    if (!marqueeState) return;
    const canvasRect = canvas.getBoundingClientRect();
    const wx = (e.clientX - canvasRect.left + canvas.scrollLeft) / boardZoom;
    const wy = (e.clientY - canvasRect.top + canvas.scrollTop) / boardZoom;
    const x = Math.min(wx, marqueeState.startWX);
    const y = Math.min(wy, marqueeState.startWY);
    const w = Math.abs(wx - marqueeState.startWX);
    const h = Math.abs(wy - marqueeState.startWY);
    marqueeState.box.style.left = x + 'px';
    marqueeState.box.style.top = y + 'px';
    marqueeState.box.style.width = w + 'px';
    marqueeState.box.style.height = h + 'px';
    marqueeState.lastBox = { x, y, w, h };
    if (w > 2 || h > 2) marqueeState.moved = true;
  });

  document.addEventListener('pointerup', () => {
    if (!marqueeState) return;
    const { lastBox, additive, moved, box } = marqueeState;

    if (!moved) {
      if (!additive && selectedIds.size > 0) {
        selectedIds.clear();
        document.dispatchEvent(new Event('mareo:render'));
      }
    } else if (lastBox) {
      if (!additive) selectedIds.clear();
      const cards = document.querySelectorAll('.board-zoom-wrapper .board-project-card');
      for (const card of cards) {
        if (card.classList.contains('board-card-pinned')) continue;
        const cx = parseInt(card.style.left) || 0;
        const cy = parseInt(card.style.top) || 0;
        const cw = card.offsetWidth;
        const ch = card.offsetHeight;
        const intersects = !(
          cx + cw < lastBox.x ||
          cx > lastBox.x + lastBox.w ||
          cy + ch < lastBox.y ||
          cy > lastBox.y + lastBox.h
        );
        if (intersects) selectedIds.add(card.dataset.projectId);
      }
      document.dispatchEvent(new Event('mareo:render'));
    }

    box.remove();
    marqueeState = null;
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

    const rect = canvas.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;

    const worldX = (canvas.scrollLeft + mouseX) / boardZoom;
    const worldY = (canvas.scrollTop + mouseY) / boardZoom;

    const factor = e.deltaY > 0 ? 0.92 : 1.08;
    const newZoom = Math.max(0.2, Math.min(3, boardZoom * factor));
    if (newZoom === boardZoom) return;
    boardZoom = newZoom;

    wrapper.style.transform = `scale(${boardZoom})`;

    canvas.scrollLeft = worldX * boardZoom - mouseX;
    canvas.scrollTop = worldY * boardZoom - mouseY;

    const indicator = document.getElementById('board-zoom-level');
    if (indicator) indicator.textContent = Math.round(boardZoom * 100) + '%';
  }, { passive: false });
}
