// firebase.js
// Poultry Medicine Manager
// Version 1.0.0

import { initializeApp } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js";

import {
  getAuth
} from "https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js";

import {
  getFirestore
} from "https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyB_EYa-XcZptvyj3RpIkcNX6XPZXXgVdTE",
  authDomain: "poultry-medicine-manager.firebaseapp.com",
  projectId: "poultry-medicine-manager",
  storageBucket: "poultry-medicine-manager.firebasestorage.app",
  messagingSenderId: "701249686998",
  appId: "1:701249686998:web:0e7fe4fb188947e2026877"
};

const app = initializeApp(firebaseConfig);

export const auth = getAuth(app);
export const db = getFirestore(app);

export { app };
