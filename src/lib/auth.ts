import { initializeApp } from "firebase/app";
import { getAuth, signInWithPopup, GoogleAuthProvider, onAuthStateChanged, User } from "firebase/auth";
import { getFirestore } from "firebase/firestore";
import firebaseConfig from "../../firebase-applet-config.json";

const app = initializeApp(firebaseConfig);
// L'app AI Studio utilise une base Firestore nommée, pas la base "(default)".
export const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);
export const auth = getAuth(app);

const provider = new GoogleAuthProvider();
provider.addScope("https://www.googleapis.com/auth/spreadsheets");
provider.addScope("https://www.googleapis.com/auth/calendar.events");
provider.addScope("https://www.googleapis.com/auth/calendar");
provider.addScope("https://www.googleapis.com/auth/contacts");

const TOKEN_KEY = "google_access_token";
const TOKEN_EXPIRY_KEY = "google_access_token_expiry";

let isSigningIn = false;
let cachedAccessToken: string | null = null;

export const initAuth = (
  onAuthSuccess?: (user: User, token: string) => void,
  onAuthFailure?: () => void
) => {
  return onAuthStateChanged(auth, async (user: User | null) => {
    if (user) {
      // Check for valid stored token
      const storedToken = localStorage.getItem(TOKEN_KEY);
      const storedExpiry = localStorage.getItem(TOKEN_EXPIRY_KEY);
      
      if (storedToken && storedExpiry && Number(storedExpiry) > Date.now()) {
        cachedAccessToken = storedToken;
      }

      if (cachedAccessToken) {
        if (onAuthSuccess) onAuthSuccess(user, cachedAccessToken);
      } else if (!isSigningIn) {
        cachedAccessToken = null;
        if (onAuthFailure) onAuthFailure();
      }
    } else {
      cachedAccessToken = null;
      if (onAuthFailure) onAuthFailure();
    }
  });
};

export const googleSignIn = async (): Promise<{ user: User; accessToken: string } | null> => {
  try {
    isSigningIn = true;
    const result = await signInWithPopup(auth, provider);
    const credential = GoogleAuthProvider.credentialFromResult(result);
    if (!credential?.accessToken) {
      throw new Error("Failed to get access token from Firebase Auth");
    }

    cachedAccessToken = credential.accessToken;
    localStorage.setItem(TOKEN_KEY, cachedAccessToken);
    localStorage.setItem(TOKEN_EXPIRY_KEY, (Date.now() + 3500 * 1000).toString()); // 1 hour minus a bit for safety

    return { user: result.user, accessToken: cachedAccessToken };
  } catch (error: any) {
    console.error("Sign in error:", error);
    throw error;
  } finally {
    isSigningIn = false;
  }
};

export const getAccessToken = async (): Promise<string | null> => {
  const storedExpiry = localStorage.getItem(TOKEN_EXPIRY_KEY);
  if (!storedExpiry || Number(storedExpiry) <= Date.now()) {
    clearStoredToken();
    return null;
  }

  if (cachedAccessToken) return cachedAccessToken;

  const storedToken = localStorage.getItem(TOKEN_KEY);
  if (storedToken) {
    cachedAccessToken = storedToken;
    return storedToken;
  }
  return null;
};

// Le token OAuth Google expire au bout d'une heure et ne peut pas être
// renouvelé sans popup côté navigateur (GIS a supprimé le refresh iframe,
// et ces scopes n'ont pas de refresh-token exploitable sans backend).
// À l'expiration on prévient App.tsx, qui affiche une bannière de
// reconnexion en place (sans démonter l'app), puis AUTH_RESTORED_EVENT est
// émis après un nouveau login réussi pour que les vues rechargent.
export const AUTH_EXPIRED_EVENT = "auth-expired";
export const AUTH_RESTORED_EVENT = "auth-restored";

const clearStoredToken = () => {
  cachedAccessToken = null;
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(TOKEN_EXPIRY_KEY);
};

let sessionExpired = false;

const notifyAuthExpired = () => {
  clearStoredToken();
  if (sessionExpired) return; // évite les bannières multiples si plusieurs requêtes échouent
  sessionExpired = true;
  window.dispatchEvent(new CustomEvent(AUTH_EXPIRED_EVENT));
};

// Rouvre le popup Google (déclenché par un clic sur la bannière) pour
// récupérer un token frais tout en gardant l'app montée.
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

export const authorizedFetch = async (url: string, init: RequestInit = {}): Promise<Response> => {
  const token = await getAccessToken();
  if (!token) {
    notifyAuthExpired();
    throw new Error("Session Google expirée. Veuillez vous reconnecter.");
  }

  const res = await fetch(url, {
    ...init,
    headers: { ...(init.headers || {}), Authorization: `Bearer ${token}` },
  });

  if (res.status === 401) {
    notifyAuthExpired();
    throw new Error("Session Google expirée. Veuillez vous reconnecter.");
  }
  return res;
};

export const logout = async () => {
  await auth.signOut();
  cachedAccessToken = null;
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(TOKEN_EXPIRY_KEY);
};
