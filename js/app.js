import { Store } from './store.js';
import { Auth } from './auth.js';
import { renderTimelineHeader, getWeekWidth, getDayWidth, setWeekWidth, resetWeekWidth, getDefaultWeekWidth, getTodayWeekIndex, getTodayPixelX, isDayMode, getTotalWidth } from './timeline.js';
import { renderSidebar, setSidebarProjectClickHandler } from './sidebar.js';
import { renderGantt } from './gantt.js';
import { initDragDrop } from './dragdrop.js';
import { showLinksModal } from './modal.js';
import { renderBoard, initBoardDrag, initBoardZoom } from './board.js';
import { initTodayPanel } from './today.js';
import { renderNotes } from './notes.js';
import { renderExpenses, ensureCurrentMonth } from './expenses.js';
import { renderBalance } from './balance.js';
import { initPan } from './pan.js';

window._mareoModules = { Store };

let currentView = 'timeline';
let appInitialized = false;

const ALL_VIEWS = [
  { id: 'timeline', label: 'Timeline' },
  { id: 'notes',    label: 'Notes' },
  { id: 'expenses', label: 'Expenses' },
  { id: 'balance',  label: 'Balance' },
  { id: 'board',    label: 'Board' },
];

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
    if (!Store.data.visibleTabs.includes(currentView)) {
      currentView = Store.data.visibleTabs[0];
    }

    if (!appInitialized) {
      initApp();
      appInitialized = true;
    }

    renderTabs();
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
  initTodayPanel();
  initPan();

  // Mobile menu toggle
  const mobileMenuBtn = document.getElementById('mobile-menu-btn');
  const viewTabsNav = document.getElementById('view-tabs-nav');
  mobileMenuBtn.addEventListener('click', () => {
    viewTabsNav.classList.toggle('open');
  });

  document.addEventListener('click', (e) => {
    const menu = document.querySelector('.view-tab-more-menu');
    if (menu) menu.classList.remove('open');
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
    scrollToToday();
  });

  // Timeline zoom (Ctrl+scroll or pinch)
  const timelineArea = document.getElementById('timeline-area');
  timelineArea.addEventListener('wheel', (e) => {
    if (!e.ctrlKey && !e.metaKey) return;
    e.preventDefault();
    const oldWeekWidth = getWeekWidth();
    const year = Store.data.currentYear;
    const oldTotalWidth = getTotalWidth();

    const rect = timelineArea.getBoundingClientRect();
    const mouseX = e.clientX - rect.left + timelineArea.scrollLeft;
    const fraction = mouseX / oldTotalWidth;

    const delta = e.deltaY > 0 ? -5 : 5;
    setWeekWidth(oldWeekWidth + delta);

    if (getWeekWidth() !== oldWeekWidth) {
      render();
      const newTotalWidth = getTotalWidth();
      const newScrollLeft = fraction * newTotalWidth - (e.clientX - rect.left);
      timelineArea.scrollLeft = Math.max(0, newScrollLeft);
    }
  }, { passive: false });

  // Touch pinch zoom for mobile
  let lastPinchDist = 0;
  timelineArea.addEventListener('touchstart', (e) => {
    if (e.touches.length === 2) {
      lastPinchDist = Math.hypot(
        e.touches[0].clientX - e.touches[1].clientX,
        e.touches[0].clientY - e.touches[1].clientY
      );
    }
  });
  timelineArea.addEventListener('touchmove', (e) => {
    if (e.touches.length === 2) {
      e.preventDefault();
      const dist = Math.hypot(
        e.touches[0].clientX - e.touches[1].clientX,
        e.touches[0].clientY - e.touches[1].clientY
      );
      const diff = dist - lastPinchDist;
      if (Math.abs(diff) > 3) {
        const oldWidth = getWeekWidth();
        setWeekWidth(oldWidth + (diff > 0 ? 3 : -3));
        if (getWeekWidth() !== oldWidth) render();
        lastPinchDist = dist;
      }
    }
  }, { passive: false });

  // Reset view button
  document.getElementById('btn-reset-view').addEventListener('click', () => {
    resetWeekWidth();
    render();
    scrollToToday();
  });

  // Import/Export
  document.getElementById('btn-export').addEventListener('click', exportData);
  document.getElementById('btn-import').addEventListener('click', importData);

  // Sidebar resize handle
  const resizeHandle = document.getElementById('sidebar-resize-handle');
  const sidebar = document.querySelector('.sidebar');
  if (resizeHandle && sidebar) {
    let resizing = false;
    let startX = 0;
    let startW = 0;

    resizeHandle.addEventListener('pointerdown', (e) => {
      resizing = true;
      startX = e.clientX;
      startW = sidebar.getBoundingClientRect().width;
      resizeHandle.classList.add('active');
      resizeHandle.setPointerCapture(e.pointerId);
      document.body.style.cursor = 'col-resize';
      e.preventDefault();
    });

    resizeHandle.addEventListener('pointermove', (e) => {
      if (!resizing) return;
      const newW = Math.max(80, Math.min(window.innerWidth * 0.5, startW + e.clientX - startX));
      sidebar.style.width = newW + 'px';
      document.documentElement.style.setProperty('--sidebar-width', newW + 'px');
    });

    resizeHandle.addEventListener('pointerup', () => {
      resizing = false;
      resizeHandle.classList.remove('active');
      document.body.style.cursor = '';
    });
  }

  // Project name click
  setSidebarProjectClickHandler((e, proj) => showProjectLinksDropdown(e, proj));

  // Scroll sync (sidebar vertical only — header scrolls naturally with timeline-area)
  const sidebarScroll = document.getElementById('sidebar-scroll');

  let syncing = false;
  timelineArea.addEventListener('scroll', () => {
    if (syncing) return;
    syncing = true;
    sidebarScroll.scrollTop = timelineArea.scrollTop;
    syncing = false;
  });
  sidebarScroll.addEventListener('scroll', () => {
    if (syncing) return;
    syncing = true;
    timelineArea.scrollTop = sidebarScroll.scrollTop;
    syncing = false;
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

  // Undo / Redo
  document.getElementById('btn-undo').addEventListener('click', () => {
    if (Store.undo()) { render(); updateUndoButtons(); }
  });
  document.getElementById('btn-redo').addEventListener('click', () => {
    if (Store.redo()) { render(); updateUndoButtons(); }
  });
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
      e.preventDefault();
      if (Store.undo()) { render(); updateUndoButtons(); }
    } else if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || (e.shiftKey && e.key === 'z') || (e.shiftKey && e.key === 'Z'))) {
      e.preventDefault();
      if (Store.redo()) { render(); updateUndoButtons(); }
    }
  });

  // Listen for render events
  document.addEventListener('mareo:render', () => render());

  // Init board zoom after first render
  requestAnimationFrame(() => initBoardZoom());
}

