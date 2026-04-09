import { Store } from './store.js';

const GRID = 24; // matches the dot background in CSS
const CLICK_DRAG_THRESHOLD = 4; // px movement before a click becomes a drag

// Pinned-row layout (world coordinates). Pinned cards always render here,
// overriding their saved boardX/boardY, so they stay aligned like Timeline.
const PIN_X_START  = 2500;
const PIN_Y        = 2700;
const PIN_STEP     = 264; // 11 * GRID — matches auto-position cascade
const PIN_HEADER_H = 28;

let dragState = null;
let marqueeState = null;
let pendingClick = null;
let boardZoom = 1;
let boardCentered = false;
const selectedIds = new Set();

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

  // Diagnostic: how many notes does the board see for each project?
  console.log('[board] project notes count:',
    allProjects.map(p => ({ id: p.id, name: p.name, notesCount: (p.projectNotes || []).length })));

  if (allProjects.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'empty-state';
    empty.textContent = 'No projects yet — add one from the Timeline sidebar';
    wrapper.appendChild(empty);
    return;
  }

  // Partition into pinned (from Store.pinnedProjects order) and free cards
  const pinnedIds = Store.data.pinnedProjects || [];
  const projById = new Map(allProjects.map(p => [p.id, p]));
  const pinnedProjects = pinnedIds.map(id => projById.get(id)).filter(Boolean);
  const unpinnedProjects = allProjects.filter(p => !pinnedIds.includes(p.id));

  const positions = [];

  // Pinned row: header strip + horizontally-aligned cards at fixed world coords
  if (pinnedProjects.length > 0) {
    const header = document.createElement('div');
    header.className = 'board-pinned-header';
    header.style.left = PIN_X_START + 'px';
    header.style.top  = (PIN_Y - PIN_HEADER_H - 6) + 'px';
    header.style.width = (pinnedProjects.length * PIN_STEP - (PIN_STEP - 240)) + 'px';
    header.textContent = '📌 PINNED';
    wrapper.appendChild(header);

    pinnedProjects.forEach((proj, i) => {
      const x = PIN_X_START + i * PIN_STEP;
      const y = PIN_Y;
      positions.push({ x, y });
      const el = createProjectCard(proj, x, y, true);
      wrapper.appendChild(el);
    });
  }

  // Unpinned: auto-position cards that have no saved position — start near the
  // center of the 6000x6000 wrapper so the board feels "centered" on first use
  let autoPx = snap(2900), autoPy = snap(2900);
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
    const el = createProjectCard(proj, x, y, false);
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

function createProjectCard(proj, x, y, isPinned = false) {
  const minimized = !!proj.boardMinimized;
  const isSelected = selectedIds.has(proj.id);
  const el = document.createElement('div');
  el.className = 'board-card board-project-card'
    + (minimized ? ' minimized' : '')
    + (isSelected ? ' selected' : '')
    + (isPinned ? ' board-card-pinned' : '');
  el.dataset.projectId = proj.id;
  el.style.left = x + 'px';
  el.style.top = y + 'px';
  el.style.width = '240px';
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

    // Pinned cards are locked to the aligned pinned row: no drag, no group
    // selection. A plain click on the header toggles minimize.
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
      // Update outlines without a full re-render
      document.querySelectorAll('.board-project-card.selected').forEach(c => c.classList.remove('selected'));
      el.classList.add('selected');
    }

    const rect = el.getBoundingClientRect();
    const wrapper = document.querySelector('.board-zoom-wrapper');
    const groupEls = [];
    for (const id of selectedIds) {
      const cardEl = wrapper?.querySelector(`.board-project-card[data-project-id="${id}"]`);
      if (cardEl) {
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
      // Persist all moved cards
      for (const g of dragState.group) {
        const x = parseInt(g.el.style.left);
        const y = parseInt(g.el.style.top);
        Store.updateProjectBoardPosition(g.id, { x, y });
        g.el.classList.remove('dragging');
      }
    } else if (pendingClick) {
      // It was a click on the header → toggle minimize
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
    // Only react when on the empty canvas (or wrapper), not on a card
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
      // Click on empty canvas (no drag) → clear selection
      if (!additive && selectedIds.size > 0) {
        selectedIds.clear();
        document.dispatchEvent(new Event('mareo:render'));
      }
    } else if (lastBox) {
      // Find all cards intersecting the marquee
      if (!additive) selectedIds.clear();
      const cards = document.querySelectorAll('.board-project-card');
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
