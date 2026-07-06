/**
 * Airbnb → Google Sheet — Location Milliot
 * ------------------------------------------------------------------
 * À installer sur le compte Gmail qui reçoit les emails Airbnb
 * (matthieu.milliot@gmail.com) via https://script.google.com :
 *   1. Nouveau projet → coller ce fichier → 💾 Enregistrer.
 *   2. Menu déroulant des fonctions → « testerSurDerniersEmails » → Exécuter
 *      → autoriser le script (Gmail lecture + Sheets écriture)
 *      → regarder le journal (Ctrl+Entrée) : il montre ce qui SERAIT écrit,
 *        sans rien modifier. Ajuster CONFIG si besoin.
 *   3. Quand le test est bon : exécuter « installer » UNE FOIS.
 *      → crée le déclencheur (toutes les 15 min) et le libellé Gmail.
 *
 * Fonctionnement : à chaque passage, cherche les emails Airbnb
 * « Réservation confirmée » non encore traités, en extrait voyageur,
 * dates, montant, nombre de voyageurs et code de confirmation, ajoute la
 * ligne dans l'onglet de la bonne maison, puis pose le libellé
 * « LocationMilliot/traité » sur l'email (= ne sera jamais retraité).
 * Convention : colonne « fin » = jour du départ (comme Airbnb).
 */

const CONFIG = {
  SHEET_ID: '1VVVMkx9Woqxvfs8u7IWWfWwxz_kJ7h4OD9s5oC4u2ts',

  // Mots-clés (minuscules) trouvés dans le titre de l'annonce ou le corps de
  // l'email → onglet du Sheet. À AJUSTER avec les vrais titres des annonces
  // si le journal de test montre « maison introuvable ».
  LISTINGS: [
    { motsCles: ['chalet haut', 'haut'], onglet: 'HAUT' },
    { motsCles: ['chalet bas', 'bas'], onglet: 'BAS' },
    { motsCles: ['portivy', 'quiberon', 'saint-pierre'], onglet: 'PORTIVY' },
  ],

  LIBELLE: 'LocationMilliot/traité',
  RECHERCHE_GMAIL: 'from:(airbnb.com) subject:("Réservation confirmée" OR "Reservation confirmed") newer_than:30d',
};

// ─────────────────────────────────────────────────────────── installation ──