function scrollToToday() {
  const now = new Date();
  if (Store.data.currentYear !== now.getFullYear()) return;
  const timelineArea = document.getElementById('timeline-area');
  const todayPx = getTodayPixelX(now.getFullYear());
  if (todayPx < 0) return;
  timelineArea.scrollTo({ left: Math.max(0, todayPx - timelineArea.clientWidth / 2), behavior: 'smooth' });
}

function switchView(view) {
  currentView = view;
  Store.setView(view);
  renderTabs();

  document.querySelectorAll('.view-container').forEach(v => {
    v.classList.toggle('active', v.id === 'view-' + view);
  });

  document.getElementById('year-nav').style.display = view === 'timeline' ? 'flex' : 'none';

  render();
}

function renderTabs() {
  const nav = document.getElementById('view-tabs-nav');
  nav.innerHTML = '';

  const visibleTabs = Store.data.visibleTabs || ['timeline'];
  const hiddenViews = ALL_VIEWS.filter(v => !visibleTabs.includes(v.id));

  for (const viewId of visibleTabs) {
    const viewDef = ALL_VIEWS.find(v => v.id === viewId);
    if (!viewDef) continue;

    const btn = document.createElement('button');
    btn.className = 'view-tab' + (viewId === currentView ? ' active' : '');
    btn.dataset.view = viewId;

    const label = document.createTextNode(viewDef.label);
    btn.appendChild(label);

    if (visibleTabs.length > 1) {
      const close = document.createElement('span');
      close.className = 'tab-close';
      close.textContent = '×';
      close.addEventListener('click', (e) => {
        e.stopPropagation();
        removeTab(viewId);
      });
      btn.appendChild(close);
    }

    btn.addEventListener('click', () => {
      nav.classList.remove('open');
      switchView(viewId);
    });

    btn.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      if (visibleTabs.length <= 1) return;
      removeTab(viewId);
    });

    nav.appendChild(btn);
  }

  if (hiddenViews.length > 0) {
    const moreDiv = document.createElement('div');
    moreDiv.className = 'view-tab-more';

    const plusBtn = document.createElement('button');
    plusBtn.className = 'view-tab view-tab-plus';
    plusBtn.textContent = '+';

    const menu = document.createElement('div');
    menu.className = 'view-tab-more-menu';

    for (const view of hiddenViews) {
      const item = document.createElement('button');
      item.className = 'view-tab-more-item';
      item.dataset.view = view.id;
      item.textContent = view.label;
      item.addEventListener('click', (e) => {
        e.stopPropagation();
        addTab(view.id);
      });
      menu.appendChild(item);
    }

    plusBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      menu.classList.toggle('open');
    });

    moreDiv.appendChild(plusBtn);
    moreDiv.appendChild(menu);
    nav.appendChild(moreDiv);
  }
}

