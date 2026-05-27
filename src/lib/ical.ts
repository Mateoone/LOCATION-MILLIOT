import { parse, isValid } from 'date-fns';

export interface IcalEvent {
  start: Date;
  end: Date;
  summary: string;
}

export const ICAL_URLS: Record<string, string> = {
  'BAS': 'https://calendar.google.com/calendar/ical/a8bcfb8768d29e157ae40e2692de3b4722848f3af2e2d0e9dd55b6776b5f4d84%40group.calendar.google.com/private-1b8f68683f2db0325d1bacb1aa1aa538/basic.ics',
  'HAUT': 'https://calendar.google.com/calendar/ical/1i5gq28cvbedqgvs7lkad892k0%40group.calendar.google.com/public/basic.ics',
  'PORTIVY': 'https://www.google.com/calendar/ical/vg7kplqnr05rkeqjrnnn03pt70%40group.calendar.google.com/private-9a41f84d5f7e50cec5e6df808a150d9c/basic.ics'
};

function parseIcalDate(dateStr: string): Date {
  const y = parseInt(dateStr.substring(0, 4), 10);
  const m = parseInt(dateStr.substring(4, 6), 10) - 1;
  const d = parseInt(dateStr.substring(6, 8), 10);
  
  if (dateStr.length > 8) {
    // 20241011T123000Z
    const tIndex = dateStr.indexOf('T');
    if (tIndex !== -1) {
      const h = parseInt(dateStr.substring(tIndex + 1, tIndex + 3), 10);
      const min = parseInt(dateStr.substring(tIndex + 3, tIndex + 5), 10);
      const s = parseInt(dateStr.substring(tIndex + 5, tIndex + 7), 10);
      
      const isUTC = dateStr.endsWith('Z');
      if (isUTC) {
        return new Date(Date.UTC(y, m, d, h, min, s));
      } else {
        return new Date(y, m, d, h, min, s);
      }
    }
  }
  
  // Date-only format acts as midnight local time usually
  return new Date(y, m, d);
}

export async function fetchExternalCalendar(locationName: string): Promise<IcalEvent[]> {
  const url = ICAL_URLS[locationName];
  if (!url) return [];

  let text = '';
  let fetched = false;
  
  const proxies = [
    `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`,
    `https://api.codetabs.com/v1/proxy?quest=${url}`,
    `https://corsproxy.io/?${encodeURIComponent(url)}`
  ];

  for (const proxyUrl of proxies) {
    try {
      const response = await fetch(proxyUrl);
      if (response.ok) {
        text = await response.text();
        fetched = true;
        break; // Success
      } else {
        console.warn(`Proxy ${proxyUrl} returned ${response.status}`);
      }
    } catch (err) {
      console.warn(`Proxy ${proxyUrl} failed:`, err);
    }
  }

  if (!fetched) {
    console.error("Failed to fetch custom iCal for", locationName, "All proxies failed");
    throw new Error("Impossible de télécharger le calendrier Airbnb. Veuillez réessayer plus tard.");
  }

  try {    
    const events: IcalEvent[] = [];
    let currentEvent: Partial<IcalEvent> | null = null;
    
    const lines = text.split(/\r?\n/);
    for (const line of lines) {
      if (line.startsWith('BEGIN:VEVENT')) {
        currentEvent = {};
      } else if (line.startsWith('END:VEVENT')) {
        if (currentEvent && currentEvent.start && currentEvent.end) {
          events.push(currentEvent as IcalEvent);
        }
        currentEvent = null;
      } else if (currentEvent) {
        if (line.startsWith('DTSTART')) {
          const match = line.match(/:([0-9]{8}(?:T[0-9]{6}Z?)?)/);
          if (match) currentEvent.start = parseIcalDate(match[1]);
        } else if (line.startsWith('DTEND')) {
          const match = line.match(/:([0-9]{8}(?:T[0-9]{6}Z?)?)/);
          if (match) currentEvent.end = parseIcalDate(match[1]);
        } else if (line.startsWith('SUMMARY:')) {
          currentEvent.summary = line.substring(8);
        }
      }
    }
    
    return events;
  } catch (err) {
    console.error("Failed to fetch custom iCal for", locationName, err);
    return [];
  }
}
