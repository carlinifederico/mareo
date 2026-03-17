import { Store } from './store.js';
import { Auth } from './auth.js';
import { renderTimelineHeader, getWeekWidth, getTodayWeekIndex } from './timeline.js';
import { renderSidebar, setSidebarProjectClickHandler } from './sidebar.js';
import { renderGantt } from './gantt.js';
import { initDragDrop } from './dragdrop.js';
import { showLinksModal } from './modal.js';
import { renderBoard, initBoardDrag, initBoardZoom } from './board.js';
import { renderNotes } from './notes.js';
import { renderExpenses, ensureCurrentMonth } from './expenses.js';
import { renderBalance } from './balance.js';
import { initPan } from './pan.js';

window._mareoModules = { Store };

let currentView = 'timeline';
let appInitialized = false;

// Auth flow: show login or app
Auth.init(
  // On sign in
  async (user) => {
    document.getElementById('login-screen').style.display = 'none';
    document.getElementById('app-container').style.display = '';

    // Show user info
    const avatar = document.getElementById('user-avatar');
    if (user.photoURL) {
      avatar.src = user.photoURL;
      avatar.style.display = '';
    } else {
      avatar.style.display = 'none';
    }

    // Load data with user ID
    await Store.load(user.uid);
    ensureCurrentMonth();
    currentView = Store.data.currentView || 'timeline';

    if (!appInitialized) {
      initApp();
      appInitialized = true;
    }

    switchView(currentView);
    render();
  },
  // On sign out
  () => {
    document.getElementById('login-screen').style.display = '';
    document.getElementById('app-container').style.display = 'none';
    document.getElementById('login-loading').style.display = 'none';
  }
);

// Google sign-in button
document.getElementById('btn-google-signin').addEventListener('click', () => {
  document.getElementById('login-loading').style.display = '';
  Auth.signInWithGoogle();
});

// Sign out button
document.getElementById('btn-signout').addEventListener('click', () => {
  Auth.signOut();
});

function initApp() {
  initDragDrop();
  initBoardDrag();
  initPan();

  // View tabs
  document.querySelectorAll('.view-tab').forEach(tab => {
    tab.addEventListener('click', () => switchView(tab.dataset.view));
  });

  document.addEventListener('mareo:switchView', (e) => {
    switchView(e.detail);
  });

  // Year navigation
  document.getElementById('btn-prev-year').addEventListener('click', () => {
    Store.setYear(Store.data.currentYear - 1);
    render();
  });
  document.getElementById('btn-next-year').addEventListener('click', () => {
    Store.setYear(Store.data.currentYear + 1);
    render();
  });
  document.getElementById('btn-today').addEventListener('click', () => {
    const now = new Date();
    Store.setYear(now.getFullYear());
    render();
    const weekIndex = getTodayWeekIndex(now.getFullYear());
    if (weekIndex >= 0) {
      const timelineArea = document.getElementById('timeline-area');
      const weekWidth = getWeekWidth();
      const targetX = weekIndex * weekWidth - timelineArea.clientWidth / 2 + weekWidth / 2;
      timelineArea.scrollTo({ left: Math.max(0, targetX), behavior: 'smooth' });
    }
  });

  // Import/Export
  document.getElementById('btn-export').addEventListener('click', exportData);
  document.getElementById('btn-import').addEventListener('click', importData);

  // Project name click
  setSidebarProjectClickHandler((e, proj) => showProjectLinksDropdown(e, proj));

  // Scroll sync
  const timelineArea = document.getElementById('timeline-area');
  const sidebarScroll = document.getElementById('sidebar-scroll');
  const timelineHeader = document.querySelector('.timeline-header-wrapper');

  let syncing = false;
  timelineArea.addEventListener('scroll', () => {
    if (syncing) return;
    syncing = true;
    sidebarScroll.scrollTop = timelineArea.scrollTop;
    timelineHeader.scrollLeft = timelineArea.scrollLeft;
    syncing = false;
  });
  sidebarScroll.addEventListener('scroll', () => {
    if (syncing) return;
    syncing = true;
    timelineArea.scrollTop = sidebarScroll.scrollTop;
    syncing = false;
  });

  // Board: Add card
  document.getElementById('btn-add-board-card').addEventListener('click', () => {
    const canvas = document.getElementById('board-canvas');
    Store.addBoardCard({
      title: 'New Card', content: '',
      x: canvas.scrollLeft + 100 + Math.random() * 200,
      y: canvas.scrollTop + 100 + Math.random() * 100
    });
    render();
  });

  // Notes: Add note
  document.getElementById('btn-add-note').addEventListener('click', () => {
    Store.addNote({ title: '', content: '' });
    render();
  });

  // Notes: Search
  document.getElementById('notes-search').addEventListener('input', (e) => {
    renderNotes(document.getElementById('notes-grid'), e.target.value);
  });

  // Listen for render events
  document.addEventListener('mareo:render', () => render());

  // Init board zoom after first render
  requestAnimationFrame(() => initBoardZoom());
}

