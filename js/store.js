import { db, doc, getDoc, setDoc } from './firebase-config.js?v=8';
import { ProjectsRepo, PROJECT_CONTENT_FIELDS } from './projects-repo.js?v=8';

const STORAGE_PREFIX = 'mareo_data_';
const SCHEMA_VERSION = 2;

// Project content lives in projects/{id}; this helper extracts only those
// fields from a runtime project object (which also carries _role, _shared,
// etc. that should NOT be persisted to /projects).
function extractContent(proj) {
  const out = {};
  for (const k of PROJECT_CONTENT_FIELDS) {
    if (k in proj) out[k] = proj[k];
  }
  return out;
}

// Build a runtime project from a /projects/{id} document plus the caller's
// uid. Tags it with _role / _shared / _members so the rest of the app can
// gate writes and decide where to render it.
function materializeProject(projDoc, uid) {
  const out = {};
  for (const k of PROJECT_CONTENT_FIELDS) {
    if (k in projDoc) out[k] = projDoc[k];
  }
  out.id = projDoc.id;
  out._role = ProjectsRepo.roleOf(projDoc, uid);
  out._shared = projDoc.ownerId !== uid;
  out._ownerId = projDoc.ownerId;
  out._members = projDoc.members || {};
  out._memberUids = projDoc.memberUids || [];
  // Defaults the rest of the app expects
  if (!out.tasks) out.tasks = [];
  if (!out.projectNotes) out.projectNotes = [];
  return out;
}

