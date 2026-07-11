/**
 * Airbnb → Google Sheet — Location Milliot
 * ------------------------------------------------------------------
 * À installer sur le compte Gmail qui reçoit les emails Airbnb
 * (matthieu.milliot@gmail.com) via https://script.google.com :
 *   1. Coller ce fichier dans le projet → 💾 Enregistrer.
 *   2. Sélectionner « testerSurDerniersEmails » → Exécuter → autoriser.
 *      Le journal montre ce qui SERAIT écrit, SANS rien modifier.
 *   3. Quand le test est bon : exécuter « installer » UNE FOIS
 *      (déclencheur toutes les 15 min + libellé Gmail).
 *
 * Cale sur l'email Airbnb « Réservation confirmée : <voyageur> arrive le … ».
 * Convention tableau : colonne « fin » = jour du départ (comme Airbnb).
 */

const CONFIG = {
  SHEET_ID: '1VVVMkx9Woqxvfs8u7IWWfWwxz_kJ7h4OD9s5oC4u2ts',

  // Mots-clés (minuscules) présents dans le CORPS de l'email (titre de
  // l'annonce Airbnb) → onglet du Sheet. NB : l'annonce Portivy s'intitule
  // « HOUSE IN PORTVY » (sans « i »). Ajouter ici le titre exact des chalets
  // si le test affiche « maison introuvable ».
  LISTINGS: [
    { motsCles: ['chalet haut', 'haut', 'upper'], onglet: 'HAUT' },
    { motsCles: ['chalet bas', 'bas', 'lower'], onglet: 'BAS' },
    { motsCles: ['portivy', 'portvy', 'quiberon', 'saint-pierre'], onglet: 'PORTIVY' },
  ],

  LIBELLE: 'LocationMilliot/traité',
  RECHERCHE_GMAIL: 'from:(airbnb.com) subject:("Réservation confirmée" OR "Reservation confirmed") newer_than:60d',
};

// ─────────────────────────────────────────────────────────── installation ──