function installer() {
  // Libellé Gmail
  GmailApp.createLabel(CONFIG.LIBELLE);
  // Un seul déclencheur : purge les anciens puis recrée
  ScriptApp.getProjectTriggers().forEach(t => {
    if (t.getHandlerFunction() === 'traiterEmailsAirbnb') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('traiterEmailsAirbnb').timeBased().everyMinutes(15).create();
  Logger.log('Installé : déclencheur toutes les 15 min + libellé "%s".', CONFIG.LIBELLE);
}

// ────────────────────────────────────────────────────────────── exécution ──

function traiterEmailsAirbnb() {
  executer_(false);
}

function testerSurDerniersEmails() {
  executer_(true);
}

function executer_(dryRun) {
  const label = GmailApp.getUserLabelByName(CONFIG.LIBELLE) || GmailApp.createLabel(CONFIG.LIBELLE);
  const threads = GmailApp.search(CONFIG.RECHERCHE_GMAIL + ' -label:' + CONFIG.LIBELLE.replace('/', '-'));
  // NB : la recherche par -label utilise le nom avec tiret si Gmail l'affiche ainsi ;
  // par sécurité on re-filtre ci-dessous sur les libellés réels du fil.
  let traites = 0;

  threads.forEach(thread => {
    if (thread.getLabels().some(l => l.getName() === CONFIG.LIBELLE)) return;

    thread.getMessages().forEach(msg => {
      const sujet = msg.getSubject() || '';
      if (!/réservation confirmée|reservation confirmed/i.test(sujet)) return;

      const infos = extraireInfos_(sujet, msg.getPlainBody() || '');
      Logger.log('Email "%s" → %s', sujet, JSON.stringify(infos));

      if (!infos.onglet) {
        Logger.log('⚠ Maison introuvable — ajoutez les mots-clés du titre de l\'annonce dans CONFIG.LISTINGS. Email laissé non traité.');
        return;
      }
      if (!infos.arrivee || !infos.depart) {
        Logger.log('⚠ Dates non reconnues — email laissé non traité (envoyez ce journal pour ajuster le parseur).');
        return;
      }

      if (dryRun) {
        Logger.log('[TEST] Ligne qui serait ajoutée dans %s : %s', infos.onglet, JSON.stringify(ligneAEcrire_(infos)));
        return;
      }

      ecrireDansSheet_(infos);
      traites++;
    });

    if (!dryRun) thread.addLabel(label);
  });

  Logger.log(dryRun ? 'Test terminé (aucune écriture).' : '%s réservation(s) ajoutée(s).', traites);
}

// ─────────────────────────────────────────────────────────────── parsing ──

function extraireInfos_(sujet, corps) {
  const texte = sujet + '\n' + corps;
  const bas = texte.toLowerCase();

  // Maison
  let onglet = null;
  for (const l of CONFIG.LISTINGS) {
    if (l.motsCles.some(m => bas.indexOf(m) !== -1)) { onglet = l.onglet; break; }
  }

  // Voyageur : « Réservation confirmée : Jean Dupont arrive le … » (ou variante ‑ / pour)
  let nom = null;
  let m = sujet.match(/confirm[ée]e?\s*[:\-–]?\s*(.+?)\s+(?:arrive|arrives)/i);
  if (m) nom = m[1].trim();
  if (!nom) {
    m = corps.match(/^(.+?)\s+arrive\s+le/im);
    if (m) nom = m[1].trim();
  }

  // Code de confirmation (HMXXXXXXXX)
  const code = (texte.match(/\bHM[A-Z0-9]{8}\b/) || [null])[0];

  // Dates « Arrivée … / Départ … » (formats : jeu. 19 déc. 2026 / 19 décembre 2026 / 19/12/2026)
  const arrivee = chercherDate_(corps, /arriv[ée]e/i);
  const depart = chercherDate_(corps, /d[ée]part/i);

  // Nombre de voyageurs
  m = corps.match(/(\d+)\s+voyageurs?/i) || corps.match(/(\d+)\s+adultes?/i);
  const voyageurs = m ? parseInt(m[1], 10) : null;

  // Montant du versement hôte (dernier montant en € après « versement » ou « vous gagnez »)
  let montant = null;
  m = corps.match(/(?:versement|vous gagnez|revenus de l'h[ôo]te|total\s*\(EUR\))[^\d€]*([\d\s .,]+)\s*€/i);
  if (!m) m = corps.match(/([\d\s .,]+)\s*€\s*(?:au total)?\s*$/im);
  if (m) {
    const brut = m[1].replace(/[\s ]/g, '').replace(',', '.');
    const val = parseFloat(brut);
    if (!isNaN(val)) montant = val;
  }

  return { onglet, nom, code, arrivee, depart, voyageurs, montant };
}

const MOIS_FR = { 'janv': 0, 'jan': 0, 'févr': 1, 'fév': 1, 'fev': 1, 'mars': 2, 'mar': 2, 'avr': 3, 'mai': 4, 'juin': 5, 'juil': 6, 'jui': 6, 'août': 7, 'aou': 7, 'sept': 8, 'sep': 8, 'oct': 9, 'nov': 10, 'déc': 11, 'dec': 11 };

// Cherche une date dans les ~2 lignes qui suivent un mot-clé (Arrivée/Départ).
function chercherDate_(corps, motCle) {
  const idx = corps.search(motCle);
  if (idx === -1) return null;
  const zone = corps.substring(idx, idx + 160);

  // 19/12/2026
  let m = zone.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (m) return new Date(parseInt(m[3]), parseInt(m[2]) - 1, parseInt(m[1]));

  // 19 déc. 2026 | 19 décembre 2026 | jeu. 19 déc. (année absente → déduite)
  m = zone.match(/(\d{1,2})(?:er)?\s+([a-zéûôà]+)\.?\s*(\d{4})?/i);
  if (m) {
    const cle = Object.keys(MOIS_FR).find(k => m[2].toLowerCase().indexOf(k) === 0);
    if (cle !== undefined) {
      const mois = MOIS_FR[cle];
      let annee = m[3] ? parseInt(m[3], 10) : new Date().getFullYear();
      let d = new Date(annee, mois, parseInt(m[1], 10));
      // Année absente et date passée de plus de 30 j → c'est l'année prochaine
      if (!m[3] && d.getTime() < Date.now() - 30 * 864e5) d = new Date(annee + 1, mois, parseInt(m[1], 10));
      return d;
    }
  }
  return null;
}

// ─────────────────────────────────────────────────────────────── écriture ──

function formatFr_(d) {
  return Utilities.formatDate(d, 'Europe/Paris', 'dd/MM/yyyy');
}

function ligneAEcrire_(infos) {
  return {
    debut: formatFr_(infos.arrivee),
    fin: formatFr_(infos.depart), // jour du départ, comme Airbnb
    nom: (infos.nom || 'Voyageur Airbnb') + (infos.code ? ' (' + infos.code + ')' : ''),
    source: 'Airbnb',
    montant: infos.montant,
    voyageurs: infos.voyageurs,
  };
}

function ecrireDansSheet_(infos) {
  const feuille = SpreadsheetApp.openById(CONFIG.SHEET_ID).getSheetByName(infos.onglet);
  if (!feuille) throw new Error('Onglet introuvable : ' + infos.onglet);

  const entetes = feuille.getRange(1, 1, 1, feuille.getLastColumn()).getValues()[0].map(String);
  const idx = (re) => entetes.findIndex(h => re.test(h));
  const iDebut = idx(/début|debut|arrivée|arrivee|start|date/i);
  const iFin = idx(/fin|départ|depart|end/i);
  const iNom = idx(/nom|locataire|client|name/i);
  const iSource = idx(/source|plateforme|origine/i);
  const iMontant = idx(/prix|loyer|total|montant|tarif/i);
  const iVoyageurs = idx(/voyageur|personne|pax|adulte/i);

  // Anti-doublon : code de confirmation déjà présent quelque part dans l'onglet
  if (infos.code) {
    const tout = feuille.getDataRange().getDisplayValues().flat().join(' ');
    if (tout.indexOf(infos.code) !== -1) {
      Logger.log('Déjà présent (%s) — ignoré.', infos.code);
      return;
    }
  }

  const ligne = new Array(entetes.length).fill('');
  const l = ligneAEcrire_(infos);
  if (iDebut !== -1) ligne[iDebut] = l.debut;
  if (iFin !== -1) ligne[iFin] = l.fin;
  if (iNom !== -1) ligne[iNom] = l.nom;
  if (iSource !== -1) ligne[iSource] = l.source;
  if (iMontant !== -1 && l.montant != null) ligne[iMontant] = l.montant;
  if (iVoyageurs !== -1 && l.voyageurs != null) ligne[iVoyageurs] = l.voyageurs;

  feuille.appendRow(ligne);
  Logger.log('Ajouté dans %s : %s', infos.onglet, JSON.stringify(l));
}

// ═══════════════════════════════════════════════════ OUTILS DE DIAGNOSTIC ══
// (à exécuter à la main pendant la mise au point ; aucun impact sur le Sheet)

// Désactive le déclencheur automatique (tant que le parsing n'est pas validé).
function desinstaller() {
  ScriptApp.getProjectTriggers().forEach(t => {
    if (t.getHandlerFunction() === 'traiterEmailsAirbnb') ScriptApp.deleteTrigger(t);
  });
  Logger.log('Déclencheur automatique supprimé.');
}

// Liste TOUS les emails reçus d'Airbnb sur 1 an (expéditeur + sujet + date),
// pour voir quels types d'emails existent réellement (confirmation ou non).
function explorerBoiteAirbnb() {
  const threads = GmailApp.search('from:(airbnb.com OR @airbnb.fr) newer_than:1y', 0, 60);
  Logger.log('%s fils Airbnb trouvés (1 an) :', threads.length);
  const vus = {};
  threads.forEach(th => {
    th.getMessages().forEach(m => {
      const s = m.getSubject() || '(sans sujet)';
      const cle = s.replace(/[A-ZÉ][a-zéèê]+ [A-Z]/g, 'PRENOM').substring(0, 60);
      vus[cle] = (vus[cle] || 0) + 1;
      Logger.log('  %s | de:%s | %s', Utilities.formatDate(m.getDate(), 'Europe/Paris', 'yyyy-MM-dd'), m.getFrom().replace(/.*<|>.*/g, ''), s);
    });
  });
  Logger.log('---\nTypes de sujets (regroupés) :');
  Object.keys(vus).sort((a, b) => vus[b] - vus[a]).forEach(k => Logger.log('  [%s×] %s', vus[k], k));
}

// Affiche le corps COMPLET du dernier email Airbnb ressemblant à une
// confirmation de réservation → permet de vérifier/ajuster le parsing.
function dumpDernierEmailResa() {
  const requetes = [
    'from:(airbnb.com) subject:("Réservation confirmée" OR "Reservation confirmed") newer_than:1y',
    'from:(airbnb.com) subject:(confirmée OR confirmed OR réservation OR reservation OR booking) newer_than:1y',
    'from:(airbnb.com) newer_than:1y',
  ];
  for (const q of requetes) {
    const th = GmailApp.search(q, 0, 5);
    if (th.length) {
      const m = th[0].getMessages()[0];
      Logger.log('=== Requête gagnante : %s', q);
      Logger.log('SUJET : %s', m.getSubject());
      Logger.log('DE : %s', m.getFrom());
      Logger.log('DATE : %s', m.getDate());
      Logger.log('--- CORPS (texte brut, 3000 premiers car.) ---');
      Logger.log(m.getPlainBody().substring(0, 3000));
      Logger.log('--- PARSING ACTUEL ---');
      Logger.log(JSON.stringify(extraireInfos_(m.getSubject(), m.getPlainBody())));
      return;
    }
  }
  Logger.log('Aucun email Airbnb trouvé sur 1 an.');
}
