import { CALENDAR_IDS } from "./calendarApi";
import { authorizedFetch } from "./auth";

export interface IcalEvent {
  start: Date;
  end: Date;
  summary: string;
  // 'unavailable' = règle de disponibilité Airbnb (délai mini avant réservation,
  // calendrier non ouvert au-delà d'un an, fermeture manuelle) — PAS une
  // réservation : à exclure des conflits, synchros et calendriers.
  kind?: 'reservation' | 'unavailable';
  // Provenance : notre agenda Google (blocages/miroirs de résas du tableau)
  // ou l'import Airbnb (vraies réservations « Reserved »).
  origin?: 'google' | 'airbnb';
}

export const isUnavailabilityBlock = (summary: string) =>
  /not available|indisponible|blocked|unavailable/i.test(summary || '');

export interface CalendarSourceStatus {
  label: string;        // "Google" ou "Airbnb"
  ok: boolean;
  count: number;
  updated: Date | null; // dernière modification connue (max des events)
}

interface CalendarRef {
  id: string;
  label: string;
}

// Agendas lus pour chaque maison : l'agenda Google historique (celui dans
// lequel « Bloquer sur Airbnb » écrit) + la source Airbnb, lue côté serveur
// via /api/ical/<maison> (flux ICS direct de l'annonce si configuré en
// variable d'environnement, sinon repli sur l'agenda importé Google).
// Les doublons entre sources sont filtrés.
const READ_CALENDARS: Record<string, CalendarRef[]> = {
  BAS: [
    { id: CALENDAR_IDS.BAS, label: "Google" },
    { id: "airbnb", label: "Airbnb" },
  ],
  HAUT: [
    { id: CALENDAR_IDS.HAUT, label: "Google" },
    { id: "airbnb", label: "Airbnb" },
  ],
  PORTIVY: [
    { id: CALENDAR_IDS.PORTIVY, label: "Google" },
    { id: "airbnb", label: "Airbnb" },
  ],
};

// Les vues historiques s'appuient sur le Google Sheet ; les calendriers ne
// servent qu'à vérifier les blocages récents et à venir.
const HISTORY_YEARS = 3;

// start/end au format API Calendar : { date: "2026-07-02" } pour les
// événements journée entière (end exclusif, comme DTEND en iCal),
// { dateTime: "..." } pour les événements horodatés.
function parseEventDate(d: { date?: string; dateTime?: string }): Date | null {
  if (d.dateTime) {
    const parsed = new Date(d.dateTime);
    return isNaN(parsed.getTime()) ? null : parsed;
  }
  if (d.date) {
    const [y, m, day] = d.date.split("-").map(Number);
    return new Date(y, m - 1, day);
  }
  return null;
}

async function fetchCalendarEvents(calendarId: string, origin: 'google' | 'airbnb'): Promise<{ events: IcalEvent[]; updated: Date | null }> {
  const timeMin = new Date(new Date().getFullYear() - HISTORY_YEARS, 0, 1).toISOString();
  const events: IcalEvent[] = [];
  let updated: Date | null = null;
  let pageToken: string | undefined;

  do {
    const params = new URLSearchParams({
      singleEvents: "true",
      orderBy: "startTime",
      maxResults: "2500",
      timeMin,
    });
    if (pageToken) params.set("pageToken", pageToken);

    const res = await authorizedFetch(
      `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events?${params}`
    );

    if (!res.ok) {
      const err = await res.text();
      console.error("Calendar list error", err);
      throw new Error("Impossible de récupérer l'agenda Google " + calendarId);
    }

    const data = await res.json();
    for (const item of data.items || []) {
      if (item.status === "cancelled") continue;
      const start = item.start ? parseEventDate(item.start) : null;
      const end = item.end ? parseEventDate(item.end) : null;
      if (start && end) {
        const summary = item.summary || "";
        events.push({
          start,
          end,
          summary,
          kind: isUnavailabilityBlock(summary) ? "unavailable" : "reservation",
          origin,
        });
      }
      if (item.updated) {
        const u = new Date(item.updated);
        if (!isNaN(u.getTime()) && (!updated || u > updated)) updated = u;
      }
    }
    pageToken = data.nextPageToken;
  } while (pageToken);

  return { events, updated };
}

// Source Airbnb d'une maison, lue par le serveur (/api/ical/<maison>) :
// événements { start, end, summary } en dates YYYY-MM-DD (fin exclusive =
// jour du départ, comme partout). fetchedAt = lecture ICS en direct (données
// à l'instant) ; updated = repli sur l'agenda importé Google.
async function fetchAirbnbEvents(locationName: string): Promise<{ events: IcalEvent[]; updated: Date | null }> {
  const res = await authorizedFetch(`/api/ical/${encodeURIComponent(locationName)}`);
  if (!res.ok) {
    let msg = "";
    try { msg = (await res.json()).error || ""; } catch { /* corps non JSON */ }
    throw new Error(msg || `Source Airbnb ${locationName} indisponible (HTTP ${res.status}).`);
  }
  const data = await res.json();

  const events: IcalEvent[] = [];
  for (const item of data.events || []) {
    const start = parseEventDate({ date: item.start });
    const end = parseEventDate({ date: item.end });
    if (!start || !end) continue;
    const summary = item.summary || "";
    events.push({
      start,
      end,
      summary,
      kind: isUnavailabilityBlock(summary) ? "unavailable" : "reservation",
      origin: "airbnb",
    });
  }

  const stamp = data.fetchedAt || data.updated;
  const updated = stamp ? new Date(stamp) : null;
  return { events, updated: updated && !isNaN(updated.getTime()) ? updated : null };
}

const dayKey = (d: Date) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;

export async function fetchCalendarsWithStatus(
  locationName: string
): Promise<{ events: IcalEvent[]; sources: CalendarSourceStatus[] }> {
  const calendars = READ_CALENDARS[locationName];
  if (!calendars || calendars.length === 0) return { events: [], sources: [] };

  // Chaque source est lue indépendamment : si l'une échoue (ex. flux Airbnb
  // indisponible), les autres restent affichées.
  const results = await Promise.allSettled(
    calendars.map(c =>
      c.label === 'Airbnb' ? fetchAirbnbEvents(locationName) : fetchCalendarEvents(c.id, 'google')
    )
  );

  const merged: IcalEvent[] = [];
  const seen = new Set<string>();
  const sources: CalendarSourceStatus[] = [];

  results.forEach((result, i) => {
    const ref = calendars[i];
    if (result.status === "rejected") {
      console.warn("Agenda ignoré:", result.reason?.message || result.reason);
      sources.push({ label: ref.label, ok: false, count: 0, updated: null });
      return;
    }
    sources.push({ label: ref.label, ok: true, count: result.value.events.length, updated: result.value.updated });
    for (const evt of result.value.events) {
      const key = `${dayKey(evt.start)}|${dayKey(evt.end)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      merged.push(evt);
    }
  });

  if (merged.length === 0 && results.every(r => r.status === "rejected")) {
    throw new Error("Impossible de récupérer les agendas de " + locationName);
  }
  return { events: merged, sources };
}

// Conservé pour les appelants qui n'ont besoin que des événements.
export async function fetchExternalCalendar(locationName: string): Promise<IcalEvent[]> {
  const { events } = await fetchCalendarsWithStatus(locationName);
  return events;
}
