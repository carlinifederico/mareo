import { auth, googleProvider, signInWithPopup, signOut as fbSignOut, onAuthStateChanged } from './firebase-config.js';

const ADMIN_EMAIL = 'carlinifederico@gmail.com';

export const Auth = {
  currentUser: null,

  init(onSignIn, onSignOut) {
    onAuthStateChanged(auth, (user) => {
      if (user) {
        this.currentUser = user;
        onSignIn(user);
      } else {
        this.currentUser = null;
        onSignOut();
      }
    });
  },

  async signInWithGoogle() {
    try {
      await signInWithPopup(auth, googleProvider);
    } catch (err) {
      console.error('Sign-in error:', err);
    }
  },

  async signOut() {
    try {
      await fbSignOut(auth);
    } catch (err) {
      console.error('Sign-out error:', err);
    }
  },

  isAdmin() {
    return this.currentUser?.email === ADMIN_EMAIL;
  },

  getUid() {
    return this.currentUser?.uid || null;
  },

  getEmail() {
    return this.currentUser?.email || '';
  },

  getDisplayName() {
    return this.currentUser?.displayName || '';
  },

  getPhotoURL() {
    return this.currentUser?.photoURL || '';
  }
};
