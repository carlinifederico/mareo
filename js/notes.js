import { Store } from './store.js';

const NOTE_COLORS = [
  { name: 'Default', value: '#111119' },
  { name: 'Red', value: '#2a1520' },
  { name: 'Green', value: '#0f2a1f' },
  { name: 'Blue', value: '#0f1a2d' },
  { name: 'Purple', value: '#1a1430' },
  { name: 'Orange', value: '#2a1a0f' },
  { name: 'Teal', value: '#0f2525' },
  { name: 'Yellow', value: '#2a2a0f' }
];

export function renderNotes(container, searchQuery) {
  container.innerHTML = '';
  const query = (searchQuery || '').toLowerCase();

  // === PROJECTS section ===
  const projects = Store.getAllProjects();

  if (!query || projects.some(p => p.name.toLowerCase().includes(query))) {
    const projectsHeader = document.createElement('div');
    projectsHeader.className = 'notes-section-header';
    projectsHeader.textContent = 'PROJECTS';
    container.appendChild(projectsHeader);

    for (const proj of projects) {
      if (query && !proj.name.toLowerCase().includes(query)) continue;

      // Project header card
      const projCard = document.createElement('div');
      projCard.className = 'note-card note-project-card';
      projCard.style.borderLeft = `4px solid ${proj.color}`;

      const projTitle = document.createElement('div');
      projTitle.className = 'note-project-title';
      projTitle.textContent = proj.name;

      const projCat = document.createElement('div');
      projCat.className = 'note-project-category';
      projCat.textContent = proj.categoryName;

      const addNoteBtn = document.createElement('button');
      addNoteBtn.className = 'btn btn-secondary note-add-btn';
      addNoteBtn.textContent = '+ Add Note';
      addNoteBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        Store.addProjectNote(proj.id, { title: '', content: '' });
        document.dispatchEvent(new Event('mareo:render'));
      });

      projCard.appendChild(projTitle);
      projCard.appendChild(projCat);
      projCard.appendChild(addNoteBtn);

      // Project notes
      const projNotes = proj.projectNotes || [];
      if (projNotes.length > 0) {
        const notesList = document.createElement('div');
        notesList.className = 'project-notes-list';

        for (const pn of projNotes) {
          const noteItem = document.createElement('div');
          noteItem.className = 'project-note-item';

          const noteCheck = document.createElement('input');
          noteCheck.type = 'checkbox';
          noteCheck.className = 'project-note-check';
          noteCheck.checked = !!pn.done;
          noteCheck.addEventListener('change', () => {
            Store.updateProjectNote(proj.id, pn.id, { done: noteCheck.checked });
            noteItem.classList.toggle('done', noteCheck.checked);
          });

          const noteTitle = document.createElement('input');
          noteTitle.type = 'text';
          noteTitle.className = 'project-note-title';
          noteTitle.placeholder = 'Note title...';
          noteTitle.value = pn.title;
          noteTitle.addEventListener('change', () => {
            Store.updateProjectNote(proj.id, pn.id, { title: noteTitle.value });
          });

          const noteContent = document.createElement('textarea');
          noteContent.className = 'project-note-content';
          noteContent.placeholder = 'Write here...';
          noteContent.value = pn.content;
          noteContent.addEventListener('input', () => autoResizeTextarea(noteContent));
          noteContent.addEventListener('change', () => {
            Store.updateProjectNote(proj.id, pn.id, { content: noteContent.value });
          });

          const noteActions = document.createElement('div');
          noteActions.className = 'project-note-actions';

          const pnIndex = projNotes.indexOf(pn);
          if (pnIndex > 0) {
            const upBtn = document.createElement('button');
            upBtn.className = 'btn-icon note-reorder-btn';
            upBtn.textContent = '▲';
            upBtn.title = 'Move up';
            upBtn.addEventListener('click', () => {
              Store.reorderProjectNote(proj.id, pn.id, -1);
              document.dispatchEvent(new Event('mareo:render'));
            });
            noteActions.appendChild(upBtn);
          }
          if (pnIndex < projNotes.length - 1) {
            const downBtn = document.createElement('button');
            downBtn.className = 'btn-icon note-reorder-btn';
            downBtn.textContent = '▼';
            downBtn.title = 'Move down';
            downBtn.addEventListener('click', () => {
              Store.reorderProjectNote(proj.id, pn.id, 1);
              document.dispatchEvent(new Event('mareo:render'));
            });
            noteActions.appendChild(downBtn);
          }

          const delBtn = document.createElement('button');
          delBtn.className = 'btn-icon project-note-delete';
          delBtn.textContent = '✕';
          delBtn.addEventListener('click', () => {
            Store.removeProjectNote(proj.id, pn.id);
            document.dispatchEvent(new Event('mareo:render'));
          });
          noteActions.appendChild(delBtn);

          if (pn.done) noteItem.classList.add('done');
          noteItem.appendChild(noteActions);
          noteItem.appendChild(noteCheck);
          noteItem.appendChild(noteTitle);
          noteItem.appendChild(noteContent);
          notesList.appendChild(noteItem);

          requestAnimationFrame(() => autoResizeTextarea(noteContent));
        }
        projCard.appendChild(notesList);
      }

      container.appendChild(projCard);
    }
  }

  // === GENERAL NOTES section ===
  let notes = [...Store.data.notes];

  if (query) {
    notes = notes.filter(n =>
      (n.title || '').toLowerCase().includes(query) ||
      (n.content || '').toLowerCase().includes(query)
    );
  }

  notes.sort((a, b) => {
    if (a.pinned && !b.pinned) return -1;
    if (!a.pinned && b.pinned) return 1;
    return b.updatedAt - a.updatedAt;
  });

  if (notes.length > 0 || !query) {
    const generalHeader = document.createElement('div');
    generalHeader.className = 'notes-section-header';
    generalHeader.textContent = 'GENERAL NOTES';
    container.appendChild(generalHeader);
  }

  if (notes.length === 0 && !query && projects.length === 0) {
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
    card.style.backgroundColor = note.color || '#1a1433';

    const pinBtn = document.createElement('button');
    pinBtn.className = 'note-pin btn-icon';
    pinBtn.textContent = note.pinned ? '📌' : '📍';
    pinBtn.title = note.pinned ? 'Unpin' : 'Pin';
    pinBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      Store.togglePinNote(note.id);
      document.dispatchEvent(new Event('mareo:render'));
    });

    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'note-delete btn-icon';
    deleteBtn.textContent = '✕';
    deleteBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      Store.removeNote(note.id);
      document.dispatchEvent(new Event('mareo:render'));
    });

    const title = document.createElement('input');
    title.className = 'note-title';
    title.type = 'text';
    title.placeholder = 'Title';
    title.value = note.title;
    title.addEventListener('change', () => {
      Store.updateNote(note.id, { title: title.value });
    });

    const content = document.createElement('textarea');
    content.className = 'note-content';
    content.placeholder = 'Take a note...';
    content.value = note.content;
    content.addEventListener('input', () => autoResizeTextarea(content));
    content.addEventListener('change', () => {
      Store.updateNote(note.id, { content: content.value });
    });

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

    requestAnimationFrame(() => autoResizeTextarea(content));
  }
}

function autoResizeTextarea(el) {
  el.style.height = 'auto';
  el.style.height = el.scrollHeight + 'px';
}
