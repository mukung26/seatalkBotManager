import { initializeApp } from 'firebase/app';
import { getFirestore } from 'firebase/firestore';
import { getAuth, GoogleAuthProvider } from 'firebase/auth';

// Replace these values with your actual Firebase config from the Firebase Console
const firebaseConfig = {
  apiKey: "AIzaSyCw6C2boDdbygr6r6KWlIEM82ike4kwsYg",
  authDomain: "gen-lang-client-0694611650.firebaseapp.com",
  projectId: "gen-lang-client-0694611650",
  storageBucket: "gen-lang-client-0694611650.firebasestorage.app",
  messagingSenderId: "802673836866",
  appId: "1:802673836866:web:b3ab06fe5973b78221fedb"
};

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
export const auth = getAuth(app);
export const googleProvider = new GoogleAuthProvider();
googleProvider.addScope('https://www.googleapis.com/auth/spreadsheets');
