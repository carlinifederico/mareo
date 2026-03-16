import { Store } from './store.js';

let dragState = null;

export function renderBoard(container) {
  container.innerHTML = '';

  for (const card of Store.data.boardCards) {
    const el = document.createElement('div');
    el.className = 'board-card';
    el.dataset.cardId = card.id;
    el.style.left = card.x + 'px';
    el.style.top = card.y + 'px';
    el.style.width = (card.width || 200) + 'px';
    el.style.minHeight = (card.height || 150) + 'px';
    el.style.backgroundColor = card.color || '#1f2b47';

    // Title
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

    // Drag handle in title
    title.addEventListener('pointerdown', (e) => {
      if (e.target.closest('.board-card-delete')) return;
      const rect = el.getBoundingClientRect();
      dragState = {
        cardId: card.id,
        el,
        offsetX: e.clientX - rect.left,
        offsetY: e.clientY - rect.top
      };
      el.classList.add('dragging');
      el.setPointerCapture(e.pointerId);
    });

    // Delete button
    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'board-card-delete btn-icon';
    deleteBtn.textContent = '✕';
    deleteBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      Store.removeBoardCard(card.id);
      document.dispatchEvent(new Event('mareo:render'));
    });

    // Content
    const content = document.createElement('div');
    content.className = 'board-card-content';
    content.contentEditable = true;
    content.textContent = card.content;
    content.addEventListener('blur', () => {
      Store.updateBoardCard(card.id, { content: content.textContent });
    });

    // Color picker
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
    container.appendChild(el);
  }
}

export function initBoardDrag() {
  document.addEventListener('pointermove', (e) => {
    if (!dragState) return;
    const canvas = document.getElementById('board-canvas');
    const canvasRect = canvas.getBoundingClientRect();
    const x = e.clientX - canvasRect.left - dragState.offsetX + canvas.scrollLeft;
    const y = e.clientY - canvasRect.top - dragState.offsetY + canvas.scrollTop;
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
