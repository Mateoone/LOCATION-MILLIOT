import { parse, isValid } from 'date-fns';
import { SheetData, ReservationRow, SheetLocation } from './sheets';
import { IcalEvent } from './ical';

export interface UnifiedBooking {
  id: string;
  title: string;
  start: Date;          // arrivée (jour inclus)
  end: Date;            // départ (jour de checkout, exclu)
  source: string;
  location: SheetLocation;
  isExternal: boolean;  // true = vient d'un agenda (Airbnb), pas du Sheet
  row?: ReservationRow;
}

export interface DetectedHeaders {
  startHeader?: string;
  endHeader?: string;
  nameHeader?: string;
  priceHeader?: string;
  sourceHeader?: string;
}

export const LOCATION_LABELS: Record<SheetLocation, string> = {
  HAUT: 'Chalet Haut',
  BAS: 'Chalet Bas',
  PORTIVY: 'Portivy',
};

// Détection des colonnes du Sheet — mêmes heuristiques que les autres vues.
export function detectHeaders(headers: string[]): DetectedHeaders {
  return {
    startHeader:
      headers.find(h => /début|debut|arrivée|arrivee|start/i.test(h)) ||
      headers.find(h => /date/i.test(h)),
    endHeader: headers.find(h => /fin|départ|depart|end/i.test(h)),
    nameHeader: headers.find(h => /nom|locataire|client|name/i.test(h)) || headers[0],
    priceHeader: headers.find(h => /prix|loyer|total|montant|tarif/i.test(h)),
    sourceHeader: headers.find(h => /source|plateforme|origine/i.test(h)),
  };
}

export function parseFlexibleDate(dateStr: string | undefined | null): Date | null {
  if (!dateStr) return null;
  let parsed = parse(dateStr.trim(), 'dd/MM/yyyy', new Date());
  if (!isValid(parsed)) parsed = new Date(dateStr);
  return isValid(parsed) ? parsed : null;
}

const dayKey = (d: Date) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;

// Fusionne les réservations du Sheet et les événements externes (Airbnb),
// en évitant les doublons de dates strictement identiques.
export function buildBookings(
  data: SheetData,
  location: SheetLocation,
  externalEvents: IcalEvent[]
): UnifiedBooking[] {
  const { startHeader, endHeader, nameHeader, sourceHeader } = detectHeaders(data.headers);
  const list: UnifiedBooking[] = [];

  if (startHeader) {
    data.rows.forEach((row, idx) => {
      const start = parseFlexibleDate(row[startHeader]);
      if (!start) return;
      const end = (endHeader && parseFlexibleDate(row[endHeader])) || start;
      list.push({
        id: `sheet-${location}-${row.id || idx}`,
        title: (nameHeader && row[nameHeader]) || 'Réservation',
        start,
        end,
        source: (sourceHeader && row[sourceHeader]) || 'Direct',
        location,
        isExternal: false,
        row,
      });
    });
  }

  const seen = new Set(list.map(b => `${dayKey(b.start)}|${dayKey(b.end)}`));
  externalEvents.forEach((ext, idx) => {
    const key = `${dayKey(ext.start)}|${dayKey(ext.end)}`;
    if (seen.has(key)) return;
    seen.add(key);
    list.push({
      id: `ext-${location}-${idx}`,
      title: ext.summary || 'Airbnb',
      start: ext.start,
      end: ext.end,
      source: 'Airbnb',
      location,
      isExternal: true,
    });
  });

  return list;
}

export interface BookingConflict {
  a: UnifiedBooking;
  b: UnifiedBooking;
}

const isAirbnb = (b: UnifiedBooking) => b.isExternal || /airbnb/i.test(b.source);

// Deux séjours d'une même maison se chevauchent si l'un commence avant la fin
// de l'autre (fin exclusive → le back-to-back checkout=checkin n'est PAS un
// conflit). On ignore le cas « événement Airbnb externe vs ligne Sheet Airbnb »
// qui décrivent la même réservation.
export function findConflicts(bookings: UnifiedBooking[]): BookingConflict[] {
  const conflicts: BookingConflict[] = [];
  const sorted = [...bookings].sort((x, y) => x.start.getTime() - y.start.getTime());

  for (let i = 0; i < sorted.length; i++) {
    for (let j = i + 1; j < sorted.length; j++) {
      const a = sorted[i];
      const b = sorted[j];
      if (a.location !== b.location) continue;
      if (b.start.getTime() >= a.end.getTime()) break; // trié : plus aucun chevauchement possible avec a
      if (a.start.getTime() >= b.end.getTime()) continue;
      // Miroir Airbnb (agenda externe) ↔ ligne Airbnb du Sheet : même résa.
      if (isAirbnb(a) && isAirbnb(b) && a.isExternal !== b.isExternal) continue;
      conflicts.push({ a, b });
    }
  }
  return conflicts;
}
