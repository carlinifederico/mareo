// Read/write layer for userProfiles/{uid}. Exists so that an inviter can
// type a collaborator's email and resolve it to a uid for adding to a
// project's members map.
//
// ensureMine() runs once per session right after auth completes, so any
// MAREO user that has signed in at least once is discoverable by email.
// Users that never signed in cannot be invited yet (Phase 3 would add a
// pending-invites flow keyed by lowercase email).

import {
  db, doc, getDoc, setDoc,
  collection, query, where, getDocs,
} from './firebase-config.js';

function normalizeEmail(email) {
  return (email || '').trim().toLowerCase();
}

export const ProfilesRepo = {
  async ensureMine(user) {
    if (!user || !user.uid) return;
    const ref = doc(db, 'userProfiles', user.uid);
    await setDoc(ref, {
      email: normalizeEmail(user.email),
      displayName: user.displayName || '',
      photoURL: user.photoURL || '',
      updatedAt: Date.now(),
    }, { merge: true });
  },

  async findUidByEmail(email) {
    const norm = normalizeEmail(email);
    if (!norm) return null;
    const q = query(
      collection(db, 'userProfiles'),
      where('email', '==', norm)
    );
    const snap = await getDocs(q);
    if (snap.empty) return null;
    return snap.docs[0].id;
  },

  async load(uid) {
    if (!uid) return null;
    const snap = await getDoc(doc(db, 'userProfiles', uid));
    return snap.exists() ? { uid, ...snap.data() } : null;
  },

  async loadMany(uids) {
    if (!uids || uids.length === 0) return [];
    const settled = await Promise.allSettled(uids.map(u => this.load(u)));
    return settled
      .filter(r => r.status === 'fulfilled' && r.value)
      .map(r => r.value);
  },
};
