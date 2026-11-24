// Firebase web app config (public by design; access is controlled by Firestore/Storage rules)
// Firebase console > Project settings > Your apps > Web app > SDK setup and configuration
export const firebaseConfig = {
  apiKey: "AIzaSyB-F4FneTOz53jFXghmSaTRC266qSvBbD8",
  authDomain: "tnt-games-41664.firebaseapp.com",
  projectId: "tnt-games-41664",
  storageBucket: "tnt-games-41664.firebasestorage.app",
  messagingSenderId: "850146833305",
  appId: "1:850146833305:web:b0ede4d9163f51caae9908",
  measurementId: "G-2PZ9VMSQVJ"
};
export const REGION = "asia-south1";
export const FIREBASE_VERSION = "10.14.1";

// ---- UPI payments with manual approval ----
// upiId:      your UPI ID (ideally a merchant/business UPI), e.g. "tntgames@ybl"
// payeeName:  the name shown in the buyer's UPI app
// notifyKey:  free Web3Forms access key (web3forms.com: enter your email, they email you the key).
//             New orders are emailed to that address with an "Approve" link.
// gameFilesInStorage: true once game files are uploaded to Firebase Storage (needs the Blaze plan).
//             While false, owners are sent to each game's link from the dashboard.
export const PAYMENT = {
  upiId: "",
  payeeName: "TnT Brother Games",
  notifyKey: "",
  gameFilesInStorage: false
};
