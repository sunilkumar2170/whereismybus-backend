import { initializeApp } from 'firebase/app';
import { getAuth, initializeAuth } from 'firebase/auth';

const firebaseConfig = {
  apiKey: "AIzaSyB91aa5aN9fObbNSzP5XmQvmXTwBLEHkdE",
  authDomain: "whereismybus-d60c4.firebaseapp.com",
  projectId: "whereismybus-d60c4",
  storageBucket: "whereismybus-d60c4.firebasestorage.app",
  messagingSenderId: "862104001077",
  appId: "1:862104001077:web:0c8eeff7ece7934ba7af7c"
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);