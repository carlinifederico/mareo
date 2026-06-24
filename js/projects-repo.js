// Read/write layer for the `projects` Firestore collection introduced in
// schema v2. Each project document holds the shareable content (tasks,
// notes, board placement, etc.) plus access control (ownerId, members,
// memberUids). Per-user state — which projects appear in which category,
// pinned ordering, expenses — stays in mareo_data/{uid}.

import {
  db, doc, getDoc, setDoc, updateDoc, deleteDoc,
  collection, query, where, getDocs,
} from './firebase-config.js';

// Fields that belong inside the project document. Anything not in this set
// is per-user state (and stays in mareo_data). Keep this list in sync with
// the migration in store.js.
export const PROJECT_CONTENT_FIELDS = [
  'name', 'color', 'links', 'order',
  'tasks', 'projectNotes', 'notesExpanded',
  'boardX', 'boardY', 'boardMinimized', 'showInToday',
];

export const ProjectsRepo = {
  async load(projectId) {
    const snap = await getDoc(doc(db, 'projects', projectId));
    return snap.exists() ? { id: projectId, ...snap.data() } : null;
  },

  // Write the full project document. Used by Store on every dirty save.
  // Caller is responsible for permission gating (don't call as a viewer).
  async save(projectId, content, meta) {
    await setDoc(doc(db, 'projects', projectId), {
      ...content,
      ownerId: meta.ownerId,
      members: meta.members,
      memberUids: meta.memberUids,
      updatedAt: Date.now(),
    });
  },

  // Create a brand-new project with the caller as sole owner.
  async create(projectId, content, ownerUid) {
    const data = {
      ...content,
      ownerId: ownerUid,
      members: { [ownerUid]: 'owner' },
      memberUids: [ownerUid],
      updatedAt: Date.now(),
    };
    await setDoc(doc(db, 'projects', projectId), data);
    return data;
  },

  async addMember(projectId, uid, role) {
    const ref = doc(db, 'projects', projectId);
    const snap = await getDoc(ref);
    if (!snap.exists()) throw new Error('Project not found');
    const data = snap.data();
    const members = { ...(data.members || {}), [uid]: role };
    const memberUids = Array.from(new Set([...(data.memberUids || []), uid]));
    await updateDoc(ref, { members, memberUids, updatedAt: Date.now() });
  },

  async removeMember(projectId, uid) {
    const ref = doc(db, 'projects', projectId);
    const snap = await getDoc(ref);
    if (!snap.exists()) return;
    const data = snap.data();
    if (data.ownerId === uid) {
      throw new Error('Cannot remove the project owner');
    }
    const members = { ...(data.members || {}) };
    delete members[uid];
    const memberUids = (data.memberUids || []).filter(u => u !== uid);
    await updateDoc(ref, { members, memberUids, updatedAt: Date.now() });
  },

  async updateMemberRole(projectId, uid, role) {
    const ref = doc(db, 'projects', projectId);
    const snap = await getDoc(ref);
    if (!snap.exists()) throw new Error('Project not found');
    const data = snap.data();
    if (data.ownerId === uid && role !== 'owner') {
      throw new Error('Cannot demote the project owner');
    }
    const members = { ...(data.members || {}), [uid]: role };
    await updateDoc(ref, { members, updatedAt: Date.now() });
  },

  async delete(projectId) {
    await deleteDoc(doc(db, 'projects', projectId));
  },

  async loadMany(projectIds) {
    if (!projectIds || projectIds.length === 0) return [];
    const settled = await Promise.allSettled(projectIds.map(id => this.load(id)));
    const out = [];
    for (let i = 0; i < settled.length; i++) {
      const r = settled[i];
      if (r.status === 'fulfilled' && r.value) out.push(r.value);
      else if (r.status === 'rejected') {
        // Permission denied or missing → just skip; caller filters out
        // missing projects from the user's category list on the next save.
        console.warn('ProjectsRepo.loadMany: skipping', projectIds[i], r.reason?.code || r.reason);
      }
    }
    return out;
  },

  // Compute the role a uid has on a project doc. Returns null if not a
  // member. Used by client-side gating; the source of truth is still the
  // Firestore rules.
  roleOf(projectDoc, uid) {
    if (!projectDoc || !projectDoc.members) return null;
    return projectDoc.members[uid] || null;
  },

  // Every project the caller can access (owned + shared). Used at load
  // time so projects shared by others show up automatically — there's
  // no separate "invitations" inbox.
  async listAccessible(uid) {
    if (!uid) return [];
    const q = query(
      collection(db, 'projects'),
      where('memberUids', 'array-contains', uid)
    );
    const snap = await getDocs(q);
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
  },
};
