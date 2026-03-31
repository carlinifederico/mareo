import { db, doc, getDoc, setDoc } from './firebase-config.js?v=7';

const STORAGE_PREFIX = 'mareo_data_';

export const Store = {
  data: null,
  _uid: null,
  _storageKey: null,
  _saveTimer: null,

  async load(uid) {
    this._uid = uid;
    this._storageKey = uid ? STORAGE_PREFIX + uid : STORAGE_PREFIX + 'anonymous';

    // Try Firestore first
    if (uid) {
      try {
        const snap = await getDoc(doc(db, 'mareo_data', uid));
        if (snap.exists()) {
          this.data = snap.data();
          localStorage.setItem(this._storageKey, JSON.stringify(this.data));
        }
      } catch (err) {
        console.warn('Firestore load failed, falling back to localStorage:', err);
      }
    }

    // Fallback to localStorage (per-user)
    if (!this.data) {
      const saved = localStorage.getItem(this._storageKey);
      if (saved) {
        this.data = JSON.parse(saved);
      }
    }

    // Clean up old shared key (admin data lives in Firestore now)
    localStorage.removeItem('mareo_planner_v4');

    // Fallback to empty data for new users
    if (!this.data) {
      this.data = {
        currentYear: new Date().getFullYear(),
        categories: [],
        notes: [],
        boardCards: [],
        expensesMonths: {}
      };
    }

    // Ensure required fields
    if (!this.data.notes) this.data.notes = [];
    if (!this.data.boardCards) this.data.boardCards = [];
    if (!this.data.expensesMonths) this.data.expensesMonths = {};
    if (!this.data.currentView) this.data.currentView = 'timeline';
    if (!this.data.categories) this.data.categories = [];
    if (!this.data.pinnedProjects) this.data.pinnedProjects = [];
    for (const cat of this.data.categories) {
      for (const proj of cat.projects) {
        if (!proj.projectNotes) proj.projectNotes = [];
        // Migrate tasks from week-based to day-based
        for (const task of proj.tasks) {
          if (task.startWeek != null && task.startDay == null) {
            task.startDay = task.startWeek * 7;
            task.durationDays = (task.durationWeeks || 1) * 7;
            delete task.startWeek;
            delete task.durationWeeks;
          }
        }
      }
    }

    // Save to both
    this.save();

    return this.data;
  },

  save() {
    localStorage.setItem(this._storageKey, JSON.stringify(this.data));
    this._debouncedFirestoreSave();
  },

  _debouncedFirestoreSave() {
    if (this._saveTimer) clearTimeout(this._saveTimer);
    this._saveTimer = setTimeout(() => {
      if (this._uid && this.data) {
        setDoc(doc(db, 'mareo_data', this._uid), JSON.parse(JSON.stringify(this.data)))
          .catch(err => console.warn('Firestore save failed:', err));
      }
    }, 1500);
  },

  setYear(year) { this.data.currentYear = year; this.save(); },
  setView(view) { this.data.currentView = view; this.save(); },

  // --- Categories ---
  addCategory(name) {
    const cat = {
      id: 'cat-' + crypto.randomUUID(),
      name, order: this.data.categories.length,
      collapsed: false, projects: []
    };
    this.data.categories.push(cat);
    this.save();
    return cat;
  },

  removeCategory(id) {
    this.data.categories = this.data.categories.filter(c => c.id !== id);
    this.save();
  },

  renameCategory(id, name) {
    const cat = this._findCategory(id);
    if (cat) { cat.name = name; this.save(); }
  },

  toggleCollapse(id) {
    const cat = this._findCategory(id);
    if (cat) { cat.collapsed = !cat.collapsed; this.save(); }
  },

  // --- Projects ---
  addProject(categoryId, name, color) {
    const cat = this._findCategory(categoryId);
    if (!cat) return null;
    const proj = {
      id: 'proj-' + crypto.randomUUID(),
      name, color: color || '#bdc3c7',
      links: [], order: cat.projects.length,
      tasks: [], projectNotes: []
    };
    cat.projects.push(proj);
    this.save();
    return proj;
  },

  removeProject(projectId) {
    for (const cat of this.data.categories) {
      cat.projects = cat.projects.filter(p => p.id !== projectId);
    }
    this.data.pinnedProjects = (this.data.pinnedProjects || []).filter(id => id !== projectId);
    this.save();
  },

  updateProject(projectId, updates) {
    const proj = this._findProject(projectId);
    if (proj) { Object.assign(proj, updates); this.save(); }
  },

  // --- Project Notes (multiple notes per project) ---
  addProjectNote(projectId, note) {
    const proj = this._findProject(projectId);
    if (!proj) return null;
    if (!proj.projectNotes) proj.projectNotes = [];
    const n = {
      id: 'pn-' + crypto.randomUUID(),
      title: note.title || '',
      content: note.content || '',
      done: false,
      createdAt: Date.now(),
      updatedAt: Date.now()
    };
    proj.projectNotes.unshift(n);
    this.save();
    return n;
  },

  addProjectNoteAfter(projectId, afterNoteId, note) {
    const proj = this._findProject(projectId);
    if (!proj) return null;
    if (!proj.projectNotes) proj.projectNotes = [];
    const n = {
      id: 'pn-' + crypto.randomUUID(),
      title: note.title || '',
      content: note.content || '',
      done: false,
      createdAt: Date.now(),
      updatedAt: Date.now()
    };
    const idx = proj.projectNotes.findIndex(pn => pn.id === afterNoteId);
    if (idx >= 0) {
      proj.projectNotes.splice(idx + 1, 0, n);
    } else {
      proj.projectNotes.push(n);
    }
    this.save();
    return n;
  },

  updateProjectNote(projectId, noteId, updates) {
    const proj = this._findProject(projectId);
    if (!proj) return;
    const note = (proj.projectNotes || []).find(n => n.id === noteId);
    if (note) { Object.assign(note, updates, { updatedAt: Date.now() }); this.save(); }
  },

  removeProjectNote(projectId, noteId) {
    const proj = this._findProject(projectId);
    if (!proj) return;
    proj.projectNotes = (proj.projectNotes || []).filter(n => n.id !== noteId);
    this.save();
  },

  reorderProjectNote(projectId, noteId, direction) {
    const proj = this._findProject(projectId);
    if (!proj || !proj.projectNotes) return;
    const idx = proj.projectNotes.findIndex(n => n.id === noteId);
    if (idx < 0) return;
    const newIdx = idx + direction;
    if (newIdx < 0 || newIdx >= proj.projectNotes.length) return;
    const [note] = proj.projectNotes.splice(idx, 1);
    proj.projectNotes.splice(newIdx, 0, note);
    this.save();
  },

  // --- Tasks (day-based: startDay, durationDays) ---
  addTask(projectId, task) {
    const proj = this._findProject(projectId);
    if (!proj) return null;
    const t = {
      id: 'task-' + crypto.randomUUID(),
      label: task.label || 'New Task',
      startDay: task.startDay || 0,
      durationDays: task.durationDays || 7,
      color: task.color || proj.color,
      notes: task.notes || '',
      links: task.links || []
    };
    proj.tasks.push(t);
    this.save();
    return t;
  },

  removeTask(taskId) {
    for (const cat of this.data.categories) {
      for (const proj of cat.projects) {
        proj.tasks = proj.tasks.filter(t => t.id !== taskId);
      }
    }
    this.save();
  },

  updateTask(taskId, updates) {
    const task = this._findTask(taskId);
    if (task) { Object.assign(task, updates); this.save(); }
  },

  // --- Notes (general, Google Keep style) ---
  addNote(note) {
    const n = {
      id: 'note-' + crypto.randomUUID(),
      title: note.title || '', content: note.content || '',
      color: note.color || '#1a1433',
      pinned: false, createdAt: Date.now(), updatedAt: Date.now()
    };
    this.data.notes.unshift(n);
    this.save();
    return n;
  },

  updateNote(noteId, updates) {
    const note = this.data.notes.find(n => n.id === noteId);
    if (note) { Object.assign(note, updates, { updatedAt: Date.now() }); this.save(); }
  },

  removeNote(noteId) {
    this.data.notes = this.data.notes.filter(n => n.id !== noteId);
    this.save();
  },

  togglePinNote(noteId) {
    const note = this.data.notes.find(n => n.id === noteId);
    if (note) { note.pinned = !note.pinned; this.save(); }
  },

  // --- Board Cards ---
  addBoardCard(card) {
    const c = {
      id: 'card-' + crypto.randomUUID(),
      title: card.title || 'New Card',
      content: card.content || '',
      color: card.color || '#1f2b47',
      x: card.x || 100, y: card.y || 100,
      width: card.width || 200, height: card.height || 150
    };
    this.data.boardCards.push(c);
    this.save();
    return c;
  },

  updateBoardCard(cardId, updates) {
    const card = this.data.boardCards.find(c => c.id === cardId);
    if (card) { Object.assign(card, updates); this.save(); }
  },

  removeBoardCard(cardId) {
    this.data.boardCards = this.data.boardCards.filter(c => c.id !== cardId);
    this.save();
  },

  // --- Import/Export ---
  exportJSON() { return JSON.stringify(this.data, null, 2); },

  importJSON(str) {
    const parsed = JSON.parse(str);
    if (!parsed.categories || !Array.isArray(parsed.categories)) throw new Error('Invalid data format');
    this.data = parsed;
    if (!this.data.notes) this.data.notes = [];
    if (!this.data.boardCards) this.data.boardCards = [];
    this.save();
  },

  // --- Helpers ---
  _findCategory(id) { return this.data.categories.find(c => c.id === id); },

  _findProject(id) {
    for (const cat of this.data.categories) {
      const p = cat.projects.find(p => p.id === id);
      if (p) return p;
    }
    return null;
  },

  _findTask(id) {
    for (const cat of this.data.categories) {
      for (const proj of cat.projects) {
        const t = proj.tasks.find(t => t.id === id);
        if (t) return t;
      }
    }
    return null;
  },

  _findProjectForTask(taskId) {
    for (const cat of this.data.categories) {
      for (const proj of cat.projects) {
        if (proj.tasks.some(t => t.id === taskId)) return proj;
      }
    }
    return null;
  },

  _findCategoryForProject(projectId) {
    for (const cat of this.data.categories) {
      if (cat.projects.some(p => p.id === projectId)) return cat;
    }
    return null;
  },

  getAllProjects() {
    const projects = [];
    for (const cat of this.data.categories) {
      for (const proj of cat.projects) {
        projects.push({ ...proj, categoryName: cat.name });
      }
    }
    return projects;
  },

  // --- Pinned Projects ---
  pinProject(projectId) {
    if (!this.data.pinnedProjects.includes(projectId)) {
      this.data.pinnedProjects.push(projectId);
      this.save();
    }
  },

  unpinProject(projectId) {
    this.data.pinnedProjects = this.data.pinnedProjects.filter(id => id !== projectId);
    this.save();
  },

  isProjectPinned(projectId) {
    return this.data.pinnedProjects.includes(projectId);
  },

  reorderPinnedProjects(orderedIds) {
    this.data.pinnedProjects = orderedIds;
    this.save();
  },

  reorderProject(categoryId, projectId, newIndex) {
    const cat = this._findCategory(categoryId);
    if (!cat) return;
    const idx = cat.projects.findIndex(p => p.id === projectId);
    if (idx < 0) return;
    const [proj] = cat.projects.splice(idx, 1);
    cat.projects.splice(newIndex, 0, proj);
    this.save();
  },

  moveProjectToCategory(projectId, fromCatId, toCatId, targetIndex) {
    const fromCat = this._findCategory(fromCatId);
    const toCat = this._findCategory(toCatId);
    if (!fromCat || !toCat) return;
    const idx = fromCat.projects.findIndex(p => p.id === projectId);
    if (idx < 0) return;
    const [proj] = fromCat.projects.splice(idx, 1);
    const insertAt = Math.min(targetIndex, toCat.projects.length);
    toCat.projects.splice(insertAt, 0, proj);
    this.save();
  },

  getRenderedLayout() {
    const layout = [];
    const pinnedIds = this.data.pinnedProjects || [];

    // Pinned section
    if (pinnedIds.length > 0) {
      layout.push({ type: 'pinned-header' });
      for (const pid of pinnedIds) {
        const proj = this._findProject(pid);
        const cat = this._findCategoryForProject(pid);
        if (proj && cat) {
          layout.push({ type: 'project', proj, cat, pinned: true });
        }
      }
    }

    // Categories
    for (const cat of this.data.categories) {
      layout.push({ type: 'category-header', cat });

      if (!cat.collapsed) {
        for (const proj of cat.projects) {
          if (!pinnedIds.includes(proj.id)) {
            layout.push({ type: 'project', proj, cat, pinned: false });
          }
        }
        layout.push({ type: 'add-project', cat });
      }
    }

    layout.push({ type: 'add-category' });
    return layout;
  }
};
