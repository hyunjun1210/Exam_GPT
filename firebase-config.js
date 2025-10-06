// Import the functions you need from the SDKs you need
import { initializeApp } from "https://www.gstatic.com/firebasejs/9.22.0/firebase-app.js";
import { getDatabase } from "https://www.gstatic.com/firebasejs/9.22.0/firebase-database.js";

// TODO: Add SDKs for Firebase products that you want to use
// https://firebase.google.com/docs/web/setup#available-libraries

// Your web app's Firebase configuration
// For Firebase JS SDK v7.20.0 and later, measurementId is optional
const firebaseConfig = {
  apiKey: "AIzaSyAy0ag41ls1ANEnmlKThfNTIOF4_ekbvt4",
  authDomain: "gpt-exam-7c7c9.firebaseapp.com",
  databaseURL: "https://gpt-exam-7c7c9-default-rtdb.firebaseio.com",
  projectId: "gpt-exam-7c7c9",
  storageBucket: "gpt-exam-7c7c9.firebasestorage.app",
  messagingSenderId: "144900913181",
  appId: "1:144900913181:web:b0240f83ad5e91e6a2eef4",
  measurementId: "G-LF7KPK67EH"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
export const db = getDatabase(app);