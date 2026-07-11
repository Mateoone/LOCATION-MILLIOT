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

// Diagnostic : vérifie l'accès du compte de service au Sheet et aux agendas
// (statuts HTTP uniquement, aucune donnée — les IDs figurent déjà dans le
// bundle client). 200 = OK, 403/404 = ressource pas encore partagée avec le SA.
const DIAG_CALENDARS = {
  'agenda-google-BAS': 'a8bcfb8768d29e157ae40e2692de3b4722848f3af2e2d0e9dd55b6776b5f4d84@group.calendar.google.com',
  'agenda-google-HAUT': '1i5gq28cvbedqgvs7lkad892k0@group.calendar.google.com',
  'agenda-google-PORTIVY': 'vg7kplqnr05rkeqjrnnn03pt70@group.calendar.google.com',
  'airbnb-BAS': '0cs87obk61n9r61dv7cif9n9163vi6ab@import.calendar.google.com',
  'airbnb-HAUT': 'cvv6kpeb5pmlqni3jmrljmavsdn5deso@import.calendar.google.com',
  'airbnb-PORTIVY': '2nlubhr2o5ps3n3ok5inntfnmo7gf5b7@import.calendar.google.com',
};

app.get('/api/diag', async (_req, res) => {
  try {
    const token = await serviceAccountToken();
    const { client_email } = await googleAuth.getCredentials().catch(() => ({}));
    const probe = async (url) => (await fetch(url, { headers: { Authorization: `Bearer ${token}` } })).status;

    const checks = { sheet: await probe(`https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}/values/${encodeURIComponent('HAUT!A1')}`) };
    for (const [name, id] of Object.entries(DIAG_CALENDARS)) {
      checks[name] = await probe(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(id)}/events?maxResults=1`);
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
