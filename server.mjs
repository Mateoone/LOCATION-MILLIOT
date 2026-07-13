// Serveur de production Cloud Run : sert le build Vite (dist/) avec repli SPA
// et relaie les appels aux API Google (Sheets/Agenda) via /api/google/*.
//
// Depuis la v3.0, le navigateur ne détient plus aucun token OAuth Google :
// il s'authentifie auprès de CE serveur avec sa session Firebase (allowlist
// famille ci-dessous), et le serveur rejoue la requête avec le compte de
// service du service Cloud Run. Le Google Sheet et les agendas doivent donc
// être partagés avec l'email de ce compte de service (visible sur /api/diag).
// Fini l'écran de consentement OAuth et l'expiration au bout d'une heure.
// Déploiement : npm run deploy (cf. package.json) — ne pas passer par AI Studio.
import express from 'express';
import path from 'path';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { GoogleAuth } from 'google-auth-library';
import { initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dist = path.join(__dirname, 'dist');
const firebaseConfig = JSON.parse(readFileSync(path.join(__dirname, 'firebase-applet-config.json'), 'utf8'));

// Même allowlist que firestore.rules : seuls les comptes famille passent.
const FAMILY_EMAILS = [
  'matthieu.milliot@gmail.com',
  'helene.milliot@gmail.com',
  'matthieu.milliot@wearemip.com',
];

const SPREADSHEET_ID = '1VVVMkx9Woqxvfs8u7IWWfWwxz_kJ7h4OD9s5oC4u2ts';

// Seuls les chemins du Sheet de l'app et de l'API Calendar sont relayés — le
// proxy n'est pas un tunnel générique vers les API Google.
const ALLOWED_TARGETS = [
  { host: 'sheets.googleapis.com', pathPrefix: `/v4/spreadsheets/${SPREADSHEET_ID}/values/` },
  { host: 'www.googleapis.com', pathPrefix: '/calendar/v3/calendars/' },
];
const ALLOWED_METHODS = ['GET', 'POST', 'PUT'];

// verifyIdToken ne vérifie que la signature (certificats publics Google) :
// pas besoin de credentials, seulement du projectId pour l'audience.
initializeApp({ projectId: firebaseConfig.projectId });

// Token du compte de service via les Application Default Credentials (sur
// Cloud Run : le serveur de métadonnées, avec les scopes demandés ici).
const googleAuth = new GoogleAuth({
  scopes: [
    'https://www.googleapis.com/auth/spreadsheets',
    'https://www.googleapis.com/auth/calendar',
  ],
});
let saClient;
async function serviceAccountToken() {
  saClient ??= await googleAuth.getClient();
  const { token } = await saClient.getAccessToken();
  if (!token) throw new Error('Token du compte de service indisponible');
  return token;
}

// Session Firebase valide + email de la famille, sinon 401/403.
async function requireFamily(req, res, next) {
  const match = (req.headers.authorization || '').match(/^Bearer (.+)$/);
  if (!match) return res.status(401).json({ error: 'Session Firebase absente.' });
  try {
    const decoded = await getAuth().verifyIdToken(match[1]);
    if (!decoded.email_verified || !FAMILY_EMAILS.includes(decoded.email)) {
      return res.status(403).json({ error: `Compte ${decoded.email || 'inconnu'} non autorisé.` });
    }
    next();
  } catch {
    return res.status(401).json({ error: 'Session Firebase invalide ou expirée.' });
  }
}

const app = express();

// Proxy Google : /api/google/<host>/<chemin> → https://<host>/<chemin>.
// Le corps est relayé tel quel (raw) pour ne pas altérer l'encodage.
app.use('/api/google', express.raw({ type: () => true, limit: '2mb' }), requireFamily, async (req, res) => {
  const parsed = req.url.match(/^\/([^/?]+)(\/[^?]*)(\?.*)?$/);
  if (!parsed) return res.status(400).json({ error: 'Chemin proxy invalide.' });
  const [, host, pathname, query = ''] = parsed;

  const allowed = ALLOWED_TARGETS.some(t => t.host === host && pathname.startsWith(t.pathPrefix));
  if (!allowed || !ALLOWED_METHODS.includes(req.method)) {
    return res.status(403).json({ error: 'Cible non autorisée par le proxy.' });
  }

  try {
    const headers = { Authorization: `Bearer ${await serviceAccountToken()}` };
    if (req.headers['content-type']) headers['Content-Type'] = req.headers['content-type'];

    const upstream = await fetch(`https://${host}${pathname}${query}`, {
      method: req.method,
      headers,
      body: req.method === 'GET' ? undefined : (req.body?.length ? req.body : undefined),
    });

    res.status(upstream.status);
    res.set('Content-Type', upstream.headers.get('content-type') || 'application/json');
    res.send(Buffer.from(await upstream.arrayBuffer()));
  } catch (err) {
    console.error('Erreur proxy Google:', err);
    res.status(502).json({ error: 'Le relais vers les API Google a échoué.' });
  }
});

// Flux iCal Airbnb lus en direct (v3.2) : les URL contiennent un secret
// (?s=…) et le dépôt est public → elles vivent dans les variables
// d'environnement du service Cloud Run (ICAL_URL_BAS/HAUT/PORTIVY), jamais
// dans le code. Avantage sur l'import Google Agenda : données à jour à
// chaque lecture (l'import n'est rafraîchi qu'environ une fois par jour).
const AIRBNB_ICS_URLS = {
  BAS: process.env.ICAL_URL_BAS,
  HAUT: process.env.ICAL_URL_HAUT,
  PORTIVY: process.env.ICAL_URL_PORTIVY,
};

// Repli si l'URL iCal d'une maison n'est pas configurée : lecture de
// l'agenda Google « importé À partir de l'URL » via le compte de service
// (lisible par tout compte authentifié — l'ID encode le secret de l'URL).
const AIRBNB_IMPORT_CALENDARS = {
  BAS: '0cs87obk61n9r61dv7cif9n9163vi6ab@import.calendar.google.com',
  HAUT: 'cvv6kpeb5pmlqni3jmrljmavsdn5deso@import.calendar.google.com',
  PORTIVY: '2nlubhr2o5ps3n3ok5inntfnmo7gf5b7@import.calendar.google.com',
};

// Parseur minimal du format iCal d'Airbnb : événements journée entière
// (DTEND exclusif = jour du départ, même convention que le Sheet), SUMMARY
// « Reserved » ou « Airbnb (Not available) ». Les lignes longues sont
// « pliées » (continuation par espace) → dépliage avant lecture.
function parseAirbnbIcs(text) {
  const lines = text.replace(/\r?\n[ \t]/g, '').split(/\r?\n/);
  const events = [];
  let cur = null;
  for (const line of lines) {
    if (line === 'BEGIN:VEVENT') cur = {};
    else if (line === 'END:VEVENT') {
      if (cur?.start && cur?.end) events.push(cur);
      cur = null;
    } else if (cur) {
      let m;
      if ((m = line.match(/^DTSTART[^:]*:(\d{4})(\d{2})(\d{2})/))) cur.start = `${m[1]}-${m[2]}-${m[3]}`;
      else if ((m = line.match(/^DTEND[^:]*:(\d{4})(\d{2})(\d{2})/))) cur.end = `${m[1]}-${m[2]}-${m[3]}`;
      else if ((m = line.match(/^SUMMARY[^:]*:(.*)$/))) cur.summary = m[1].trim();
    }
  }
  return events;
}

// Lecture de repli d'un agenda importé, au même format de sortie que le
// flux ICS ({ start, end, summary } en dates YYYY-MM-DD).
async function fetchImportCalendar(calendarId) {
  const token = await serviceAccountToken();
  const timeMin = new Date(new Date().getFullYear() - 3, 0, 1).toISOString();
  const events = [];
  let updated = null;
  let pageToken;
  do {
    const params = new URLSearchParams({ singleEvents: 'true', maxResults: '2500', timeMin });
    if (pageToken) params.set('pageToken', pageToken);
    const res = await fetch(
      `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events?${params}`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    if (!res.ok) {
      const err = new Error(`Agenda importé inaccessible (HTTP ${res.status}).`);
      err.status = res.status;
      throw err;
    }
    const data = await res.json();
    for (const item of data.items || []) {
      if (item.status === 'cancelled') continue;
      const start = item.start?.date || item.start?.dateTime?.slice(0, 10);
      const end = item.end?.date || item.end?.dateTime?.slice(0, 10);
      if (start && end) events.push({ start, end, summary: item.summary || '' });
      if (item.updated && (!updated || item.updated > updated)) updated = item.updated;
    }
    pageToken = data.nextPageToken;
  } while (pageToken);
  return { events, updated };
}

// Réservations Airbnb d'une maison : flux ICS direct si configuré, sinon
// repli sur l'agenda importé. Réponse : { events, fetchedAt|updated, via }.
app.get('/api/ical/:house', requireFamily, async (req, res) => {
  const { house } = req.params;
  if (!AIRBNB_IMPORT_CALENDARS[house]) return res.status(404).json({ error: 'Maison inconnue.' });
  try {
    const icsUrl = AIRBNB_ICS_URLS[house];
    if (icsUrl) {
      const upstream = await fetch(icsUrl);
      if (!upstream.ok) {
        return res.status(502).json({ error: `Le flux iCal Airbnb a répondu HTTP ${upstream.status}.` });
      }
      return res.json({
        events: parseAirbnbIcs(await upstream.text()),
        fetchedAt: new Date().toISOString(),
        via: 'airbnb-ics',
      });
    }
    const { events, updated } = await fetchImportCalendar(AIRBNB_IMPORT_CALENDARS[house]);
    res.json({ events, updated, via: 'google-import' });
  } catch (err) {
    console.error(`Erreur /api/ical/${house}:`, err.message);
    res.status(err.status === 404 ? 404 : 502).json({ error: err.message || 'Lecture Airbnb impossible.' });
  }
});

// Diagnostic : vérifie l'accès du compte de service au Sheet et aux agendas,
// et la réponse des flux ICS Airbnb configurés (statuts HTTP uniquement,
// aucune donnée ni URL — les IDs figurent déjà dans le bundle client).
// 200 = OK, 403/404 = ressource pas encore partagée avec le SA ou disparue.
const DIAG_CALENDARS = {
  'agenda-google-BAS': 'a8bcfb8768d29e157ae40e2692de3b4722848f3af2e2d0e9dd55b6776b5f4d84@group.calendar.google.com',
  'agenda-google-HAUT': '1i5gq28cvbedqgvs7lkad892k0@group.calendar.google.com',
  'agenda-google-PORTIVY': 'vg7kplqnr05rkeqjrnnn03pt70@group.calendar.google.com',
  'import-BAS': AIRBNB_IMPORT_CALENDARS.BAS,
  'import-HAUT': AIRBNB_IMPORT_CALENDARS.HAUT,
  'import-PORTIVY': AIRBNB_IMPORT_CALENDARS.PORTIVY,
};

// Rôle d'accès du compte de service sur un agenda (reader/writer/owner) +
// nom réel de l'agenda : on l'ajoute à la calendarList du SA (idempotent,
// invisible pour les autres comptes) puis on lit accessRole — c'est le seul
// moyen de vérifier le niveau de partage sans tenter une écriture.
async function calendarRole(token, id) {
  const auth = { Authorization: `Bearer ${token}` };
  await fetch('https://www.googleapis.com/calendar/v3/users/me/calendarList', {
    method: 'POST',
    headers: { ...auth, 'Content-Type': 'application/json' },
    body: JSON.stringify({ id }),
  }).catch(() => {});
  const res = await fetch(`https://www.googleapis.com/calendar/v3/users/me/calendarList/${encodeURIComponent(id)}`, { headers: auth });
  if (!res.ok) return `inaccessible (HTTP ${res.status})`;
  const d = await res.json();
  return `${d.accessRole} — « ${d.summary || '?'} »`;
}

app.get('/api/diag', async (_req, res) => {
  try {
    const token = await serviceAccountToken();
    const { client_email } = await googleAuth.getCredentials().catch(() => ({}));
    const probe = async (url) => (await fetch(url, { headers: { Authorization: `Bearer ${token}` } })).status;

    const checks = { sheet: await probe(`https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}/values/${encodeURIComponent('HAUT!A1')}`) };
    for (const [name, id] of Object.entries(DIAG_CALENDARS)) {
      checks[name] = await probe(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(id)}/events?maxResults=1`);
      // Le niveau de partage n'a de sens que pour les agendas maisons (writer
      // attendu pour « Bloquer sur Airbnb ») — pas pour les imports Airbnb.
      if (name.startsWith('agenda-google-')) {
        checks[`role-${name.replace('agenda-google-', '')}`] = await calendarRole(token, id);
      }
    }
    for (const [house, url] of Object.entries(AIRBNB_ICS_URLS)) {
      checks[`ics-${house}`] = url ? (await fetch(url)).status : 'non configuré (repli import Google)';
    }
    res.json({ serviceAccount: client_email || null, checks });
  } catch (err) {
    console.error('Erreur diag:', err);
    res.status(500).json({ error: String(err?.message || err) });
  }
});

app.use('/api', (_req, res) => res.status(404).json({ error: 'Route API inconnue.' }));

app.use(express.static(dist, { maxAge: '1h', setHeaders: (res, filePath) => {
  // Les assets Vite sont hashés : cache long. index.html/sw.js : pas de cache.
  if (/assets\//.test(filePath)) res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
  if (/index\.html$|sw\.js$/.test(filePath)) res.setHeader('Cache-Control', 'no-cache');
} }));

app.get('*', (_req, res) => res.sendFile(path.join(dist, 'index.html')));

const port = process.env.PORT || 8080;
app.listen(port, () => console.log(`Gestion Location en écoute sur :${port}`));
