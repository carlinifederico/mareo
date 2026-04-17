import { Store } from './store.js';
import { icon } from './icons.js';

let pipWindow = null;
let panelEl = null;
let collapsed = false;
let mobileOpen = false;

export function initTodayPanel() {
  panelEl = document.getElementById('today-panel');
  if (!panelEl) return;

  // Re-render whenever the app re-renders (so it stays in sync)
  document.addEventListener('mareo:render', () => renderTodayPanel());

  // Initial render
  renderTodayPanel();

  // Mobile FAB toggle
  const fab = document.getElementById('today-fab');
  if (fab) {
    fab.addEventListener('click', () => {
      mobileOpen = !mobileOpen;
      panelEl.classList.toggle('mobile-open', mobileOpen);
      if (mobileOpen) {
        requestAnimationFrame(() => {
          panelEl.querySelectorAll('.today-text').forEach(autoResizeTextarea);
        });
      }
    });
  }
}

export function renderTodayPanel() {
  if (!panelEl) panelEl = document.getElementById('today-panel');
  if (!panelEl) return;

  const items = Store.getTodayItems();

  panelEl.innerHTML = '';
  panelEl.classList.toggle('collapsed', collapsed);

  // Header
  const header = document.createElement('div');
  header.className = 'today-header';

  const title = document.createElement('div');
  title.className = 'today-title';
  title.textContent = 'TODAY';

  const count = document.createElement('span');
  count.className = 'today-count';
  count.textContent = items.length;
  title.appendChild(count);

  const actions = document.createElement('div');
  actions.className = 'today-actions';

  const collapseBtn = document.createElement('button');
  collapseBtn.className = 'btn-icon today-collapse';
  collapseBtn.title = collapsed ? 'Expand' : 'Collapse';
  collapseBtn.innerHTML = collapsed ? icon('chevron-up') : icon('chevron-down');
  collapseBtn.addEventListener('click', () => {
    collapsed = !collapsed;
    renderTodayPanel();
  });

  const popoutBtn = document.createElement('button');
  popoutBtn.className = 'btn-icon today-popout';
  popoutBtn.title = 'Pop out floating window';
  popoutBtn.innerHTML = icon('popout');
  popoutBtn.addEventListener('click', popoutToPiP);

  actions.appendChild(collapseBtn);
  actions.appendChild(popoutBtn);

  header.appendChild(title);
  header.appendChild(actions);
  panelEl.appendChild(header);

  // Body
  if (collapsed) return;

  const body = document.createElement('div');
  body.className = 'today-body';

  if (items.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'today-empty';
    empty.innerHTML = `No tasks for today. Click ${icon('dot')} on any project note.`;
    body.appendChild(empty);
  } else {
    for (const item of items) {
      body.appendChild(createTodayRow(item));
    }
  }

  panelEl.appendChild(body);
  attachTodayReorderDnD(body);
  updateFabCount(items.length);
}

function createTodayRow(item) {
  const { projectId, projectName, projectColor, note } = item;
  const row = document.createElement('div');
  row.className = 'today-row' + (note.done ? ' done' : '');
  row.dataset.noteId = note.id;

  const grip = document.createElement('span');
  grip.className = 'today-drag-grip';
  grip.innerHTML = icon('drag-handle');
  grip.title = 'Drag to reorder';

  const checkbox = document.createElement('input');
  checkbox.type = 'checkbox';
  checkbox.className = 'note-preview-check';
  checkbox.checked = !!note.done;
  checkbox.addEventListener('change', () => {
    Store.updateProjectNote(projectId, note.id, { done: checkbox.checked });
    document.dispatchEvent(new Event('mareo:render'));
  });

  const text = document.createElement('textarea');
  text.rows = 1;
  text.className = 'today-text';
  text.value = note.title || note.content || '';
  text.placeholder = 'Note...';
  text.addEventListener('change', () => {
    Store.updateProjectNote(projectId, note.id, { title: text.value });
    document.dispatchEvent(new Event('mareo:render'));
  });
  text.addEventListener('input', () => autoResizeTextarea(text));
  // Block the reorder pointerdown when interacting with the text
  text.addEventListener('pointerdown', (e) => e.stopPropagation());
  requestAnimationFrame(() => autoResizeTextarea(text));

  const label = document.createElement('button');
  label.className = 'today-project-label';
  label.style.backgroundColor = projectColor;
  label.style.color = pickContrastColor(projectColor);
  label.textContent = projectName;
  label.title = 'Open in Board';
  label.addEventListener('click', () => {
    Store.setView('board');
    document.dispatchEvent(new CustomEvent('mareo:switchView', { detail: 'board' }));
    document.dispatchEvent(new Event('mareo:render'));
    // Highlight target card
    setTimeout(() => {
      const card = document.querySelector(`.board-project-card[data-project-id="${projectId}"]`);
      if (card) {
        card.classList.add('flash');
        card.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' });
        setTimeout(() => card.classList.remove('flash'), 1500);
      }
    }, 100);
  });

  const removeBtn = document.createElement('button');
  removeBtn.className = 'btn-icon today-remove';
  removeBtn.title = 'Remove from Today';
  removeBtn.innerHTML = icon('close');
  removeBtn.addEventListener('click', () => {
    Store.toggleTodayNote(projectId, note.id);
    document.dispatchEvent(new Event('mareo:render'));
  });

  row.appendChild(grip);
  row.appendChild(checkbox);
  row.appendChild(text);
  row.appendChild(label);
  row.appendChild(removeBtn);
  return row;
}

