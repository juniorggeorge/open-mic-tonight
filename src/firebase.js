import { initializeApp } from "firebase/app";
import { getFirestore, doc, getDoc, setDoc, collection, getDocs } from "firebase/firestore";

const firebaseConfig = {
  apiKey: "AIzaSyDrcsF6NEZhnuyMgrVoC3GVqvFbtuxOocs",
  authDomain: "open-mic-tonight.firebaseapp.com",
  projectId: "open-mic-tonight",
  storageBucket: "open-mic-tonight.firebasestorage.app",
  messagingSenderId: "867424458531",
  appId: "1:867424458531:web:753f84119f4bb60947de96"
};

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
export { doc, getDoc, setDoc, collection, getDocs };