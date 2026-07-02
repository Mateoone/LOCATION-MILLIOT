import { CALENDAR_IDS } from "./calendarApi";
import { authorizedFetch } from "./auth";

export interface IcalEvent {
  start: Date;
  end: Date;
  summary: string;
}

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

export async function fetchExternalCalendar(locationName: string): Promise<IcalEvent[]> {
  const calendarId = CALENDAR_IDS[locationName];
  if (!calendarId) return [];

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
      throw new Error("Impossible de récupérer le calendrier Google de " + locationName);
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
