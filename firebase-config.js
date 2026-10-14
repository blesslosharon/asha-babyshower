/* =====================================================
   Firebase config — project: ja-nattusakkarai
   -----------------------------------------------------
   A Firebase web apiKey is NOT a secret (it is meant to
   ship in the browser). Data is protected by the
   Firestore security rules in firestore.rules.
   ===================================================== */

const firebaseConfig = {
  apiKey: "AIzaSyAEqFUJaJ7_Eh-HrPQk_UY8Zb299JZhIlg",
  authDomain: "ja-nattusakkarai.firebaseapp.com",
  projectId: "ja-nattusakkarai",
  storageBucket: "ja-nattusakkarai.firebasestorage.app",
  messagingSenderId: "890285745573",
  appId: "1:890285745573:web:713daba1bc6f5372b6b44c",
  measurementId: "G-5EHYYXCKJ5"
};

firebase.initializeApp(firebaseConfig);