function autoResizeTextarea(el) {
  if (!el) return;
  el.style.height = 'auto';
  el.style.height = el.scrollHeight + 'px';
}

// Pointer-based reorder. Listeners for pointermove/pointerup are attached to
// the contextual window (main window OR the Document PiP window, depending on
// where the panel currently lives) so the drag keeps tracking even when the
// pointer leaves the body rect.
function attachTodayReorderDnD(body) {
  body.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    const grip = e.target.closest('.today-drag-grip');
    if (!grip) return;
    const dragRow = grip.closest('.today-row');
    if (!dragRow) return;
    const dragId = dragRow.dataset.noteId;
    if (!dragId) return;

    e.preventDefault();
    dragRow.classList.add('dragging');

    const doc = body.ownerDocument || document;
    const win = doc.defaultView || window;
    try { grip.setPointerCapture(e.pointerId); } catch {}

    let targetId = null;

    const findRowAt = (clientX, clientY) => {
      const under = doc.elementFromPoint(clientX, clientY);
      return under?.closest?.('.today-row') || null;
    };

    const clearDragOver = () => {
      body.querySelectorAll('.today-row').forEach(n => n.classList.remove('drag-over'));
    };

    const onMove = (mv) => {
      const target = findRowAt(mv.clientX, mv.clientY);
      clearDragOver();
      if (target && target !== dragRow) {
        target.classList.add('drag-over');
        targetId = target.dataset.noteId || null;
      } else {
        targetId = null;
      }
    };

    const cleanup = () => {
      win.removeEventListener('pointermove', onMove);
      win.removeEventListener('pointerup', onUp);
      win.removeEventListener('pointercancel', onUp);
      try { grip.releasePointerCapture(e.pointerId); } catch {}
      dragRow.classList.remove('dragging');
      clearDragOver();
    };

    const onUp = (up) => {
      const target = findRowAt(up.clientX, up.clientY);
      const finalId = (target && target !== dragRow) ? (target.dataset.noteId || null) : targetId;
      cleanup();
      if (finalId && finalId !== dragId) {
        Store.reorderTodayItem(dragId, finalId);
        document.dispatchEvent(new Event('mareo:render'));
      }
    };

    win.addEventListener('pointermove', onMove);
    win.addEventListener('pointerup', onUp);
    win.addEventListener('pointercancel', onUp);
  });
}

function updateFabCount(n) {
  const badge = document.querySelector('#today-fab .today-fab-badge');
  if (badge) badge.textContent = n > 0 ? n : '';
}

function pickContrastColor(hex) {
  // Simple luminance check for #rrggbb
  if (!hex || hex[0] !== '#' || hex.length < 7) return '#000';
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return lum > 0.55 ? '#000' : '#fff';
}

async function popoutToPiP() {
  if (!('documentPictureInPicture' in window)) {
    alert('Tu navegador no soporta ventana flotante. Usá Chrome o Edge 116+.');
    return;
  }
  if (pipWindow) {
    pipWindow.focus();
    return;
  }
  try {
    pipWindow = await documentPictureInPicture.requestWindow({ width: 340, height: 560 });
  } catch (err) {
    console.warn('PiP request failed:', err);
    return;
  }

  // Hard-copy CSS custom properties from :root so the PiP has colors even
  // before any stylesheet finishes loading.
  const rootVars = [
    '--bg', '--bg-surface', '--bg-hover', '--text', '--text-muted',
    '--border', '--accent', '--accent-2', '--danger', '--coral',
    '--mint', '--blue', '--cyan', '--pink', '--orange', '--lime'
  ];
  const srcStyle = getComputedStyle(document.documentElement);
  for (const v of rootVars) {
    const val = srcStyle.getPropertyValue(v);
    if (val) pipWindow.document.documentElement.style.setProperty(v, val);
  }

  // Copy stylesheets to PiP window. Prefer inlining cssRules (works for
  // same-origin sheets including file://) and fall back to <link> only if
  // cssRules throws (CORS-protected cross-origin).
  for (const sheet of document.styleSheets) {
    try {
      const css = [...sheet.cssRules].map(r => r.cssText).join('\n');
      const style = pipWindow.document.createElement('style');
      style.textContent = css;
      pipWindow.document.head.appendChild(style);
    } catch {
      if (sheet.href) {
        const link = pipWindow.document.createElement('link');
        link.rel = 'stylesheet';
        link.href = sheet.href;
        pipWindow.document.head.appendChild(link);
      }
    }
  }

  pipWindow.document.documentElement.classList.add('pip-mode');
  pipWindow.document.body.classList.add('pip-mode');
  pipWindow.document.body.appendChild(panelEl);

  pipWindow.addEventListener('pagehide', () => {
    document.body.appendChild(panelEl);
    pipWindow = null;
  });
}
