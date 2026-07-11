import { initializeApp } from "firebase/app";
import { getAuth, signInWithPopup, GoogleAuthProvider, onAuthStateChanged, User } from "firebase/auth";
import { getFirestore } from "firebase/firestore";
import firebaseConfig from "../../firebase-applet-config.json";

const app = initializeApp(firebaseConfig);
// L'app AI Studio utilise une base Firestore nommée, pas la base "(default)".
export const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);
export const auth = getAuth(app);

// v3.0 : l'app ne demande plus AUCUN scope Google. Les API Sheets/Agenda sont
// appelées par le serveur (compte de service) via /api/google/* — le
// navigateur ne détient plus de token OAuth utilisateur. La connexion se
// résume au choix du compte Google (plus d'écran de consentement) et la
// session Firebase persiste ensuite pendant des mois, rafraîchie en silence.
const provider = new GoogleAuthProvider();

// Nettoyage des tokens OAuth stockés par les versions ≤ 2.9.
localStorage.removeItem("google_access_token");
localStorage.removeItem("google_access_token_expiry");

export const initAuth = (
  onAuthSuccess?: (user: User) => void,
  onAuthFailure?: () => void
) => {
  return onAuthStateChanged(auth, (user: User | null) => {
    if (user) {
      sessionExpired = false;
      onAuthSuccess?.(user);
    } else {
      onAuthFailure?.();
    }
  });
};

export const googleSignIn = async (): Promise<User> => {
  const result = await signInWithPopup(auth, provider);
  return result.user;
};

// La session Firebase se rafraîchit toute seule ; ces événements ne servent
// plus que pour les cas rares où elle devient irrécupérable (compte
// désactivé, déconnexion dans un autre onglet…).
export const AUTH_EXPIRED_EVENT = "auth-expired";
export const AUTH_RESTORED_EVENT = "auth-restored";

let sessionExpired = false;

const notifyAuthExpired = () => {
  if (sessionExpired) return; // évite les bannières multiples si plusieurs requêtes échouent
  sessionExpired = true;
  window.dispatchEvent(new CustomEvent(AUTH_EXPIRED_EVENT));
};

// Rouvre le popup Google (déclenché par un clic sur la bannière) pour
// rétablir la session tout en gardant l'app montée.
export const reconnect = async (): Promise<boolean> => {
  try {
    await googleSignIn();
    sessionExpired = false;
    window.dispatchEvent(new CustomEvent(AUTH_RESTORED_EVENT));
    return true;
  } catch (error) {
    console.error("Reconnexion échouée:", error);
    return false;
  }
};

// Réécrit les URL Google vers le proxy du serveur (/api/google/<host>/…).
const GOOGLE_API_HOSTS = /^https:\/\/(sheets\.googleapis\.com|www\.googleapis\.com)\//;

export const authorizedFetch = async (url: string, init: RequestInit = {}): Promise<Response> => {
  const user = auth.currentUser;
  if (!user) {
    notifyAuthExpired();
    throw new Error("Session expirée. Veuillez vous reconnecter.");
  }

  // getIdToken() renvoie le token de session en le rafraîchissant en silence
  // si besoin — aucun popup, contrairement à l'ancien token OAuth d'une heure.
  let token: string;
  try {
    token = await user.getIdToken();
  } catch (err: any) {
    if (err?.code === "auth/network-request-failed") {
      // Requalifié en panne réseau (TypeError) pour que les vues basculent
      // sur le cache local (cf. offlineCache.isNetworkError).
      throw new TypeError("Réseau indisponible pour rafraîchir la session.");
    }
    notifyAuthExpired();
    throw new Error("Session expirée. Veuillez vous reconnecter.");
  }

  const res = await fetch(url.replace(GOOGLE_API_HOSTS, "/api/google/$1/"), {
    ...init,
    headers: { ...(init.headers || {}), Authorization: `Bearer ${token}` },
  });

  if (res.status === 401) {
    notifyAuthExpired();
    throw new Error("Session expirée. Veuillez vous reconnecter.");
  }
  return res;
};

export const logout = async () => {
  await auth.signOut();
};
