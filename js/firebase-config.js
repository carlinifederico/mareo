import { initializeApp } from 'https://www.gstatic.com/firebasejs/11.7.3/firebase-app.js';
import { getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/11.7.3/firebase-auth.js';
import { getFirestore, doc, getDoc, setDoc } from 'https://www.gstatic.com/firebasejs/11.7.3/firebase-firestore.js';

const firebaseConfig = {
  apiKey: "AIzaSyDs5uC2ApmBmFI4GfeU4ErQTS0XmW5LOJw",
  authDomain: "mareo-app-8de88.firebaseapp.com",
  projectId: "mareo-app-8de88",
  storageBucket: "mareo-app-8de88.firebasestorage.app",
  messagingSenderId: "774593066649",
  appId: "1:774593066649:web:398f63297853768c8aea08",
  measurementId: "G-5Z6SB8RQPH"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const googleProvider = new GoogleAuthProvider();

export { auth, db, googleProvider, signInWithPopup, signOut, onAuthStateChanged, doc, getDoc, setDoc };
