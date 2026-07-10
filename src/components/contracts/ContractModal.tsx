import React, { useState, useEffect } from 'react';
import { X, Download, FileText } from 'lucide-react';
import { ReservationRow } from '../../lib/sheets';
import { PDFDownloadLink } from '@react-pdf/renderer';
import { PortivyContractPdf, ContractData } from './PortivyContractPdf';
import { ChaletBasContractPdf } from './ChaletBasContractPdf';
import { ChaletHautContractPdf } from './ChaletHautContractPdf';
import { format, parse, addDays, isValid } from 'date-fns';
import { fr } from 'date-fns/locale';

interface ContractModalProps {
  isOpen: boolean;
  onClose: () => void;
  reservation: ReservationRow | null;
  location: string;
}

export const ContractModal: React.FC<ContractModalProps> = ({ isOpen, onClose, reservation, location }) => {
  const [fileDates, setFileDates] = useState({ start: 'Debut', end: 'Fin' });

  const [formData, setFormData] = useState<ContractData>({
    locataireNom: '',
    locataireAdresse: '',
    locataireTel: '',
    locataireEmail: '',
    dateDebut: '',
    dateFin: '',
    loyerMontant: 0,
    montantTotal: 0,
    menageMontant: 30, // Default for Portivy
    acompteMontant: 900,
    datePaiement: format(addDays(new Date(), 7), 'yyyy-MM-dd'),
    cautionMontant: 1000,
    nbAdultes: '2',
    nbEnfants: '0',
    dateSignature: format(new Date(), 'yyyy-MM-dd'),
    lieuSignature: 'Paris'
  });

  useEffect(() => {
    if (reservation) {
      const keys = Object.keys(reservation);
      const nameKey = keys.find(k => /nom|locataire|client|name|voyageur/i.test(k) && !/nombre|nb |tél|tel|phone|email|mail|adresse/i.test(k));
      const phoneKey = keys.find(k => /tél|tel|phone/i.test(k));
      const emailKey = keys.find(k => /mail/i.test(k));
      const addressKey = keys.find(k => /adresse|postal/i.test(k));
      const checkInKey = keys.find(k => /début|debut|check-in|checkin|arrivée|arrivee/i.test(k) && !/paiement|solde/i.test(k));
      const checkOutKey = keys.find(k => /fin|check-out|checkout|départ|depart/i.test(k) && !/paiement|solde/i.test(k));
      const amountKey = keys.find(k => /montant|prix|total|loyer/i.test(k) && !/caution|acompte|garantie|paiement/i.test(k));
      const adultKey = keys.find(k => /adulte/i.test(k));
      const childKey = keys.find(k => /enfant/i.test(k));

      const checkInRaw = (checkInKey ? reservation[checkInKey] : '') || '';
      const checkOutRaw = (checkOutKey ? reservation[checkOutKey] : '') || '';
      
      let formattedDebut = checkInRaw;
      let formattedFin = checkOutRaw;
      let fileStart = 'Debut';
      let fileEnd = 'Fin';

      // Basic localizing attempts if it's a parseable date. Assuming dd/MM/yyyy
      let checkInDate: Date | null = null;
      try {
        if (checkInRaw.includes('/')) {
          const parsed = parse(checkInRaw, 'dd/MM/yyyy', new Date());
          if (isValid(parsed)) {
            checkInDate = parsed;
            formattedDebut = `le ${format(parsed, 'EEEE dd MMMM yyyy', { locale: fr })} à partir de 16h`;
            fileStart = format(parsed, 'dd-MM-yyyy');
          }
        }
        if (checkOutRaw.includes('/')) {
          const parsed = parse(checkOutRaw, 'dd/MM/yyyy', new Date());
          if (isValid(parsed)) {
            formattedFin = `le ${format(parsed, 'EEEE dd MMMM yyyy', { locale: fr })} avant 10h`;
            fileEnd = format(parsed, 'dd-MM-yyyy');
          }
        }
      } catch (e) {
        // ignore format errors if not well formed
      }

      // Solde à régler 10 jours avant le début de la location (sans remonter
      // dans le passé pour les réservations de dernière minute).
      let paiementDefaut = addDays(new Date(), 7);
      if (checkInDate) {
        const dixJoursAvant = addDays(checkInDate, -10);
        paiementDefaut = dixJoursAvant > new Date() ? dixJoursAvant : new Date();
      }

      setFileDates({ start: fileStart, end: fileEnd });

      const totalRaw = amountKey ? reservation[amountKey] : '0';
      const totalNum = parseFloat((totalRaw || '0').toString().replace(/[^\d.,-]/g, '').replace(',', '.'));
      
      let menage = 30; // PORTIVY
      if (location === 'HAUT') menage = 50;
      if (location === 'BAS') menage = 0; // offered
      
      setFormData(prev => ({
        ...prev,
        locataireNom: (nameKey ? reservation[nameKey] : '') || '',
        locataireAdresse: (addressKey ? reservation[addressKey] : '') || '',
        locataireTel: (phoneKey ? reservation[phoneKey] : '') || '',
        locataireEmail: (emailKey ? reservation[emailKey] : '') || '',
        dateDebut: formattedDebut,
        dateFin: formattedFin,
        montantTotal: totalNum || 0,
        loyerMontant: (totalNum || 0) > menage && location !== 'BAS' ? (totalNum || 0) - menage : totalNum || 0,
        menageMontant: menage,
        acompteMontant: 900,
        nbAdultes: (adultKey ? reservation[adultKey] : '') || prev.nbAdultes,
        nbEnfants: (childKey ? reservation[childKey] : '') || prev.nbEnfants,
        datePaiement: format(paiementDefaut, 'yyyy-MM-dd'),
        dateSignature: format(new Date(), 'yyyy-MM-dd'),
      }));
    }
  }, [reservation]);

  if (!isOpen || !reservation) return null;

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: name.includes('Montant') ? Number(value) || 0 : value }));
  };

  const safeNom = (formData.locataireNom || 'Inconnu').replace(/\s+/g, '_');
  const pdfFileName = `Contrat_${safeNom}_${fileDates.start}_au_${fileDates.end}.pdf`;

  // Format dates for PDF rendering
  const formattedPdfData = {
    ...formData,
    datePaiement: (() => {
      try {
        if (!formData.datePaiement) return '';
        const parsed = parse(formData.datePaiement, 'yyyy-MM-dd', new Date());
        return isValid(parsed) ? format(parsed, 'dd MMMM yyyy', { locale: fr }) : formData.datePaiement;
      } catch (e) {
        return formData.datePaiement;
      }
    })(),
    dateSignature: (() => {
      try {
        if (!formData.dateSignature) return '';
        const parsed = parse(formData.dateSignature, 'yyyy-MM-dd', new Date());
        return isValid(parsed) ? format(parsed, 'dd/MM/yyyy') : formData.dateSignature;
      } catch (e) {
        return formData.dateSignature;
      }
    })(),
  };

  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-50 p-4 animate-in fade-in duration-200">
      <div className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-3xl overflow-hidden flex flex-col max-h-[90vh] shadow-2xl">
        
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-slate-800 bg-slate-900/50">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-indigo-500/10 text-indigo-400 rounded-lg border border-indigo-500/20">
              <FileText className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-slate-200">
                Générer Contrat de Location {formData.locataireNom ? `- ${formData.locataireNom}` : ''}
              </h2>
              <p className="text-xs text-slate-500">Maison {location}</p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 text-slate-400 hover:text-white hover:bg-slate-800 rounded-lg transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6 text-sm text-slate-300">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            
            <div className="space-y-4">
              <h3 className="font-semibold text-white border-b border-slate-800 pb-2">Informations Locataire</h3>
              <div>
                <label className="block text-xs font-medium text-slate-500 mb-1">Nom Complet</label>
                <input type="text" name="locataireNom" value={formData.locataireNom} onChange={handleChange} className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-slate-200 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none" />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-500 mb-1">Adresse Postale</label>
                <textarea name="locataireAdresse" value={formData.locataireAdresse} onChange={handleChange} rows={2} className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-slate-200 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none" placeholder="10 rue de la plage..." />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-slate-500 mb-1">Téléphone</label>
                  <input type="text" name="locataireTel" value={formData.locataireTel} onChange={handleChange} className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-slate-200 focus:ring-2 focus:ring-indigo-500" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-500 mb-1">Email</label>
                  <input type="email" name="locataireEmail" value={formData.locataireEmail} onChange={handleChange} className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-slate-200 focus:ring-2 focus:ring-indigo-500" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-slate-500 mb-1">Adultes</label>
                  <input type="text" name="nbAdultes" value={formData.nbAdultes} onChange={handleChange} className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-slate-200 focus:ring-2 focus:ring-indigo-500" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-500 mb-1">Enfants</label>
                  <input type="text" name="nbEnfants" value={formData.nbEnfants} onChange={handleChange} className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-slate-200 focus:ring-2 focus:ring-indigo-500" />
                </div>
              </div>
            </div>

            <div className="space-y-4">
              <h3 className="font-semibold text-white border-b border-slate-800 pb-2">Séjour et Financier</h3>
              <div>
                <label className="block text-xs font-medium text-slate-500 mb-1">Début (Texte libre)</label>
                <input type="text" name="dateDebut" value={formData.dateDebut} onChange={handleChange} className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-slate-200 focus:ring-2 focus:ring-indigo-500" placeholder="ex: Mercredi 29 Mars à 16h" />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-500 mb-1">Fin (Texte libre)</label>
                <input type="text" name="dateFin" value={formData.dateFin} onChange={handleChange} className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-slate-200 focus:ring-2 focus:ring-indigo-500" placeholder="ex: Dimanche 2 Avril à 12h" />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-slate-500 mb-1">Loyer Brut Sans Ménage (€)</label>
                  <input type="number" name="loyerMontant" value={formData.loyerMontant} onChange={handleChange} className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-slate-200 focus:ring-2 focus:ring-indigo-500" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-500 mb-1">Montant Total (€)</label>
                  <input type="number" name="montantTotal" value={formData.montantTotal} onChange={handleChange} className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-slate-200 focus:ring-2 focus:ring-indigo-500" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-slate-500 mb-1">Montant Acompte Versé (€)</label>
                  <input type="number" name="acompteMontant" value={formData.acompteMontant} onChange={handleChange} className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-slate-200 focus:ring-2 focus:ring-indigo-500" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-500 mb-1">Date Paiement / Solde / Caution</label>
                  <input type="date" name="datePaiement" value={formData.datePaiement} onChange={handleChange} className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-slate-200 focus:ring-2 focus:ring-indigo-500 [color-scheme:dark]" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-slate-500 mb-1">Montant Caution (€)</label>
                  <input type="number" name="cautionMontant" value={formData.cautionMontant} onChange={handleChange} className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-slate-200 focus:ring-2 focus:ring-indigo-500" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-500 mb-1">Lieu Signature</label>
                  <input type="text" name="lieuSignature" value={formData.lieuSignature} onChange={handleChange} className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-slate-200 focus:ring-2 focus:ring-indigo-500" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-slate-500 mb-1">Date Signature</label>
                  <input type="date" name="dateSignature" value={formData.dateSignature} onChange={handleChange} className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-slate-200 focus:ring-2 focus:ring-indigo-500 [color-scheme:dark]" />
                </div>
              </div>
            </div>

          </div>
        </div>

        {/* Footer */}
        <div className="p-6 border-t border-slate-800 bg-slate-900/50 flex items-center justify-between">
          <p className="text-xs text-slate-500">Vérifiez les informations avant de générer le document.</p>
          <div className="flex gap-3">
            <button onClick={onClose} className="px-4 py-2 text-sm font-medium text-slate-300 hover:text-white bg-slate-800 hover:bg-slate-700 rounded-lg transition-colors">
              Annuler
            </button>
            <PDFDownloadLink
              document={
                location === 'PORTIVY' ? <PortivyContractPdf data={formattedPdfData} /> :
                location === 'HAUT' ? <ChaletHautContractPdf data={formattedPdfData} /> :
                <ChaletBasContractPdf data={formattedPdfData} />
              }
              fileName={pdfFileName}
              className="px-4 py-2 text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg transition-colors shadow-lg shadow-indigo-500/20 flex items-center gap-2"
            >
              {/* @ts-ignore */}
              {({ blob, url, loading, error }) =>
                loading ? 'Génération...' : (
                  <>
                    <Download className="w-4 h-4" />
                    Télécharger le PDF
                  </>
                )
              }
            </PDFDownloadLink>
          </div>
        </div>

      </div>
    </div>
  );
};
