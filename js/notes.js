import { Store } from './store.js';

const NOTE_COLORS = [
  { name: 'Default', value: '#16213e' },
  { name: 'Red', value: '#4a2d2d' },
  { name: 'Green', value: '#2d4a3e' },
  { name: 'Blue', value: '#2d3f4a' },
  { name: 'Purple', value: '#3d3a4a' },
  { name: 'Orange', value: '#4a3d2d' },
  { name: 'Teal', value: '#1a3a3a' },
  { name: 'Yellow', value: '#4a4a2d' }
];

export function renderNotes(container, searchQuery) {
  container.innerHTML = '';
  const query = (searchQuery || '').toLowerCase();

  let notes = [...Store.data.notes];

  // Filter by search
  if (query) {
    notes = notes.filter(n =>
      (n.title || '').toLowerCase().includes(query) ||
      (n.content || '').toLowerCase().includes(query)
    );
  }

  // Sort: pinned first, then by updatedAt
  notes.sort((a, b) => {
    if (a.pinned && !b.pinned) return -1;
    if (!a.pinned && b.pinned) return 1;
    return b.updatedAt - a.updatedAt;
  });

  if (notes.length === 0 && !query) {
    const empty = document.createElement('div');
    empty.className = 'notes-empty';
    empty.textContent = 'No notes yet. Click "+ New Note" to create one.';
    container.appendChild(empty);
    return;
  }

  for (const note of notes) {
    const card = document.createElement('div');
    card.className = 'note-card';
    if (note.pinned) card.classList.add('pinned');
    card.style.backgroundColor = note.color || '#16213e';

    // Pin button
    const pinBtn = document.createElement('button');
    pinBtn.className = 'note-pin btn-icon';
    pinBtn.textContent = note.pinned ? '📌' : '📍';
    pinBtn.title = note.pinned ? 'Unpin' : 'Pin';
    pinBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      Store.togglePinNote(note.id);
      document.dispatchEvent(new Event('mareo:render'));
    });

    // Delete button
    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'note-delete btn-icon';
    deleteBtn.textContent = '✕';
    deleteBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      Store.removeNote(note.id);
      document.dispatchEvent(new Event('mareo:render'));
    });

    // Title
    const title = document.createElement('input');
    title.className = 'note-title';
    title.type = 'text';
    title.placeholder = 'Title';
    title.value = note.title;
    title.addEventListener('change', () => {
      Store.updateNote(note.id, { title: title.value });
    });

    // Content
    const content = document.createElement('textarea');
    content.className = 'note-content';
    content.placeholder = 'Take a note...';
    content.value = note.content;
    content.addEventListener('input', () => {
      autoResizeTextarea(content);
    });
    content.addEventListener('change', () => {
      Store.updateNote(note.id, { content: content.value });
    });

    // Color picker
    const colorBar = document.createElement('div');
    colorBar.className = 'note-colors';
    for (const c of NOTE_COLORS) {
      const dot = document.createElement('div');
      dot.className = 'color-dot';
      dot.style.backgroundColor = c.value;
      dot.title = c.name;
      if (c.value === note.color) dot.classList.add('active');
      dot.addEventListener('click', (ev) => {
        ev.stopPropagation();
        Store.updateNote(note.id, { color: c.value });
        card.style.backgroundColor = c.value;
        colorBar.querySelectorAll('.color-dot').forEach(d => d.classList.remove('active'));
        dot.classList.add('active');
      });
      colorBar.appendChild(dot);
    }

    const actions = document.createElement('div');
    actions.className = 'note-actions';
    actions.appendChild(pinBtn);
    actions.appendChild(deleteBtn);

    card.appendChild(actions);
    card.appendChild(title);
    card.appendChild(content);
    card.appendChild(colorBar);
    container.appendChild(card);

    // Auto-resize after render
    requestAnimationFrame(() => autoResizeTextarea(content));
  }
}

function autoResizeTextarea(el) {
  el.style.height = 'auto';
  el.style.height = el.scrollHeight + 'px';
}
