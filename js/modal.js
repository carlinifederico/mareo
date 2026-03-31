let overlay = null;

export function showModal({ title, fields, onSave, onDelete }) {
  closeModal();

  overlay = document.createElement('div');
  overlay.className = 'modal-overlay';

  const modal = document.createElement('div');
  modal.className = 'modal';

  const header = document.createElement('h3');
  header.textContent = title;
  modal.appendChild(header);

  const form = document.createElement('form');

  for (const field of fields) {
    const group = document.createElement('div');
    group.className = 'modal-field';

    const label = document.createElement('label');
    label.textContent = field.label;
    label.htmlFor = 'field-' + field.name;
    group.appendChild(label);

    const input = document.createElement('input');
    input.type = field.type || 'text';
    input.id = 'field-' + field.name;
    input.name = field.name;
    input.value = field.value != null ? field.value : '';
    if (field.min != null) input.min = field.min;
    if (field.max != null) input.max = field.max;
    group.appendChild(input);

    form.appendChild(group);
  }

  const actions = document.createElement('div');
  actions.className = 'modal-actions';

  if (onDelete) {
    const deleteBtn = document.createElement('button');
    deleteBtn.type = 'button';
    deleteBtn.className = 'btn btn-danger';
    deleteBtn.textContent = 'Delete';
    deleteBtn.addEventListener('click', () => {
      closeModal();
      onDelete();
    });
    actions.appendChild(deleteBtn);
  }

  const cancelBtn = document.createElement('button');
  cancelBtn.type = 'button';
  cancelBtn.className = 'btn btn-secondary';
  cancelBtn.textContent = 'Cancel';
  cancelBtn.addEventListener('click', closeModal);
  actions.appendChild(cancelBtn);

  const saveBtn = document.createElement('button');
  saveBtn.type = 'submit';
  saveBtn.className = 'btn btn-primary';
  saveBtn.textContent = 'Save';
  actions.appendChild(saveBtn);

  form.appendChild(actions);
  modal.appendChild(form);

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const formData = new FormData(form);
    const values = {};
    for (const field of fields) {
      values[field.name] = formData.get(field.name);
    }
    closeModal();
    onSave(values);
  });

  overlay.appendChild(modal);
  document.body.appendChild(overlay);

  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) closeModal();
  });

  // Focus first text input
  const firstInput = form.querySelector('input[type="text"], input[type="number"], input[type="date"]');
  if (firstInput) firstInput.focus();

  // Escape to close
  const onKey = (e) => {
    if (e.key === 'Escape') {
      closeModal();
      document.removeEventListener('keydown', onKey);
    }
  };
  document.addEventListener('keydown', onKey);
}

export function showLinksModal(proj) {
  closeModal();

  overlay = document.createElement('div');
  overlay.className = 'modal-overlay';

  const modal = document.createElement('div');
  modal.className = 'modal modal-links';

  const header = document.createElement('h3');
  header.textContent = `Links - ${proj.name}`;
  modal.appendChild(header);

  const linksContainer = document.createElement('div');
  linksContainer.className = 'links-list';

  function renderLinks() {
    linksContainer.innerHTML = '';
    const links = proj.links || [];

    for (let i = 0; i < links.length; i++) {
      const link = links[i];
      const row = document.createElement('div');
      row.className = 'link-row';

      const labelInput = document.createElement('input');
      labelInput.type = 'text';
      labelInput.placeholder = 'Label';
      labelInput.value = link.label;
      labelInput.addEventListener('change', () => {
        link.label = labelInput.value;
      });

      const urlInput = document.createElement('input');
      urlInput.type = 'text';
      urlInput.placeholder = 'URL';
      urlInput.value = link.url;
      urlInput.addEventListener('change', () => {
        link.url = urlInput.value;
      });

      const removeBtn = document.createElement('button');
      removeBtn.type = 'button';
      removeBtn.className = 'btn-icon';
      removeBtn.textContent = '✕';
      removeBtn.addEventListener('click', () => {
        proj.links.splice(i, 1);
        renderLinks();
      });

      row.appendChild(labelInput);
      row.appendChild(urlInput);
      row.appendChild(removeBtn);
      linksContainer.appendChild(row);
    }

    const addBtn = document.createElement('button');
    addBtn.type = 'button';
    addBtn.className = 'btn btn-secondary';
    addBtn.textContent = '+ Add Link';
    addBtn.addEventListener('click', () => {
      if (!proj.links) proj.links = [];
      proj.links.push({ label: '', url: '' });
      renderLinks();
    });
    linksContainer.appendChild(addBtn);
  }

  renderLinks();
  modal.appendChild(linksContainer);

  const actions = document.createElement('div');
  actions.className = 'modal-actions';

  const doneBtn = document.createElement('button');
  doneBtn.type = 'button';
  doneBtn.className = 'btn btn-primary';
  doneBtn.textContent = 'Done';
  doneBtn.addEventListener('click', () => {
    // Remove empty links
    proj.links = (proj.links || []).filter(l => l.label.trim() || l.url.trim());
    const { Store } = window._mareoModules;
    Store.updateProject(proj.id, { links: proj.links });
    closeModal();
  });
  actions.appendChild(doneBtn);

  modal.appendChild(actions);
  overlay.appendChild(modal);
  document.body.appendChild(overlay);

  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) closeModal();
  });
}

function closeModal() {
  if (overlay) {
    overlay.remove();
    overlay = null;
  }
}
