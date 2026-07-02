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

export const AUTH_EXPIRED_EVENT = "auth-expired";

const clearStoredToken = () => {
  cachedAccessToken = null;
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(TOKEN_EXPIRY_KEY);
};

// Prévient l'app que la session Google n'est plus valable : App.tsx écoute
// cet événement et raffiche l'écran de connexion (le popup Google ne peut
// être rouvert que sur un clic utilisateur).
const notifyAuthExpired = () => {
  clearStoredToken();
  window.dispatchEvent(new CustomEvent(AUTH_EXPIRED_EVENT));
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
