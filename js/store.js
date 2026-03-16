const STORAGE_KEY = 'mareo_planner_v2';

export const Store = {
  data: null,

  async load() {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      this.data = JSON.parse(saved);
    } else {
      const resp = await fetch('data/sample.json');
      this.data = await resp.json();
      this.save();
    }
    // Ensure notes and board arrays exist
    if (!this.data.notes) this.data.notes = [];
    if (!this.data.boardCards) this.data.boardCards = [];
    if (!this.data.currentView) this.data.currentView = 'timeline';
    return this.data;
  },

  save() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(this.data));
  },

  // Year
  setYear(year) {
    this.data.currentYear = year;
    this.save();
  },

  // View
  setView(view) {
    this.data.currentView = view;
    this.save();
  },

  // --- Categories ---
  addCategory(name) {
    const cat = {
      id: 'cat-' + crypto.randomUUID(),
      name,
      order: this.data.categories.length,
      collapsed: false,
      projects: []
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
      name,
      color: color || '#bdc3c7',
      links: [],
      order: cat.projects.length,
      tasks: []
    };
    cat.projects.push(proj);
    this.save();
    return proj;
  },

  removeProject(projectId) {
    for (const cat of this.data.categories) {
      cat.projects = cat.projects.filter(p => p.id !== projectId);
    }
    this.save();
  },

  updateProject(projectId, updates) {
    const proj = this._findProject(projectId);
    if (proj) {
      Object.assign(proj, updates);
      this.save();
    }
  },

  // --- Tasks ---
  addTask(projectId, task) {
    const proj = this._findProject(projectId);
    if (!proj) return null;
    const t = {
      id: 'task-' + crypto.randomUUID(),
      label: task.label || 'New Task',
      startWeek: task.startWeek || 0,
      durationWeeks: task.durationWeeks || 2,
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
    if (task) {
      Object.assign(task, updates);
      this.save();
    }
  },

  // --- Notes (Google Keep style) ---
  addNote(note) {
    const n = {
      id: 'note-' + crypto.randomUUID(),
      title: note.title || '',
      content: note.content || '',
      color: note.color || '#16213e',
      pinned: false,
      createdAt: Date.now(),
      updatedAt: Date.now()
    };
    this.data.notes.unshift(n);
    this.save();
    return n;
  },

  updateNote(noteId, updates) {
    const note = this.data.notes.find(n => n.id === noteId);
    if (note) {
      Object.assign(note, updates, { updatedAt: Date.now() });
      this.save();
    }
  },

  removeNote(noteId) {
    this.data.notes = this.data.notes.filter(n => n.id !== noteId);
    this.save();
  },

  togglePinNote(noteId) {
    const note = this.data.notes.find(n => n.id === noteId);
    if (note) {
      note.pinned = !note.pinned;
      this.save();
    }
  },

  // --- Board Cards ---
  addBoardCard(card) {
    const c = {
      id: 'card-' + crypto.randomUUID(),
      title: card.title || 'New Card',
      content: card.content || '',
      color: card.color || '#1f2b47',
      x: card.x || 100,
      y: card.y || 100,
      width: card.width || 200,
      height: card.height || 150
    };
    this.data.boardCards.push(c);
    this.save();
    return c;
  },

  updateBoardCard(cardId, updates) {
    const card = this.data.boardCards.find(c => c.id === cardId);
    if (card) {
      Object.assign(card, updates);
      this.save();
    }
  },

  removeBoardCard(cardId) {
    this.data.boardCards = this.data.boardCards.filter(c => c.id !== cardId);
    this.save();
  },

  // --- Import/Export ---
  exportJSON() {
    return JSON.stringify(this.data, null, 2);
  },

  importJSON(str) {
    const parsed = JSON.parse(str);
    if (!parsed.categories || !Array.isArray(parsed.categories)) {
      throw new Error('Invalid data format');
    }
    this.data = parsed;
    if (!this.data.notes) this.data.notes = [];
    if (!this.data.boardCards) this.data.boardCards = [];
    this.save();
  },

  // --- Helpers ---
  _findCategory(id) {
    return this.data.categories.find(c => c.id === id);
  },

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
  }
};