export const Store = {
  data: null,
  _uid: null,
  _storageKey: null,
  _saveTimer: null,
  _undoStack: [],
  _redoStack: [],
  _lastSnapshot: null,
  _undoTimer: null,
  _skipUndo: false,
  // Per-project content snapshots (JSON strings) for diff-based dirty
  // tracking on Firestore save. Updated on every successful write.
  _projectSnapshots: {},
  // Runtime list of projects shared with this user (not in their own
  // categories). Hydrated on load from data.sharedProjects[].
  _sharedProjects: [],

  async load(uid) {
    this._uid = uid;
    this._storageKey = uid ? STORAGE_PREFIX + uid : STORAGE_PREFIX + 'anonymous';
    this._projectSnapshots = {};
    this._sharedProjects = [];

    // Try Firestore first for the per-user doc
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
        expensesMonths: {},
        visibleTabs: ['timeline', 'board', 'expenses', 'balance'],
        schemaVersion: SCHEMA_VERSION,
        sharedProjects: [],
      };
    }

    // Ensure required fields
    if (!this.data.notes) this.data.notes = [];
    if (!this.data.boardCards) this.data.boardCards = [];
    if (!this.data.expensesMonths) this.data.expensesMonths = {};
    if (!this.data.currentView) this.data.currentView = 'timeline';
    if (!this.data.categories) this.data.categories = [];
    if (!this.data.pinnedProjects) this.data.pinnedProjects = [];
    if (!this.data.pinnedBoardOffset) this.data.pinnedBoardOffset = { x: 2500, y: 2700 };
    if (!this.data.todayOrder) this.data.todayOrder = [];
    if (this.data.timelineLocked === undefined) this.data.timelineLocked = true;
    if (!this.data.visibleTabs) this.data.visibleTabs = ['timeline', 'board', 'expenses', 'balance'];
    if (!this.data.sharedProjects) this.data.sharedProjects = [];
    if (this.data.schemaVersion == null) this.data.schemaVersion = 1;
    // Notes view was removed — drop it from visibleTabs and currentView
    this.data.visibleTabs = this.data.visibleTabs.filter(v => v !== 'notes');
    if (this.data.currentView === 'notes') this.data.currentView = 'board';

    // Field-shape migrations applied to any nested project objects we still
    // have in memory. Skip stripped (string) entries — those will be filled
    // in by _hydrateProjects below.
    for (const cat of this.data.categories) {
      for (const proj of cat.projects) {
        if (typeof proj !== 'object' || proj == null) continue;
        if (!proj.projectNotes) proj.projectNotes = [];
        if (proj.boardX === undefined) proj.boardX = null;
        if (proj.boardY === undefined) proj.boardY = null;
        if (proj.boardMinimized === undefined) proj.boardMinimized = false;
        for (const note of proj.projectNotes) {
          if (note.today === undefined) note.today = false;
        }
        for (const task of (proj.tasks || [])) {
          if (task.startWeek != null && task.startDay == null) {
            task.startDay = task.startWeek * 7;
            task.durationDays = (task.durationWeeks || 1) * 7;
            delete task.startWeek;
            delete task.durationWeeks;
          }
          if (task.parentId === undefined) task.parentId = null;
          if (task.expanded === undefined) task.expanded = false;
        }
      }
    }

    // One-time: recenter all board cards in the new 6000x6000 world
    if (!this.data.boardNormalizedV2) {
      const placed = [];
      for (const cat of this.data.categories) {
        for (const proj of cat.projects) {
          if (typeof proj !== 'object' || proj == null) continue;
          if (proj.boardX != null && proj.boardY != null) placed.push(proj);
        }
      }
      if (placed.length > 0) {
        const cardW = 240, cardH = 200;
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        for (const p of placed) {
          if (p.boardX < minX) minX = p.boardX;
          if (p.boardY < minY) minY = p.boardY;
          if (p.boardX + cardW > maxX) maxX = p.boardX + cardW;
          if (p.boardY + cardH > maxY) maxY = p.boardY + cardH;
        }
        const targetCx = 3000, targetCy = 3000; // new world center
        const dx = Math.round(targetCx - (minX + maxX) / 2);
        const dy = Math.round(targetCy - (minY + maxY) / 2);
        for (const p of placed) {
          p.boardX += dx;
          p.boardY += dy;
        }
      }
      this.data.boardNormalizedV2 = true;
    }

    // === Schema v2: split project content into /projects collection ===
    if (uid && this.data.schemaVersion < SCHEMA_VERSION) {
      try {
        await this._migrateToV2(uid);
        this.data.schemaVersion = SCHEMA_VERSION;
      } catch (err) {
        console.error('V2 migration failed; data left in v1 form:', err);
        // schemaVersion stays < 2 so we'll retry next load
      }
    }

    // Hydrate any project IDs (strings) into full runtime objects by
    // pulling content from /projects. Owned projects sitting in
    // categories AND projects shared with us via sharedProjects[].
    if (uid) {
      await this._hydrateProjects(uid);
    } else {
      // Without a uid we can't hit Firestore. Tag any nested in-memory
      // projects as owner so client gating doesn't lock them out.
      for (const cat of this.data.categories) {
        for (const proj of cat.projects) {
          if (typeof proj === 'object' && proj) {
            proj._role = 'owner';
            proj._shared = false;
          }
        }
      }
    }

    // Initialize content snapshots so the first save() doesn't think
    // every project is dirty.
    this._initProjectSnapshots();

    // Save back so the freshly migrated/hydrated state is persisted in
    // its v2 stripped form.
    this.save();

    // Initialize undo snapshot
    this._undoStack = [];
    this._redoStack = [];
    this._lastSnapshot = JSON.stringify(this.data);

    return this.data;
  },

  // Walks every nested project still living in mareo_data, writes its
  // content to /projects/{id} with this user as sole owner, and replaces
  // the in-memory entries with full materialized runtime objects (kept
  // in nested form for now — the next save() strips them to IDs).
  async _migrateToV2(uid) {
    const allProjects = [];
    for (const cat of this.data.categories) {
      for (let i = 0; i < cat.projects.length; i++) {
        const proj = cat.projects[i];
        if (typeof proj !== 'object' || proj == null) continue;
        allProjects.push({ proj, cat, index: i });
      }
    }
    if (allProjects.length === 0) return;

    console.log(`[v2 migration] Writing ${allProjects.length} projects to /projects ...`);
    const meta = {
      ownerId: uid,
      members: { [uid]: 'owner' },
      memberUids: [uid],
    };
    const results = await Promise.allSettled(allProjects.map(({ proj }) =>
      ProjectsRepo.save(proj.id, extractContent(proj), meta).then(() => proj)
    ));
    const failures = results.filter(r => r.status === 'rejected');
    if (failures.length > 0) {
      console.error('[v2 migration] failed writes:', failures.map(f => f.reason));
      throw new Error(`v2 migration: ${failures.length}/${allProjects.length} writes failed`);
    }
    // All writes succeeded — tag every in-memory copy with ownership info.
    for (const { proj } of allProjects) {
      proj._role = 'owner';
      proj._shared = false;
      proj._ownerId = uid;
      proj._members = { [uid]: 'owner' };
      proj._memberUids = [uid];
    }
    console.log('[v2 migration] Done.');
  },

  // For every project ID still living in categories[].projects[] as a
  // string (post-strip form), fetch its /projects/{id} doc and replace
  // the string with a materialized runtime object. Same for sharedProjects[].
  // Already-materialized objects are left alone but tagged if missing tags.
  async _hydrateProjects(uid) {
    const ownedIds = [];
    for (const cat of this.data.categories) {
      for (const p of cat.projects) {
        if (typeof p === 'string') ownedIds.push(p);
      }
    }
    const sharedIds = (this.data.sharedProjects || []).filter(id => typeof id === 'string');
    const allIds = Array.from(new Set([...ownedIds, ...sharedIds]));

    if (allIds.length === 0) return;

    const docs = await ProjectsRepo.loadMany(allIds);
    const byId = new Map(docs.map(d => [d.id, d]));

    // Hydrate categories: replace string IDs with materialized objects.
    for (const cat of this.data.categories) {
      const next = [];
      for (const entry of cat.projects) {
        if (typeof entry === 'string') {
          const d = byId.get(entry);
          if (d) next.push(materializeProject(d, uid));
          // If a project doc is missing (deleted out-of-band, perm denied),
          // drop the reference so the sidebar doesn't render an empty row.
        } else if (entry && entry.id) {
          if (!entry._role) {
            // Already materialized but missing tags (shouldn't happen post-migration).
            entry._role = 'owner';
            entry._shared = false;
          }
          next.push(entry);
        }
      }
      cat.projects = next;
    }

    // Hydrate shared projects into runtime list.
    this._sharedProjects = sharedIds
      .map(id => byId.get(id))
      .filter(d => d)
      .map(d => materializeProject(d, uid));
  },

  _initProjectSnapshots() {
    this._projectSnapshots = {};
    for (const cat of this.data.categories) {
      for (const proj of cat.projects) {
        if (typeof proj === 'object' && proj && proj.id) {
          this._projectSnapshots[proj.id] = JSON.stringify(extractContent(proj));
        }
      }
    }
    for (const proj of this._sharedProjects) {
      if (proj && proj.id) {
        this._projectSnapshots[proj.id] = JSON.stringify(extractContent(proj));
      }
    }
  },

  // Build the per-user mareo_data document for Firestore: keep everything
  // except categories[].projects[] which are reduced to ID-only references.
  // Runtime-only fields like _role / _shared never reach this layer.
  _buildUserDoc() {
    const out = {};
    for (const k of Object.keys(this.data)) {
      if (k === 'categories') continue;
      out[k] = this.data[k];
    }
    out.categories = this.data.categories.map(cat => ({
      ...cat,
      projects: cat.projects.map(p => typeof p === 'string' ? p : p.id).filter(Boolean),
    }));
    return out;
  },

  save() {
    localStorage.setItem(this._storageKey, JSON.stringify(this.data));
    this._debouncedFirestoreSave();
    if (!this._skipUndo) {
      if (this._undoTimer) clearTimeout(this._undoTimer);
      this._undoTimer = setTimeout(() => this._commitUndo(), 500);
    }
  },

  _commitUndo() {
    if (this._undoTimer) { clearTimeout(this._undoTimer); this._undoTimer = null; }
    const current = JSON.stringify(this.data);
    if (this._lastSnapshot && this._lastSnapshot !== current) {
      this._undoStack.push(this._lastSnapshot);
      if (this._undoStack.length > 30) this._undoStack.shift();
      this._redoStack = [];
    }
    this._lastSnapshot = current;
  },

  undo() {
    this._commitUndo();
    if (this._undoStack.length === 0) return false;
    const currentYear = this.data.currentYear;
    const currentView = this.data.currentView;
    const visibleTabs = this.data.visibleTabs;
    this._redoStack.push(JSON.stringify(this.data));
    this.data = JSON.parse(this._undoStack.pop());
    this.data.currentYear = currentYear;
    this.data.currentView = currentView;
    this.data.visibleTabs = visibleTabs;
    this._lastSnapshot = JSON.stringify(this.data);
    this._skipUndo = true;
    this.save();
    this._skipUndo = false;
    return true;
  },

  redo() {
    if (this._redoStack.length === 0) return false;
    const currentYear = this.data.currentYear;
    const currentView = this.data.currentView;
    const visibleTabs = this.data.visibleTabs;
    this._undoStack.push(JSON.stringify(this.data));
    if (this._undoStack.length > 30) this._undoStack.shift();
    this.data = JSON.parse(this._redoStack.pop());
    this.data.currentYear = currentYear;
    this.data.currentView = currentView;
    this.data.visibleTabs = visibleTabs;
    this._lastSnapshot = JSON.stringify(this.data);
    this._skipUndo = true;
    this.save();
    this._skipUndo = false;
    return true;
  },

  canUndo() { return this._undoStack.length > 0; },
  canRedo() { return this._redoStack.length > 0; },

  _debouncedFirestoreSave() {
    if (this._saveTimer) clearTimeout(this._saveTimer);
    this._saveTimer = setTimeout(() => {
      if (!this._uid || !this.data) return;
      this._doFirestoreSave().catch(err => console.warn('Firestore save failed:', err));
    }, 1500);
  },

  async _doFirestoreSave() {
    // 1. Diff each project against snapshot to find dirty ones.
    //    Track which IDs we still know about (so we can detect deletes).
    const dirty = [];
    const currentIds = new Set();
    const visit = (proj) => {
      if (typeof proj !== 'object' || !proj || !proj.id) return;
      currentIds.add(proj.id);
      if (proj._role === 'viewer') return; // not allowed to write
      const cur = JSON.stringify(extractContent(proj));
      if (this._projectSnapshots[proj.id] !== cur) {
        dirty.push({ proj, content: JSON.parse(cur) });
        this._projectSnapshots[proj.id] = cur;
      }
    };
    for (const cat of this.data.categories) {
      for (const proj of cat.projects) visit(proj);
    }
    for (const proj of this._sharedProjects) visit(proj);

    // 2. Detect projects that disappeared from runtime (removed locally).
    //    We delete the remote doc only when we're owner — for shared
    //    projects, dropping a reference doesn't affect the underlying doc.
    const removedIds = Object.keys(this._projectSnapshots).filter(id => !currentIds.has(id));
    for (const id of removedIds) delete this._projectSnapshots[id];

    // 3. Write dirty projects in parallel. Each carries its own ownership
    //    metadata so editors of someone else's project preserve the owner.
    const writes = dirty.map(({ proj, content }) => {
      const meta = {
        ownerId: proj._ownerId || this._uid,
        members: proj._members || { [this._uid]: 'owner' },
        memberUids: proj._memberUids || [this._uid],
      };
      return ProjectsRepo.save(proj.id, content, meta)
        .catch(err => console.warn('project save failed', proj.id, err?.code || err));
    });

    // 4. Try to delete projects we removed locally. If we're not the
    //    owner the rules will reject (expected for shared "leave" flow,
    //    handled by the not-yet-implemented Phase 2 UI).
    for (const id of removedIds) {
      writes.push(ProjectsRepo.delete(id).catch(() => { /* perm denied = not owner */ }));
    }

    await Promise.allSettled(writes);

    // 5. Write the per-user doc with project references (IDs only).
    const userDoc = this._buildUserDoc();
    try {
      await setDoc(doc(db, 'mareo_data', this._uid), userDoc);
    } catch (err) {
      console.warn('Firestore mareo_data save failed:', err);
    }
  },

  setYear(year) { this.data.currentYear = year; this._skipUndo = true; this.save(); this._skipUndo = false; },
  setView(view) { this.data.currentView = view; this._skipUndo = true; this.save(); this._skipUndo = false; },
  setVisibleTabs(tabs) { this.data.visibleTabs = tabs; this._skipUndo = true; this.save(); this._skipUndo = false; },

  isTimelineLocked() { return this.data.timelineLocked !== false; },
  setTimelineLocked(v) { this.data.timelineLocked = !!v; this._skipUndo = true; this.save(); this._skipUndo = false; },

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
    const uid = this._uid;
    const proj = {
      id: 'proj-' + crypto.randomUUID(),
      name, color: color || '#bdc3c7',
      links: [], order: cat.projects.length,
      tasks: [], projectNotes: [],
      // Runtime ownership metadata so the save flow has what it needs.
      _role: 'owner',
      _shared: false,
      _ownerId: uid,
      _members: uid ? { [uid]: 'owner' } : {},
      _memberUids: uid ? [uid] : [],
    };
    cat.projects.push(proj);
    this.save();
    return proj;
  },

  removeProject(projectId) {
    for (const cat of this.data.categories) {
      cat.projects = cat.projects.filter(p =>
        typeof p === 'object' && p ? p.id !== projectId : p !== projectId
      );
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

  // Google Keep-style 1-level indent: a note can become a child of the
  // previous note (depth 1). The very first note in the list cannot indent.
  indentProjectNote(projectId, noteId) {
    const proj = this._findProject(projectId);
    if (!proj || !proj.projectNotes) return;
    const idx = proj.projectNotes.findIndex(n => n.id === noteId);
    if (idx <= 0) return; // first note can't indent
    const note = proj.projectNotes[idx];
    if ((note.depth || 0) >= 1) return; // cap at 1 level
    note.depth = 1;
    note.updatedAt = Date.now();
    this.save();
  },

  outdentProjectNote(projectId, noteId) {
    const proj = this._findProject(projectId);
    if (!proj || !proj.projectNotes) return;
    const note = proj.projectNotes.find(n => n.id === noteId);
    if (!note) return;
    if (!note.depth) return;
    note.depth = 0;
    note.updatedAt = Date.now();
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
      links: task.links || [],
      deadline: task.deadline || null,
      parentId: task.parentId || null,
      expanded: task.expanded || false
    };
    proj.tasks.push(t);
    this.save();
    return t;
  },

  removeTask(taskId) {
    const idsToRemove = new Set([taskId]);
    // Cascade: collect all descendants
    let added = true;
    while (added) {
      added = false;
      for (const cat of this.data.categories) {
        for (const proj of cat.projects) {
          for (const t of proj.tasks) {
            if (t.parentId && idsToRemove.has(t.parentId) && !idsToRemove.has(t.id)) {
              idsToRemove.add(t.id);
              added = true;
            }
          }
        }
      }
    }
    for (const cat of this.data.categories) {
      for (const proj of cat.projects) {
        proj.tasks = proj.tasks.filter(t => !idsToRemove.has(t.id));
      }
    }
    this.save();
  },

  updateTask(taskId, updates) {
    const task = this._findTask(taskId);
    if (task) { Object.assign(task, updates); this.save(); }
  },

  // --- Board: project card position/state ---
  updateProjectBoardPosition(projectId, updates) {
    const proj = this._findProject(projectId);
    if (!proj) return;
    if (updates.x !== undefined) proj.boardX = updates.x;
    if (updates.y !== undefined) proj.boardY = updates.y;
    if (updates.minimized !== undefined) proj.boardMinimized = updates.minimized;
    this._skipUndo = true;
    this.save();
    this._skipUndo = false;
  },

  // --- Today (project notes flagged for today) ---
  toggleTodayNote(projectId, noteId) {
    const proj = this._findProject(projectId);
    if (!proj) return;
    const note = (proj.projectNotes || []).find(n => n.id === noteId);
    if (!note) return;
    note.today = !note.today;
    if (!this.data.todayOrder) this.data.todayOrder = [];
    if (note.today) {
      if (!this.data.todayOrder.includes(noteId)) this.data.todayOrder.push(noteId);
    } else {
      this.data.todayOrder = this.data.todayOrder.filter(id => id !== noteId);
    }
    this.save();
  },

  reorderTodayItem(fromNoteId, toNoteId) {
    if (!this.data.todayOrder) this.data.todayOrder = [];
    const order = this.data.todayOrder;
    if (!order.includes(fromNoteId)) order.push(fromNoteId);
    if (!order.includes(toNoteId))   order.push(toNoteId);
    const fromIdx = order.indexOf(fromNoteId);
    const toIdx   = order.indexOf(toNoteId);
    if (fromIdx === toIdx) return;
    const [moved] = order.splice(fromIdx, 1);
    order.splice(toIdx, 0, moved);
    this.save();
  },

  getTodayItems() {
    const items = [];
    for (const cat of this.data.categories) {
      for (const proj of cat.projects) {
        for (const note of (proj.projectNotes || [])) {
          if (note.today) {
            items.push({
              projectId: proj.id,
              projectName: proj.name,
              projectColor: proj.color,
              note
            });
          }
        }
      }
    }
    // Self-heal: ensure every visible Today note has a slot in todayOrder so
    // reorderTodayItem can never silently bail on legacy/imported data.
    if (!this.data.todayOrder) this.data.todayOrder = [];
    const order = this.data.todayOrder;
    let dirty = false;
    for (const it of items) {
      if (!order.includes(it.note.id)) { order.push(it.note.id); dirty = true; }
    }
    if (dirty) this.save();
    items.sort((a, b) => order.indexOf(a.note.id) - order.indexOf(b.note.id));
    return items;
  },

  // --- Import/Export ---
  exportJSON() { return JSON.stringify(this.data, null, 2); },

  importJSON(str) {
    const parsed = JSON.parse(str);
    if (!parsed.categories || !Array.isArray(parsed.categories)) throw new Error('Invalid data format');
    this.data = parsed;
    if (!this.data.notes) this.data.notes = [];
    if (!this.data.boardCards) this.data.boardCards = [];
    if (!this.data.todayOrder) this.data.todayOrder = [];
    if (!this.data.visibleTabs) this.data.visibleTabs = ['timeline', 'board', 'expenses', 'balance'];
    this.data.visibleTabs = this.data.visibleTabs.filter(v => v !== 'notes');
    this.save();
  },

  // --- Helpers ---
  _findCategory(id) { return this.data.categories.find(c => c.id === id); },

  // Helpers walk both the user's own categories AND projects shared with
  // them. Skip any string entries (pre-hydration ID-only references) so
  // mutations don't see partially-loaded data.
  _findProject(id) {
    for (const cat of this.data.categories) {
      for (const p of cat.projects) {
        if (typeof p === 'object' && p && p.id === id) return p;
      }
    }
    for (const p of this._sharedProjects) {
      if (p && p.id === id) return p;
    }
    return null;
  },

  _findTask(id) {
    for (const cat of this.data.categories) {
      for (const proj of cat.projects) {
        if (typeof proj !== 'object' || !proj || !proj.tasks) continue;
        const t = proj.tasks.find(t => t.id === id);
        if (t) return t;
      }
    }
    for (const proj of this._sharedProjects) {
      if (!proj || !proj.tasks) continue;
      const t = proj.tasks.find(t => t.id === id);
      if (t) return t;
    }
    return null;
  },

  _findProjectForTask(taskId) {
    for (const cat of this.data.categories) {
      for (const proj of cat.projects) {
        if (typeof proj !== 'object' || !proj || !proj.tasks) continue;
        if (proj.tasks.some(t => t.id === taskId)) return proj;
      }
    }
    for (const proj of this._sharedProjects) {
      if (proj && proj.tasks && proj.tasks.some(t => t.id === taskId)) return proj;
    }
    return null;
  },

  _findCategoryForProject(projectId) {
    for (const cat of this.data.categories) {
      if (cat.projects.some(p => p.id === projectId)) return cat;
    }
    return null;
  },

  getTaskDepth(taskId) {
    let depth = 0;
    let task = this._findTask(taskId);
    while (task && task.parentId) {
      depth++;
      task = this._findTask(task.parentId);
    }
    return depth;
  },

  toggleTaskExpanded(taskId) {
    const task = this._findTask(taskId);
    if (task) {
      task.expanded = !task.expanded;
      this._skipUndo = true;
      this.save();
      this._skipUndo = false;
    }
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

  updatePinnedBoardOffset(x, y) {
    this.data.pinnedBoardOffset = { x, y };
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

    const emitChildRows = (proj, cat, pinned, parentTasks, depth) => {
      if (depth > 5) return;
      const sorted = [...parentTasks].sort((a, b) => (a.startDay || 0) - (b.startDay || 0));
      for (const task of sorted) {
        const children = proj.tasks.filter(t => t.parentId === task.id);
        if (children.length > 0 && task.expanded) {
          layout.push({ type: 'task-children', proj, cat, pinned, parentTask: task, depth });
          emitChildRows(proj, cat, pinned, children, depth + 1);
        }
      }
    };

    // Pinned section
    if (pinnedIds.length > 0) {
      layout.push({ type: 'pinned-header' });
      for (const pid of pinnedIds) {
        const proj = this._findProject(pid);
        const cat = this._findCategoryForProject(pid);
        if (proj && cat) {
          layout.push({ type: 'project', proj, cat, pinned: true });
          if (proj.notesExpanded) {
            const rootTasks = proj.tasks.filter(t => !t.parentId);
            emitChildRows(proj, cat, true, rootTasks, 1);
          }
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
            if (proj.notesExpanded) {
              const rootTasks = proj.tasks.filter(t => !t.parentId);
              emitChildRows(proj, cat, false, rootTasks, 1);
            }
          }
        }
        layout.push({ type: 'add-project', cat });
      }
    }

    layout.push({ type: 'add-category' });
    return layout;
  }
};
