// Cache local léger des dernières données chargées, pour servir un contenu
// exploitable quand le réseau est absent (au chalet, connexion capricieuse).

export const OFFLINE_DATA_EVENT = "offline-data";
export const ONLINE_DATA_EVENT = "online-data";

interface CacheEntry<T> {
  savedAt: number;
  data: T;
}

const PREFIX = "cache:";

export function writeCache<T>(key: string, data: T): void {
  try {
    const entry: CacheEntry<T> = { savedAt: Date.now(), data };
    localStorage.setItem(PREFIX + key, JSON.stringify(entry));
  } catch {
    // quota plein / mode privé : le cache est best-effort.
  }
}

export function readCache<T>(key: string): { data: T; savedAt: number } | null {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    if (!raw) return null;
    const entry = JSON.parse(raw) as CacheEntry<T>;
    return { data: entry.data, savedAt: entry.savedAt };
  } catch {
    return null;
  }
}

// Signale à l'app qu'on sert des données du cache (réseau indisponible).
export function notifyOffline(savedAt: number): void {
  window.dispatchEvent(new CustomEvent(OFFLINE_DATA_EVENT, { detail: { savedAt } }));
}

// Signale un chargement en ligne réussi → l'app referme le bandeau hors-ligne.
export function notifyOnline(): void {
  window.dispatchEvent(new CustomEvent(ONLINE_DATA_EVENT));
}

// Vraie panne réseau uniquement : fetch() rejette alors avec un TypeError, ou
// le navigateur se déclare hors-ligne. On NE bascule PAS en cache pour une
// erreur applicative de l'API (HTTP 4xx/5xx, session expirée) — sinon un
// simple hoquet Google afficherait à tort « Mode hors-ligne ».
export function isNetworkError(err: unknown): boolean {
  if (typeof navigator !== "undefined" && navigator.onLine === false) return true;
  return err instanceof TypeError;
}
