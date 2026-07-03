import { CALENDAR_IDS } from "./calendarApi";
import { authorizedFetch } from "./auth";

export interface IcalEvent {
  start: Date;
  end: Date;
  summary: string;
}

// Agendas lus pour chaque maison : l'agenda Google historique (celui dans
// lequel « Bloquer sur Airbnb » écrit) + l'agenda importé depuis Airbnb
// (Google Agenda → « Ajouter un agenda → À partir de l'URL » avec l'export
// iCal de l'annonce Airbnb). Les doublons entre sources sont filtrés.
const READ_CALENDAR_IDS: Record<string, string[]> = {
  BAS: [CALENDAR_IDS.BAS, "0cs87obk61n9r61dv7cif9n9163vi6ab@import.calendar.google.com"],
  HAUT: [CALENDAR_IDS.HAUT, "cvv6kpeb5pmlqni3jmrljmavsdn5deso@import.calendar.google.com"],
  PORTIVY: [CALENDAR_IDS.PORTIVY, "2nlubhr2o5ps3n3ok5inntfnmo7gf5b7@import.calendar.google.com"],
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

async function fetchCalendarEvents(calendarId: string): Promise<IcalEvent[]> {
  const timeMin = new Date(new Date().getFullYear() - HISTORY_YEARS, 0, 1).toISOString();
  const events: IcalEvent[] = [];
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
        events.push({ start, end, summary: item.summary || "" });
      }
    }
    pageToken = data.nextPageToken;
  } while (pageToken);

  return events;
}

const dayKey = (d: Date) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;

export async function fetchExternalCalendar(locationName: string): Promise<IcalEvent[]> {
  const calendarIds = READ_CALENDAR_IDS[locationName];
  if (!calendarIds || calendarIds.length === 0) return [];

  // Chaque agenda est lu indépendamment : si l'un échoue (ex. agenda Airbnb
  // non partagé avec le compte connecté), les autres restent affichés.
  const results = await Promise.allSettled(calendarIds.map(fetchCalendarEvents));

  const merged: IcalEvent[] = [];
  const seen = new Set<string>();
  for (const result of results) {
    if (result.status === "rejected") {
      console.warn("Agenda ignoré:", result.reason?.message || result.reason);
      continue;
    }
    for (const evt of result.value) {
      const key = `${dayKey(evt.start)}|${dayKey(evt.end)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      merged.push(evt);
    }
  }

  if (merged.length === 0 && results.every(r => r.status === "rejected")) {
    throw new Error("Impossible de récupérer les agendas de " + locationName);
  }
  return merged;
}