function installer() {
  GmailApp.createLabel(CONFIG.LIBELLE);
  ScriptApp.getProjectTriggers().forEach(t => {
    if (t.getHandlerFunction() === 'traiterEmailsAirbnb') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('traiterEmailsAirbnb').timeBased().everyMinutes(15).create();
  Logger.log('Installé : déclencheur toutes les 15 min + libellé "%s".', CONFIG.LIBELLE);
}

function desinstaller() {
  ScriptApp.getProjectTriggers().forEach(t => {
    if (t.getHandlerFunction() === 'traiterEmailsAirbnb') ScriptApp.deleteTrigger(t);
  });
  Logger.log('Déclencheur automatique supprimé.');
}

// ────────────────────────────────────────────────────────────── exécution ──

function traiterEmailsAirbnb() { ensureTrigger_(); executer_(false); }

// Crée le déclencheur 15 min + le libellé s'ils n'existent pas encore
// (idempotent : appelé à chaque passage, ne duplique rien).
function ensureTrigger_() {
  const existe = ScriptApp.getProjectTriggers().some(t => t.getHandlerFunction() === 'traiterEmailsAirbnb');
  if (!existe) ScriptApp.newTrigger('traiterEmailsAirbnb').timeBased().everyMinutes(15).create();
  if (!GmailApp.getUserLabelByName(CONFIG.LIBELLE)) GmailApp.createLabel(CONFIG.LIBELLE);
}
function testerSurDerniersEmails() { executer_(true); }

function executer_(dryRun) {
  const label = GmailApp.getUserLabelByName(CONFIG.LIBELLE) || GmailApp.createLabel(CONFIG.LIBELLE);
  const threads = GmailApp.search(CONFIG.RECHERCHE_GMAIL);
  let traites = 0;

  threads.forEach(thread => {
    let poseLabel = false;
    thread.getMessages().forEach(msg => {
      const sujet = msg.getSubject() || '';
      if (!/réservation confirmée|reservation confirmed/i.test(sujet)) return;
      poseLabel = true;

      const infos = extraireInfos_(sujet, msg.getPlainBody() || '');
      Logger.log('Email "%s" → %s', sujet, JSON.stringify(ligneAEcrire_(infos)));

      if (!infos.onglet) { Logger.log('  ⚠ Maison introuvable — ajouter le mot-clé du titre de l\'annonce dans CONFIG.LISTINGS.'); poseLabel = false; return; }
      if (!infos.arrivee || !infos.depart) { Logger.log('  ⚠ Dates non reconnues — envoyer ce journal pour ajuster.'); poseLabel = false; return; }

      if (dryRun) { Logger.log('  [TEST] rien écrit.'); return; }
      if (ecrireDansSheet_(infos)) traites++;
    });

    if (!dryRun && poseLabel) thread.addLabel(label);
  });

  Logger.log(dryRun ? '— Test terminé (aucune écriture) —' : '%s réservation(s) ajoutée(s).', traites);
}

// ─────────────────────────────────────────────────────────────── parsing ──

const MOIS_FR = { janv:0, jan:0, 'févr':1, 'fév':1, fev:1, mars:2, mar:2, avr:3, mai:4, juin:5, juil:6, jui:6, 'août':7, aou:7, sept:8, sep:8, oct:9, nov:10, 'déc':11, dec:11 };

function extraireInfos_(sujet, corps) {
  const texte = sujet + '\n' + corps;
  const bas = texte.toLowerCase();

  // Maison (mot-clé du titre de l'annonce dans le corps)
  let onglet = null;
  for (const l of CONFIG.LISTINGS) {
    if (l.motsCles.some(m => bas.indexOf(m) !== -1)) { onglet = l.onglet; break; }
  }

  // Voyageur : « Réservation confirmée : Joe Maurer arrive le … »
  let nom = null;
  let m = sujet.match(/confirm[ée]e?\s*[:\-–]\s*(.+?)\s+arrive/i);
  if (m) nom = m[1].trim();

  // Code de confirmation (HM + 8)
  const code = (texte.match(/\bHM[A-Z0-9]{8}\b/) || [null])[0];

  // Nombre de nuits
  m = corps.match(/(\d+)\s+nuits?/i);
  const nuits = m ? parseInt(m[1], 10) : null;

  // Arrivée : sujet « arrive le 20 juil. » sinon corps près de « Arrivée »
  let arrivee = chercherDateApres_(sujet, /arrive\s+le/i) || chercherDateApres_(corps, /arriv[ée]e/i);

  // Départ : arrivée + nuits (convention = jour du départ) ; sinon 2e date
  let depart = null;
  if (arrivee && nuits) { depart = new Date(arrivee); depart.setDate(depart.getDate() + nuits); }
  if (!depart) depart = chercherDateApres_(corps, /d[ée]part/i);

  // Effectif : « Voyageurs : 2 adultes, 2 enfants » (bébés comptés en enfants).
  // NB : ne pas confondre avec la capacité du titre (« FOR 6 PEOPLE »).
  let a = corps.match(/(\d+)\s+adultes?/i);
  let e = corps.match(/(\d+)\s+enfants?/i);
  let b = corps.match(/(\d+)\s+b[ée]b[ée]s?/i);
  const nbAdultes = a ? parseInt(a[1], 10) : null;
  const nbEnfants = (e || b) ? (parseInt(e && e[1] || 0, 10) + parseInt(b && b[1] || 0, 10)) : null;

  // Montant net reçu par l'hôte : « VOUS GAGNEZ 1 325,50 € ». Airbnb utilise
  // une espace insécable fine (U+202F/U+00A0) comme séparateur de milliers.
  let montant = null;
  const gi = corps.toLowerCase().indexOf('vous gagnez');
  const seg = gi !== -1 ? corps.substring(gi, gi + 60)
                        : (corps.match(/versement[\s\S]{0,60}/i) || [''])[0];
  const mm = seg.match(/([0-9][0-9.,\s  ]*)\s*€/);
  if (mm) {
    const val = parseFloat(mm[1].replace(/[\s  ]/g, '').replace(',', '.'));
    if (!isNaN(val)) montant = val;
  }

  return { onglet, nom, code, arrivee, depart, nuits, nbAdultes, nbEnfants, montant };
}

// Cherche une date juste après un mot-clé. Gère « 20/07/2026 » et
// « 20 juil. » / « 20 juillet 2026 » (année déduite si absente).
function chercherDateApres_(texte, motCle) {
  const idx = texte.search(motCle);
  if (idx === -1) return null;
  const zone = texte.substring(idx, idx + 90);

  let m = zone.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (m) return new Date(parseInt(m[3]), parseInt(m[2]) - 1, parseInt(m[1]));

  m = zone.match(/(\d{1,2})\s+([a-zûéôàА-я]+)\.?\s*(\d{4})?/i);
  if (m) {
    const cle = Object.keys(MOIS_FR).find(k => m[2].toLowerCase().indexOf(k) === 0);
    if (cle !== undefined) {
      const mois = MOIS_FR[cle];
      let annee = m[3] ? parseInt(m[3], 10) : new Date().getFullYear();
      let d = new Date(annee, mois, parseInt(m[1], 10));
      if (!m[3] && d.getTime() < Date.now() - 30 * 864e5) d = new Date(annee + 1, mois, parseInt(m[1], 10));
      return d;
    }
  }
  return null;
}

// ─────────────────────────────────────────────────────────────── écriture ──

function formatFr_(d) { return Utilities.formatDate(d, 'Europe/Paris', 'dd/MM/yyyy'); }

function ligneAEcrire_(infos) {
  return {
    maison: infos.onglet,
    debut: infos.arrivee ? formatFr_(infos.arrivee) : '?',
    fin: infos.depart ? formatFr_(infos.depart) : '?',
    nom: (infos.nom || 'Voyageur Airbnb') + (infos.code ? ' (' + infos.code + ')' : ''),
    source: 'Airbnb',
    montant: infos.montant,
    adultes: infos.nbAdultes,
    enfants: infos.nbEnfants,
  };
}

function ecrireDansSheet_(infos) {
  const feuille = SpreadsheetApp.openById(CONFIG.SHEET_ID).getSheetByName(infos.onglet);
  if (!feuille) throw new Error('Onglet introuvable : ' + infos.onglet);

  const entetes = feuille.getRange(1, 1, 1, feuille.getLastColumn()).getValues()[0].map(String);
  const idx = (re) => entetes.findIndex(h => re.test(h));
  const iDebut = idx(/^(?!.*(paiement|solde)).*(début|debut|arrivée|arrivee|start|date)/i);
  const iFin = idx(/^(?!.*(paiement|solde)).*(fin|départ|depart|end)/i);
  const iNom = idx(/^(?!.*(nombre|nb |tel|tél|mail|adresse)).*(nom|locataire|client|name)/i);
  const iSource = idx(/source|plateforme|origine/i);
  const iMontant = idx(/^(?!.*(caution|acompte|garantie|paiement)).*(prix|loyer|total|montant|tarif)/i);
  const iAdultes = idx(/adulte/i);
  const iEnfants = idx(/enfant/i);

  const l = ligneAEcrire_(infos);

  // Anti-doublon : si le code est déjà là, on ne recrée pas la ligne mais on
  // COMPLÈTE les cellules encore vides (utile pour enrichir a posteriori).
  if (infos.code) {
    const donnees = feuille.getDataRange().getValues();
    for (let r = 1; r < donnees.length; r++) {
      if (donnees[r].join(' ').indexOf(infos.code) !== -1) {
        const maj = [];
        const compléter = (ci, val) => {
          if (ci !== -1 && val != null && val !== '' && !String(donnees[r][ci]).trim()) {
            feuille.getRange(r + 1, ci + 1).setValue(val); maj.push(entetes[ci]);
          }
        };
        compléter(iMontant, l.montant);
        compléter(iAdultes, l.adultes);
        compléter(iEnfants, l.enfants);
        Logger.log(maj.length ? '  ↻ Déjà présent (%s) — complété : %s' : '  Déjà présent (%s) — rien à compléter.', infos.code, maj.join(', '));
        return false;
      }
    }
  }

  const ligne = new Array(entetes.length).fill('');
  if (iDebut !== -1) ligne[iDebut] = l.debut;
  if (iFin !== -1) ligne[iFin] = l.fin;
  if (iNom !== -1) ligne[iNom] = l.nom;
  if (iSource !== -1) ligne[iSource] = l.source;
  if (iMontant !== -1 && l.montant != null) ligne[iMontant] = l.montant;
  if (iAdultes !== -1 && l.adultes != null) ligne[iAdultes] = l.adultes;
  if (iEnfants !== -1 && l.enfants != null) ligne[iEnfants] = l.enfants;

  feuille.appendRow(ligne);
  Logger.log('  ✓ Ajouté dans %s.', infos.onglet);
  return true;
}

// ─────────────────────────────────────────────────────────── diagnostic ──

function dumpDernierEmailResa() {
  const th = GmailApp.search('from:(airbnb.com) newer_than:2d', 0, 5);
  if (!th.length) { Logger.log('Aucun email.'); return; }
  const m = th[0].getMessages()[0];
  Logger.log('SUJET: ' + m.getSubject());
  Logger.log(m.getPlainBody().substring(0, 4000));
}
