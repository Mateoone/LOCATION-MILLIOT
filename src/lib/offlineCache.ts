// Cache local léger des dernières données chargées, pour servir un contenu
// exploitable quand le réseau est absent (au chalet, connexion capricieuse).

export const OFFLINE_DATA_EVENT = "offline-data";

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

// Une panne réseau fait rejeter fetch avec un TypeError ; une session expirée
// remonte notre message dédié. On ne bascule en cache que pour le réseau.
export function isNetworkError(err: unknown): boolean {
  if (err instanceof TypeError) return true;
  const msg = err instanceof Error ? err.message : String(err);
  return /Session Google expirée/.test(msg) ? false : /network|fetch|Failed to fetch/i.test(msg);
}
