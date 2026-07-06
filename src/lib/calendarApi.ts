import { authorizedFetch } from "./auth";
import { format } from "date-fns";

export const CALENDAR_IDS: Record<string, string> = {
  'BAS': 'a8bcfb8768d29e157ae40e2692de3b4722848f3af2e2d0e9dd55b6776b5f4d84@group.calendar.google.com',
  'HAUT': '1i5gq28cvbedqgvs7lkad892k0@group.calendar.google.com',
  'PORTIVY': 'vg7kplqnr05rkeqjrnnn03pt70@group.calendar.google.com'
};

export async function addEventToGoogleCalendar(
  locationName: string,
  start: Date,
  end: Date,
  summary: string
) {
  const calendarId = CALENDAR_IDS[locationName];
  if (!calendarId) throw new Error("Calendar ID not found for location: " + locationName);

  // Convention commune tableau/Airbnb : « fin » = jour du départ. Le DTEND
  // des événements journée entière étant déjà exclusif, on l'utilise tel quel
  // (l'ancien +1 bloquait un jour de trop sur Airbnb).
  const eventPayload = {
    summary: summary || "Réservation",
    start: {
      date: format(start, 'yyyy-MM-dd')
    },
    end: {
      date: format(end, 'yyyy-MM-dd')
    },
    transparency: "opaque" // blocks the time
  };

  const res = await authorizedFetch(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(eventPayload)
  });

  if (!res.ok) {
    const errText = await res.text();
    console.error("Calendar insertion error", errText);
    throw new Error("Calendar API Error: " + errText);
  }
}
