import { authorizedFetch } from "./auth";

const SPREADSHEET_ID = "1VVVMkx9Woqxvfs8u7IWWfWwxz_kJ7h4OD9s5oC4u2ts";

export type SheetLocation = "HAUT" | "BAS" | "PORTIVY";

export interface ReservationRow {
  rowIndex: number; // To know which row to update
  id: string; // fallback if needed
  [key: string]: any;
}

export interface SheetData {
  headers: string[];
  rows: ReservationRow[];
}

export async function fetchSheetData(location: SheetLocation): Promise<SheetData> {
  const res = await authorizedFetch(`https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}/values/${encodeURIComponent(location)}`, {
    headers: {
      'Cache-Control': 'no-cache',
      'Pragma': 'no-cache'
    },
    cache: 'no-store'
  });

  if (!res.ok) {
    throw new Error("Failed to fetch sheet data");
  }

  const result = await res.json();
  const values = result.values;
  
  if (!values || values.length === 0) {
    return { headers: [], rows: [] };
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

  return { headers, rows };
}

export async function addSheetRow(
  location: SheetLocation,
  values: string[]
) {
  const res = await authorizedFetch(`https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}/values/${encodeURIComponent(location)}:append?valueInputOption=USER_ENTERED`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      values: [values]
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
  updatedRowData: Record<string, string>
) {
  // Reconstruct row array based on headers
  const newRow: string[] = headers.map(header => updatedRowData[header] || "");

  const range = `${location}!A${rowIndex}`; // Overwriting the whole row

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
