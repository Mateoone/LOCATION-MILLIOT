// Serveur de production Cloud Run : sert le build Vite (dist/) avec repli SPA.
// Déploiement : npm run deploy (cf. package.json) — ne pas passer par AI Studio.
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dist = path.join(__dirname, 'dist');
const app = express();

app.use(express.static(dist, { maxAge: '1h', setHeaders: (res, filePath) => {
  // Les assets Vite sont hashés : cache long. index.html/sw.js : pas de cache.
  if (/assets\//.test(filePath)) res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
  if (/index\.html$|sw\.js$/.test(filePath)) res.setHeader('Cache-Control', 'no-cache');
} }));

app.get('*', (_req, res) => res.sendFile(path.join(dist, 'index.html')));

const port = process.env.PORT || 8080;
app.listen(port, () => console.log(`Gestion Location en écoute sur :${port}`));