function switchView(view) {
  currentView = view;
  Store.setView(view);

  document.querySelectorAll('.view-tab').forEach(t => {
    t.classList.toggle('active', t.dataset.view === view);
  });

  document.querySelectorAll('.view-container').forEach(v => {
    v.classList.toggle('active', v.id === 'view-' + view);
  });

  // Year nav only in timeline
  document.getElementById('year-nav').style.display = view === 'timeline' ? 'flex' : 'none';

  render();
}

function render() {
  if (!Store.data) return;

  const year = Store.data.currentYear;
  document.getElementById('current-year').textContent = year;

  if (currentView === 'timeline') {
    renderTimelineHeader(document.getElementById('timeline-header'), year);
    renderSidebar(document.getElementById('sidebar-content'));
    renderGantt(document.getElementById('gantt-body'));
    syncRowHeights();
  } else if (currentView === 'board') {
    renderBoard(document.getElementById('board-canvas'));
  } else if (currentView === 'notes') {
    const query = document.getElementById('notes-search').value;
    renderNotes(document.getElementById('notes-grid'), query);
  } else if (currentView === 'expenses') {
    renderExpenses(document.getElementById('expenses-body'));
  } else if (currentView === 'balance') {
    renderBalance(document.getElementById('balance-body'));
  }
}

function syncRowHeights() {
  const sidebarItems = document.querySelectorAll('#sidebar-content > *');
  const ganttItems = document.querySelectorAll('#gantt-body > *');
  const minLen = Math.min(sidebarItems.length, ganttItems.length);
  for (let i = 0; i < minLen; i++) {
    const sH = sidebarItems[i].getBoundingClientRect().height;
    const gH = ganttItems[i].getBoundingClientRect().height;
    const maxH = Math.max(sH, gH);
    sidebarItems[i].style.height = maxH + 'px';
    ganttItems[i].style.height = maxH + 'px';
  }
}

function showProjectLinksDropdown(e, proj) {
  document.querySelectorAll('.project-links-dropdown').forEach(d => d.remove());
  const dropdown = document.createElement('div');
  dropdown.className = 'project-links-dropdown';

  if (proj.links && proj.links.length > 0) {
    for (const link of proj.links) {
      const a = document.createElement('a');
      a.href = link.url; a.target = '_blank'; a.rel = 'noopener';
      a.textContent = link.label || link.url;
      dropdown.appendChild(a);
    }
  } else {
    const empty = document.createElement('div');
    empty.className = 'dropdown-empty';
    empty.textContent = 'No links yet';
    dropdown.appendChild(empty);
  }

  const editBtn = document.createElement('button');
  editBtn.className = 'dropdown-edit-btn';
  editBtn.textContent = '⚙ Manage Links';
  editBtn.addEventListener('click', (ev) => {
    ev.stopPropagation(); dropdown.remove(); showLinksModal(proj);
  });
  dropdown.appendChild(editBtn);

  const rect = e.target.getBoundingClientRect();
  dropdown.style.position = 'fixed';
  dropdown.style.left = rect.left + 'px';
  dropdown.style.top = rect.bottom + 4 + 'px';
  dropdown.style.zIndex = '10000';

  document.body.appendChild(dropdown);
  setTimeout(() => {
    document.addEventListener('click', (ev) => {
      if (!dropdown.contains(ev.target)) dropdown.remove();
    }, { once: true });
  });
}

function exportData() {
  const json = Store.exportJSON();
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `mareo-${Store.data.currentYear}-${Date.now()}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

function importData() {
  const input = document.createElement('input');
  input.type = 'file'; input.accept = '.json';
  input.addEventListener('change', async () => {
    const file = input.files[0];
    if (!file) return;
    try {
      const text = await file.text();
      Store.importJSON(text);
      render();
    } catch (err) { alert('Error importing file: ' + err.message); }
  });
  input.click();
}
