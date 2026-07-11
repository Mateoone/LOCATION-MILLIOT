import { authorizedFetch } from "./auth";
import { readCache, writeCache, notifyOffline, notifyOnline, isNetworkError } from "./offlineCache";

const SPREADSHEET_ID = "1VVVMkx9Woqxvfs8u7IWWfWwxz_kJ7h4OD9s5oC4u2ts";

export type SheetLocation = "HAUT" | "BAS" | "PORTIVY";

export interface ReservationRow {
  rowIndex: number; // To know which row to update
  id: string; // fallback if needed
  [key: string]: any;
}

export interface SheetData {
  headers: string[];      // entêtes dédupliquées (« Nom (2) »…) utilisées comme clés
  rawHeaders: string[];   // ligne 1 du Sheet telle quelle — sert de garde-fou à l'écriture
  rows: ReservationRow[];
}

// Index de colonne (0-based) → lettre A1 (A, B, …, Z, AA, AB…).
function colLetter(index: number): string {
  let n = index + 1;
  let s = '';
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

// Garde-fou anti-décalage : avant TOUTE écriture, on vérifie que la ligne
// d'entêtes du Sheet n'a pas changé depuis le chargement (colonne ajoutée,
// déplacée ou renommée pendant que l'app était ouverte). Sinon la réécriture
// positionnelle décalerait les données.
async function assertSheetStructure(location: SheetLocation, expectedRawHeaders: string[]) {
  const res = await authorizedFetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}/values/${encodeURIComponent(`${location}!1:1`)}`,
    { headers: { 'Cache-Control': 'no-cache' }, cache: 'no-store' }
  );
  if (!res.ok) throw new Error("Impossible de vérifier la structure du tableau avant écriture.");
  const current: string[] = (await res.json()).values?.[0] ?? [];
  const norm = (h: string | undefined) => (h || '').trim();
  const mismatch =
    expectedRawHeaders.some((h, i) => norm(h) !== norm(current[i])) ||
    current.slice(expectedRawHeaders.length).some(h => norm(h) !== '');
  if (mismatch) {
    throw new Error(
      "La structure du tableau a changé depuis le chargement (colonne ajoutée, déplacée ou renommée). " +
      "Rechargez l'application puis recommencez — rien n'a été écrit."
    );
  }
}

export async function fetchSheetData(location: SheetLocation): Promise<SheetData> {
  const cacheKey = `sheet:${location}`;
  try {
    const res = await authorizedFetch(`https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}/values/${encodeURIComponent(location)}`, {
      headers: {
        'Cache-Control': 'no-cache',
        'Pragma': 'no-cache'
      },
      cache: 'no-store'
    });

    if (!res.ok) {
      // Message SANS « fetch » : ce n'est pas une panne réseau mais une erreur
      // applicative de l'API (droits, quota, 5xx) → ne doit pas déclencher le
      // mode hors-ligne (cf. isNetworkError).
      throw new Error(`Réponse inattendue de Google Sheets (HTTP ${res.status}).`);
    }

    const result = await res.json();
    const values = result.values;

    if (!values || values.length === 0) {
      const empty = { headers: [], rawHeaders: [], rows: [] };
      writeCache(cacheKey, empty);
      notifyOnline();
      return empty;
    }

    const rawHeaders = values[0] as string[];
    const headers: string[] = [];
    const headerCount = new Map<string, number>();

    for (const h of rawHeaders) {
      const headerStr = h ? h.trim() : "Colonne sans nom";
      if (headerCount.has(headerStr)) {
        const count = headerCount.get(headerStr)! + 1;
        headerCount.set(headerStr, count);
        headers.push(`${headerStr} (${count})`);
      } else {
        headerCount.set(headerStr, 1);
        headers.push(headerStr);
      }
    }

    const rows: ReservationRow[] = [];

    for (let i = 1; i < values.length; i++) {
      const rowValues = values[i];
      const rowObj: ReservationRow = { rowIndex: i + 1, id: `${location}-${i + 1}` };
      headers.forEach((header, index) => {
        rowObj[header] = rowValues[index] || "";
      });
      rows.push(rowObj);
    }

    const data = { headers, rawHeaders: rawHeaders.map(h => (h || '').toString()), rows };
    writeCache(cacheKey, data); // pour un affichage hors-ligne ultérieur
    notifyOnline();             // lecture en ligne réussie → referme le bandeau
    return data;
  } catch (err) {
    // Réseau absent : on sert la dernière version connue si on l'a.
    if (isNetworkError(err)) {
      const cached = readCache<SheetData>(cacheKey);
      if (cached) {
        notifyOffline(cached.savedAt);
        return cached.data;
      }
    }
    throw err;
  }
}

export async function addSheetRow(
  location: SheetLocation,
  values: string[],
  rawHeaders: string[]
) {
  await assertSheetStructure(location, rawHeaders);

  // Ligne calée sur la largeur exacte des entêtes, et append ancré sur A1
  // (insertDataOption=INSERT_ROWS) pour que l'API ne « devine » pas une autre
  // zone de tableau et ne décale pas les colonnes.
  const paddedRow = Array.from({ length: rawHeaders.length }, (_, i) => values[i] ?? "");

  const res = await authorizedFetch(`https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}/values/${encodeURIComponent(`${location}!A1`)}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      values: [paddedRow]
    })
  });

  if (!res.ok) {
    const err = await res.text();
    console.error("Append error", err);
    throw new Error("Erreur de l'API Google Sheets: " + err);
  }
}
export async function updateSheetRow(
  location: SheetLocation,
  rowIndex: number,
  headers: string[],
  updatedRowData: Record<string, string>,
  rawHeaders: string[]
) {
  await assertSheetStructure(location, rawHeaders);

  // Reconstruct row array based on headers
  const newRow: string[] = headers.map(header => updatedRowData[header] || "");

  // Plage bornée à la largeur des entêtes : impossible de déborder à droite.
  const range = `${location}!A${rowIndex}:${colLetter(headers.length - 1)}${rowIndex}`;

  const res = await authorizedFetch(`https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}/values/${encodeURIComponent(range)}?valueInputOption=USER_ENTERED`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      range,
      majorDimension: "ROWS",
      values: [newRow]
    })
  });

  if (!res.ok) {
    const err = await res.text();
    console.error("Update error", err);
    throw new Error("Erreur de l'API Google Sheets: " + err);
  }
}