function addTab(viewId) {
  const tabs = [...Store.data.visibleTabs];
  if (!tabs.includes(viewId)) {
    tabs.push(viewId);
    Store.setVisibleTabs(tabs);
  }
  renderTabs();
  switchView(viewId);
}

function removeTab(viewId) {
  const tabs = Store.data.visibleTabs.filter(id => id !== viewId);
  Store.setVisibleTabs(tabs);
  if (currentView === viewId) {
    switchView(tabs[0]);
  } else {
    renderTabs();
  }
}

function updateUndoButtons() {
  document.getElementById('btn-undo').disabled = !Store.canUndo();
  document.getElementById('btn-redo').disabled = !Store.canRedo();
}

function render() {
  if (!Store.data) return;
  updateUndoButtons();

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

let _activeDropdownProjId = null;

function showProjectLinksDropdown(e, proj) {
  const existing = document.querySelector('.project-links-dropdown');

  // Toggle: if clicking the same project, close and return
  if (existing && _activeDropdownProjId === proj.id) {
    existing.remove();
    _activeDropdownProjId = null;
    return;
  }

  // Close any existing dropdown
  if (existing) existing.remove();
  _activeDropdownProjId = proj.id;

  const dropdown = document.createElement('div');
  dropdown.className = 'project-links-dropdown';

  // Close button
  const closeBtn = document.createElement('button');
  closeBtn.className = 'btn-icon dropdown-close-btn';
  closeBtn.textContent = '✕';
  closeBtn.addEventListener('click', (ev) => {
    ev.stopPropagation();
    dropdown.remove();
    _activeDropdownProjId = null;
  });
  dropdown.appendChild(closeBtn);

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
    ev.stopPropagation(); dropdown.remove(); _activeDropdownProjId = null; showLinksModal(proj);
  });
  dropdown.appendChild(editBtn);

  const rect = e.target.getBoundingClientRect();
  dropdown.style.position = 'fixed';
  dropdown.style.left = rect.left + 'px';
  dropdown.style.top = rect.bottom + 4 + 'px';
  dropdown.style.zIndex = '10000';

  document.body.appendChild(dropdown);

  // Close on click outside
  setTimeout(() => {
    const closeHandler = (ev) => {
      if (!dropdown.contains(ev.target) && !ev.target.closest('.project-name')) {
        dropdown.remove();
        _activeDropdownProjId = null;
        document.removeEventListener('mousedown', closeHandler);
      }
    };
    document.addEventListener('mousedown', closeHandler);
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
      renderTabs();
      render();
    } catch (err) { alert('Error importing file: ' + err.message); }
  });
  input.click();
}
