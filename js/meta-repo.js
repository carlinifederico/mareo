// v2 data that MUST live outside the documents v1 writes.
//
// v1's ProjectsRepo.save() does a full setDoc of projects/{id} with only the
// whitelisted PROJECT_CONTENT_FIELDS, so any extra field stored there would be
// wiped the next time someone edits the project from v1. Same idea for the
// per-user doc. v2 therefore keeps its own collections:
//
//   projectMeta/{projectId} — identity + hub, shared by the project's members:
//     { icon, monogram, color, stage, aliases[], hub:{url,title,source,syncedAt,
//       sections:[{label,url}]}, thumb (webp dataURL), locked:{hub,thumb,icon} }
//   mareo_v2/{uid}          — per-user v2 state: eventAssignments, title rules,
//                             cached monthly meeting stats.
//
// The tools/mareo-sync script writes projectMeta with the Admin SDK.

import { db, doc, getDoc, setDoc } from './firebase-config.js';

const metaById = new Map();
let userDoc = {};
let uid = null;

function emit() {
  document.dispatchEvent(new Event('mareo:meta'));
}

export const Meta = {
  // Load metas for the given project ids (parallel getDocs; missing or
  // permission-denied docs are just treated as empty).
  async init(userId, projectIds) {
    uid = userId;
    const [settled, user] = await Promise.all([
      Promise.allSettled(projectIds.map(id => getDoc(doc(db, 'projectMeta', id)))),
      getDoc(doc(db, 'mareo_v2', userId)).catch(() => null),
    ]);
    settled.forEach((r, i) => {
      if (r.status === 'fulfilled' && r.value.exists()) metaById.set(projectIds[i], r.value.data());
    });
    userDoc = user && user.exists() ? user.data() : {};
    emit();
  },

  get(projectId) {
    return metaById.get(projectId) || {};
  },

  // Merge-write a project's meta. `lock` marks the touched keys as manual so
  // the sync tool won't overwrite them.
  async update(projectId, partial, { lock = [] } = {}) {
    const cur = metaById.get(projectId) || {};
    const next = { ...cur, ...partial, updatedAt: Date.now() };
    if (lock.length) {
      next.locked = { ...(cur.locked || {}) };
      for (const k of lock) next.locked[k] = true;
    }
    metaById.set(projectId, next);
    emit();
    const write = { ...partial, updatedAt: next.updatedAt };
    if (lock.length) write.locked = next.locked;
    await setDoc(doc(db, 'projectMeta', projectId), write, { merge: true })
      .catch(err => console.warn('projectMeta save failed', projectId, err?.code || err));
  },

  user() {
    return userDoc;
  },

  async updateUser(partial) {
    userDoc = { ...userDoc, ...partial };
    emit();
    if (!uid) return;
    await setDoc(doc(db, 'mareo_v2', uid), { ...partial, updatedAt: Date.now() }, { merge: true })
      .catch(err => console.warn('mareo_v2 save failed', err?.code || err));
  },
};
