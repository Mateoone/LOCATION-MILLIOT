import React, { useState, useEffect, useMemo } from 'react';
import { 
  fetchGoogleContacts, 
  createGoogleContact, 
  updateGoogleContact, 
  getOrCreateContactGroup, 
  deleteGoogleContact,
  GoogleContact 
} from '../lib/contacts';
import { SheetLocation, fetchSheetData, ReservationRow } from '../lib/sheets';
import { parse, isValid, compareDesc } from 'date-fns';
import { 
  Search, 
  UserPlus, 
  Phone, 
  Mail, 
  RefreshCw, 
  Calendar, 
  AlertTriangle, 
  Check, 
  User, 
  Info, 
  Loader2, 
  X, 
  Database,
  ShieldAlert,
  Sparkles,
  ArrowRight,
  Trash2,
  Download
} from 'lucide-react';

interface BookingLink {
  location: SheetLocation;
  start: string;
  end: string;
  row: ReservationRow;
}

interface SyncStats {
  totalAnalyzed: number;
  totalSkippedFamily: number;
  uniqueGuests: number;
  created: number;
  updated: number;
  deleted: number;
  errors: number;
}

export function ContactsView() {
  const [contacts, setContacts] = useState<GoogleContact[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [showUpcomingOnly, setShowUpcomingOnly] = useState(false);
  const [groupResourceId, setGroupResourceId] = useState<string>('');
  
  // New Contact Form State (Single addition manual fallback)
  const [isAdding, setIsAdding] = useState(false);
  const [newName, setNewName] = useState('');
  const [newEmail, setNewEmail] = useState('');
  const [newPhone, setNewPhone] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  
  // Booking connection states
  const [allBookings, setAllBookings] = useState<BookingLink[]>([]);
  const [loadingBookings, setLoadingBookings] = useState(false);
  const [selectedContact, setSelectedContact] = useState<GoogleContact | null>(null);

  // Sync Overlay State
  const [syncing, setSyncing] = useState(false);
  const [syncStep, setSyncStep] = useState<string>('');
  const [syncStats, setSyncStats] = useState<SyncStats | null>(null);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [showConfirmSync, setShowConfirmSync] = useState(false);

  // Deletion State
  const [isDeleting, setIsDeleting] = useState(false);

  const groupName = "Voyageurs Hélène & Matthieu";

  // Helper date parser to verify chronological order
  const parseDateStr = (dateStr: string) => {
    if (!dateStr) return null;
    const cleanStr = dateStr.trim();
    let parsed = parse(cleanStr, 'dd/MM/yyyy', new Date());
    if (!isValid(parsed)) {
      parsed = parse(cleanStr, 'yyyy-MM-dd', new Date());
    }
    if (!isValid(parsed)) {
      parsed = new Date(cleanStr);
    }
    return isValid(parsed) ? parsed : null;
  };

  const handleDeleteContact = async (resourceName: string, name: string) => {
    if (!window.confirm(`Êtes-vous sûr de vouloir supprimer définitivement le contact "${name}" ?`)) return;
    
    try {
      setIsDeleting(true);
      await deleteGoogleContact(resourceName);
      if (selectedContact?.resourceName === resourceName) {
        setSelectedContact(null);
      }
      await loadContacts();
    } catch (err: any) {
      alert(err.message || "Erreur lors de la suppression du contact.");
    } finally {
      setIsDeleting(false);
    }
  };

  const handleExportCSV = () => {
    if (filteredContacts.length === 0) return;

    const rows = filteredContacts.map(c => {
      const name = `"${(c.name || '').replace(/"/g, '""')}"`;
      const email = `"${(c.email || '').replace(/"/g, '""')}"`;
      const phone = `"${(c.phone || '').replace(/"/g, '""')}"`;
      const biography = `"${(c.biography || '').replace(/"/g, '""')}"`;
      
      return [name, email, phone, biography].join(',');
    });

    const csvContent = "data:text/csv;charset=utf-8,\uFEFF" + ['Nom,Email,Téléphone,Notes/Canal'].concat(rows).join('\n');
    const encodedUri = encodeURI(csvContent);
    
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `contacts_export_${new Date().toISOString().split('T')[0]}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const loadContacts = async () => {
    try {
      setLoading(true);
      setError(null);

      // Load connections directly from our secure shared database (Firestore)
      const list = await fetchGoogleContacts();
      setContacts(list);
    } catch (err: any) {
      setError(err.message || "Impossible de charger les fiches voyageurs depuis la base de données.");
    } finally {
      setLoading(false);
    }
  };

  // Pre-load all bookings across properties to link historical data in dossier view
  const loadAllBookings = async () => {
    try {
      setLoadingBookings(true);
      const locations: SheetLocation[] = ['HAUT', 'BAS', 'PORTIVY'];
      const resolved: BookingLink[] = [];

      for (const loc of locations) {
        try {
          const res = await fetchSheetData(loc);
          if (res && res.headers.length > 0) {
            const firstHeader = res.headers[0];
            const nameHeader = res.headers.find(h => /nom|locataire|client|name/i.test(h)) || res.headers[0];
            const endHeader = res.headers.find(h => /fin|départ|depart|end/i.test(h)) || res.headers[1];
            
            res.rows.forEach(row => {
              const startVal = row[firstHeader] || '';
              const endVal = row[endHeader] || '';
              const nameVal = row[nameHeader] || '';

              // Simple date validation for first column
              if (nameVal && /^\d{1,4}[\/\-]\d{1,2}[\/\-]\d{1,4}/.test(startVal.trim())) {
                resolved.push({
                  location: loc,
                  start: startVal,
                  end: endVal,
                  row
                });
              }
            });
          }
        } catch (e) {
          console.error(`Error loading bookings for ${loc}:`, e);
        }
      }
      setAllBookings(resolved);
    } catch (err) {
      console.error("Failed to load historical bookings:", err);
    } finally {
      setLoadingBookings(false);
    }
  };

  useEffect(() => {
    loadContacts();
    loadAllBookings();
  }, []);

  // Find bookings associated with the selected contact
  const activeBookingsForContact = (contactName: string) => {
    if (!contactName) return [];
    const nameLower = contactName.toLowerCase().trim();
    return allBookings.filter(b => {
      const headerName = Object.keys(b.row).find(k => /nom|locataire|client|name/i.test(k));
      if (!headerName) return false;
      const rowName = (b.row[headerName] || '').toLowerCase().trim();
      return rowName.includes(nameLower) || nameLower.includes(rowName);
    });
  };

  // Filter contacts by search query and upcoming status
  const filteredContacts = useMemo(() => {
    let result = contacts;
    
    if (showUpcomingOnly) {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      
      result = result.filter(c => {
        const bookings = activeBookingsForContact(c.name);
        return bookings.some(b => {
           const endHeader = Object.keys(b.row).find(h => /fin|départ|depart|end/i.test(h));
           if (!endHeader || !b.row[endHeader]) return false;
           const endDate = parseDateStr(b.row[endHeader]);
           return endDate && endDate >= today;
        });
      });
    }

    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      result = result.filter(
        c =>
          c.name.toLowerCase().includes(query) ||
          c.email.toLowerCase().includes(query) ||
          c.phone.toLowerCase().includes(query) ||
          c.biography?.toLowerCase().includes(query)
      );
    }
    
    return result;
  }, [contacts, searchQuery, showUpcomingOnly, allBookings]);

  const selectedContactBookings = useMemo(() => {
    if (!selectedContact) return [];
    return activeBookingsForContact(selectedContact.name);
  }, [selectedContact, allBookings]);

  // Unified Sheets to Google Contacts sync routing
  const handleSyncFromSheets = async () => {
    try {
      setSyncing(true);
      setSyncStats(null);
      setSyncError(null);
      setSyncStep("Étape 1: Connexion à la base de données voyageurs...");

      // Ensure Contact Group exists/dummy
      const targetGroupId = "firestore_voyageurs";
      setGroupResourceId(targetGroupId);

      // Load existing voyageurs in database (to update them and avoid duplicates)
      setSyncStep("Étape 2: Indexation de vos fiches voyageurs existantes...");
      const currentGoogleContacts = await fetchGoogleContacts();

      setSyncStep("Étape 3: Extraction et traitement des réservations depuis Sheets...");
      const locations: SheetLocation[] = ['HAUT', 'BAS', 'PORTIVY'];
      
      let rawBookingRowsCount = 0;
      let skippedFamilyCount = 0;

      // Temporary structure to group reservations by guest name
      // Key: Lowercase trimmed guest name
      // Value: List of parsed stays
      const guestsRentalsMap: Record<string, {
        displayName: string;
        phone: string;
        email: string;
        stays: {
          location: string;
          startDate: Date;
          startStr: string;
          endStr: string;
          source: string;
        }[];
      }> = {};

      for (const loc of locations) {
        try {
          const sheetResult = await fetchSheetData(loc);
          if (!sheetResult || sheetResult.headers.length === 0) continue;

          const startHeader = sheetResult.headers.find(h => /début|debut|arrivée|arrivee|start/i.test(h)) || sheetResult.headers[0];
          const endHeader = sheetResult.headers.find(h => /fin|départ|depart|end/i.test(h)) || sheetResult.headers[1];
          const nameHeader = sheetResult.headers.find(h => /nom|locataire|client|name/i.test(h)) || sheetResult.headers[0];
          const phoneHeader = sheetResult.headers.find(h => /tél|tel|phone/i.test(h));
          const emailHeader = sheetResult.headers.find(h => /email|mail|e-mail|courriel/i.test(h));
          const sourceHeader = sheetResult.headers.find(h => /source|plateforme|origine|provenance|clientele|clientèle/i.test(h));

          sheetResult.rows.forEach(row => {
            const guestName = (row[nameHeader] || '').trim();
            const startStr = (row[startHeader] || '').trim();
            const endStr = endHeader ? (row[endHeader] || '').trim() : '';

            // 1. Skip if row is empty or doesn't have a valid guest name or is not a reservation row (check if first column is date)
            if (!guestName || !/^\d{1,4}[\/\-]\d{1,2}[\/\-]\d{1,4}/.test(startStr)) {
              return;
            }

            rawBookingRowsCount++;

            // 2. EXCLUDE FAMILY STAYS (Milliot)
            if (/milliot/i.test(guestName)) {
              skippedFamilyCount++;
              return;
            }

            const startDate = parseDateStr(startStr);
            if (!startDate) return;

            const phone = phoneHeader ? (row[phoneHeader] || '').trim() : '';
            const email = emailHeader ? (row[emailHeader] || '').trim() : '';
            const rawSource = sourceHeader ? (row[sourceHeader] || '').trim() : '';

            // Map Airbnb vs Direct
            let sourceLabel = "En Direct";
            if (/airbnb/i.test(rawSource)) {
              sourceLabel = "Airbnb";
            }

            const normalizedKey = guestName.toLowerCase();
            if (!guestsRentalsMap[normalizedKey]) {
              guestsRentalsMap[normalizedKey] = {
                displayName: guestName,
                phone: phone,
                email: email,
                stays: []
              };
            }

            // Append phone or email if we found it and was missing
            if (phone && !guestsRentalsMap[normalizedKey].phone) {
              guestsRentalsMap[normalizedKey].phone = phone;
            }
            if (email && !guestsRentalsMap[normalizedKey].email) {
              guestsRentalsMap[normalizedKey].email = email;
            }

            // Map location moniker
            const locationMoniker = loc === 'HAUT' ? 'Chalet Haut' : loc === 'BAS' ? 'Chalet Bas' : 'Portivy';

            guestsRentalsMap[normalizedKey].stays.push({
              location: locationMoniker,
              startDate,
              startStr,
              endStr,
              source: sourceLabel
            });
          });

        } catch (err: any) {
          console.error(`Error syncing sheets for ${loc} location:`, err);
          throw new Error(`Erreur lors de la lecture des données pour le chalet ${loc} : ${err.message || err}`);
        }
      }

      const uniqueGuestsIds = Object.keys(guestsRentalsMap);
      if (uniqueGuestsIds.length === 0) {
        throw new Error("Aucun voyageur valide n'a pu être extrait des feuilles de calcul.");
      }

      setSyncStep(`Étape 4: Écriture et mise à jour de ${uniqueGuestsIds.length} voyageurs dans votre base de données...`);

      let createdCount = 0;
      let updatedCount = 0;
      let deletedCount = 0;
      let errorCount = 0;

      for (const key of uniqueGuestsIds) {
        const guestData = guestsRentalsMap[key];
        
        // Find latest stay
        const sortedStays = [...guestData.stays].sort((a, b) => compareDesc(a.startDate, b.startDate));
        const latestStay = sortedStays[0];

        // Format Biography Note: "Dernière location: Chalet Haut du 12/03/2026 au 19/03/2026 (via Airbnb)"
        const stayDurationStr = latestStay.endStr ? `du ${latestStay.startStr} au ${latestStay.endStr}` : `le ${latestStay.startStr}`;
        const biographyNote = `Dernière location : ${latestStay.location} ${stayDurationStr} (via ${latestStay.source})`;

        // Check if this contact matches an existing voyager
        const existingContact = currentGoogleContacts.find(
          c => c.name.toLowerCase() === guestData.displayName.toLowerCase()
        );

        try {
          if (existingContact) {
            // Check if biography note, phone number or email needs updates
            const needsUpdate = 
              existingContact.biography !== biographyNote || 
              (!existingContact.phone && guestData.phone) ||
              (!existingContact.email && guestData.email);

            if (needsUpdate) {
              await updateGoogleContact("", existingContact.resourceName, existingContact.etag || '', {
                name: existingContact.name,
                phone: existingContact.phone || guestData.phone || undefined,
                email: existingContact.email || guestData.email || undefined,
                biography: biographyNote,
                groupResourceName: targetGroupId
              });
              updatedCount++;
            }
          } else {
            // New entry: Create the contact
            await createGoogleContact("", {
              name: guestData.displayName,
              phone: guestData.phone || undefined,
              email: guestData.email || undefined,
              biography: biographyNote,
              groupResourceName: targetGroupId
            });
            createdCount++;
          }
        } catch (contactErr) {
          console.error(`Failed to process contact ${guestData.displayName}:`, contactErr);
          errorCount++;
        }
      }

      setSyncStep(`Étape 5: Nettoyage automatisé des voyageurs inactifs...`);
      for (const existingContact of currentGoogleContacts) {
        const normalizedName = existingContact.name.toLowerCase();
        if (!guestsRentalsMap[normalizedName]) {
          try {
            await deleteGoogleContact(existingContact.resourceName);
            deletedCount++;
          } catch (deleteErr) {
            console.error(`Failed to delete contact ${existingContact.name}:`, deleteErr);
            errorCount++;
          }
        }
      }

      setSyncStats({
        totalAnalyzed: rawBookingRowsCount,
        totalSkippedFamily: skippedFamilyCount,
        uniqueGuests: uniqueGuestsIds.length,
        created: createdCount,
        updated: updatedCount,
        deleted: deletedCount,
        errors: errorCount
      });

      setSyncStep("Synchronisation terminée avec succès !");
      await loadContacts();
    } catch (err: any) {
      console.error("Sync error:", err);
      setSyncError(err.message || "Une erreur est survenue lors de la synchronisation.");
    }
  };

  // Manual Contact Creation directly in group
  const handleCreateContact = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newName.trim()) return;

    try {
      setIsSubmitting(true);
      setSubmitError(null);

      await createGoogleContact("", {
        name: newName,
        email: newEmail,
        phone: newPhone,
        biography: "Ajouté manuellement par la conciergerie.",
        groupResourceName: groupResourceId || undefined
      });

      setNewName('');
      setNewEmail('');
      setNewPhone('');
      setIsAdding(false);
      
      await loadContacts();
    } catch (err: any) {
      setSubmitError(err.message || "Erreur lors de la création du contact.");
    } finally {
      setIsSubmitting(false);
    }
  };

  // Helper to visually flag stay channel inside list view or detail dossier
  const extractChannelFromBio = (bio?: string): { location: string; channel: 'Airbnb' | 'Direct' | 'Inconnu' } => {
    if (!bio) return { location: '', channel: 'Inconnu' };
    const airbnbMatch = /airbnb/i.test(bio);
    const directMatch = /direct/i.test(bio);
    
    let location = 'Location';
    if (/Chalet Haut/i.test(bio)) location = 'Chalet Haut';
    else if (/Chalet Bas/i.test(bio)) location = 'Chalet Bas';
    else if (/Portivy/i.test(bio)) location = 'Portivy';

    return {
      location,
      channel: airbnbMatch ? 'Airbnb' : directMatch ? 'Direct' : 'Inconnu'
    };
  };

  const renderContactDossier = (contact: GoogleContact) => {
    const contactBookings = activeBookingsForContact(contact.name);
    
    return (
      <div className="mt-3 p-5 bg-slate-950/80 border border-slate-800 rounded-xl overflow-hidden cursor-default" onClick={e => e.stopPropagation()}>
        <div className="flex items-start justify-between pb-5 border-b border-slate-800/80">
          <div className="flex items-center gap-4">
            <div className="w-14 h-14 rounded-full bg-purple-500/10 text-purple-400 border border-purple-500/20 text-lg font-bold flex items-center justify-center tracking-widest font-mono">
              {contact.name.substring(0, 2).toUpperCase()}
            </div>
            <div>
              <h3 className="text-base font-bold text-white tracking-tight">{contact.name}</h3>
              <p className="text-[11px] text-slate-500 mt-0.5">Saisie Voyageurs Conciergerie</p>
            </div>
          </div>
          
          <button
            onClick={() => handleDeleteContact(contact.resourceName, contact.name)}
            disabled={isDeleting}
            className={`px-3 py-2 rounded-lg border transition-colors flex items-center gap-2 text-xs font-semibold text-rose-400 border-rose-500/20 hover:bg-rose-500/10 ${isDeleting ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
            title="Supprimer définitivement ce contact"
          >
            {isDeleting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
            <span className="hidden sm:inline">Supprimer</span>
          </button>
        </div>

        {/* Canal Stay Badge Display if applicable */}
        {contact.biography && (
          <div className="mt-5 p-3.5 bg-slate-900/60 border border-slate-800/80 rounded-xl flex flex-col sm:flex-row sm:items-center gap-3 justify-between">
            <span className="text-[10px] font-bold text-slate-400 tracking-wider">Provenance dernière loc :</span>
            <div>
              {extractChannelFromBio(contact.biography).channel === 'Airbnb' ? (
                <span className="text-[10px] font-extrabold px-2 py-0.5 rounded bg-rose-500/10 text-rose-400 border border-rose-500/25 uppercase inline-block mb-1">
                  Airbnb Host Connection
                </span>
              ) : (
                <span className="text-[10px] font-extrabold px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/25 uppercase inline-block mb-1">
                  Client Direct (En Direct)
                </span>
              )}
              <p className="text-[11px] text-slate-300 italic font-medium leading-relaxed">
                "{contact.biography}"
              </p>
            </div>
          </div>
        )}

        {/* Attributes & Stays Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mt-5">
          {/* Attributes */}
          <div className="space-y-3">
            <h4 className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">COORDONNÉES</h4>
            {contact.phone ? (
              <div className="bg-slate-900 p-2.5 rounded-lg border border-slate-800 flex items-center">
                <Phone className="w-3.5 h-3.5 text-purple-400 mr-2 shrink-0" />
                <span className="text-xs text-slate-300 font-mono font-medium">{contact.phone}</span>
              </div>
            ) : (
              <div className="bg-slate-900/30 p-2.5 rounded-lg border border-slate-800/50 flex items-center text-slate-500 text-[11px]">
                <ShieldAlert className="w-3 h-3 mr-2 text-amber-500 shrink-0" />
                Pas de téléphone
              </div>
            )}
            
            {contact.email ? (
              <div className="bg-slate-900 p-2.5 rounded-lg border border-slate-800 flex items-center overflow-hidden">
                <Mail className="w-3.5 h-3.5 text-purple-400 mr-2 shrink-0" />
                <span className="text-xs text-slate-300 font-mono truncate" title={contact.email}>{contact.email}</span>
              </div>
            ) : (
              <div className="bg-slate-900/30 p-2.5 rounded-lg border border-slate-800/50 flex items-center text-slate-500 text-[11px]">
                <ShieldAlert className="w-3 h-3 mr-2 text-amber-500 shrink-0" />
                Pas d'email
              </div>
            )}
          </div>

          {/* Stays History */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <h4 className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Séjours Détectés</h4>
              <span className="text-[10px] text-indigo-400 bg-indigo-500/10 border border-indigo-500/20 px-2 py-0.5 rounded-full font-bold">
                {contactBookings.length}
              </span>
            </div>

            {loadingBookings ? (
              <div className="flex items-center justify-center py-4">
                <Loader2 className="w-4 h-4 text-purple-500 animate-spin" />
              </div>
            ) : contactBookings.length === 0 ? (
              <div className="bg-slate-900/20 border border-slate-850 p-4 rounded-xl flex flex-col items-center justify-center text-center">
                <Calendar className="w-5 h-5 text-slate-800 mb-1" />
                <p className="text-[10px] font-semibold text-slate-500">Aucun séjour lié</p>
              </div>
            ) : (
              <div className="space-y-2 max-h-40 overflow-y-auto pr-1">
                {contactBookings.map((b, bIdx) => (
                  <div key={bIdx} className="p-2.5 bg-slate-900/60 border border-slate-850 rounded-lg">
                    <div className="flex items-center justify-between">
                      <span className={`text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded
                        ${b.location === 'HAUT' ? 'bg-indigo-500/15 text-indigo-300 border border-indigo-500/20' : 
                          b.location === 'BAS' ? 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/20' : 
                          'bg-amber-500/15 text-amber-300 border border-amber-500/20'}`}>
                        {b.location === 'HAUT' ? 'Chalet Haut' : b.location === 'BAS' ? 'Chalet Bas' : 'Portivy'}
                      </span>
                      <span className="text-[9px] font-mono text-indigo-400">
                        Ligne {b.row.rowIndex}
                      </span>
                    </div>
                    <div className="text-[10px] text-slate-300 mt-1.5 font-mono flex items-center">
                      <Calendar className="w-3 h-3 mr-1 text-slate-500 shrink-0" />
                      <span>{b.start} ➔ {b.end}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="flex-1 flex flex-col font-sans overflow-hidden bg-slate-900 text-slate-100 h-full">
      {/* Header */}
      <header className="h-20 border-b border-slate-800 flex items-center justify-between px-6 lg:px-8 bg-slate-900/50 shrink-0">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-white flex items-center gap-2">
            Annuaire Voyageurs
            <span className="text-[10px] bg-purple-500/15 text-purple-400 border border-purple-500/30 px-2.5 py-0.5 rounded-full font-bold uppercase tracking-wider">
              Firestore
            </span>
          </h1>
          <p className="text-slate-500 text-xs mt-1">
            Base de données sécurisée synchronisée en temps réel avec les réservations (séjours Milliot exclus).
          </p>
        </div>

        <div className="flex items-center space-x-3 shrink-0">
          <button
            onClick={() => setShowConfirmSync(true)}
            className="px-4 py-2 text-xs sm:text-sm font-bold text-white bg-indigo-600 hover:bg-indigo-500 rounded-lg flex items-center shadow-lg transition-colors cursor-pointer border border-transparent"
            title="Mettre à jour l'annuaire depuis les feuilles de calcul Google Sheets"
          >
            <RefreshCw className="w-4 h-4 mr-2 animate-pulse-subtle" />
            Synchroniser depuis le Spreadsheet
          </button>
          
          <button
            onClick={() => setIsAdding(true)}
            className="px-4 py-2 text-xs sm:text-sm font-bold text-purple-400 hover:text-white bg-purple-500/10 border border-purple-500/30 hover:bg-purple-600 rounded-lg transition-colors flex items-center cursor-pointer"
          >
            <UserPlus className="w-4 h-4 mr-2" />
            Nouveau contact
          </button>
        </div>
      </header>

      {/* Main layout */}
      <div className="flex-1 flex overflow-hidden flex-col min-h-0 bg-slate-900">
        
        {/* Contacts list */}
        <div className="flex-1 flex flex-col min-h-0 p-4 lg:p-8">
          <div className="relative mb-6 shrink-0 max-w-4xl mx-auto w-full">
            <div className="flex flex-col sm:flex-row gap-3">
              <div className="relative flex-1">
                <span className="absolute inset-y-0 left-0 flex items-center pl-3.5 pointer-events-none text-slate-500">
                  <Search className="w-4 h-4" />
                </span>
                <input
                  type="text"
                  placeholder="Rechercher par nom, téléphone ou canal (ex: Airbnb, Direct)..."
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                  className="w-full pl-10 pr-4 py-2.5 bg-slate-950 border border-slate-800 rounded-xl focus:ring-1 focus:ring-purple-500 focus:border-purple-500 text-sm text-slate-200 outline-none transition-all placeholder:text-slate-600 shadow-sm"
                />
              </div>
              <label className="flex items-center space-x-2 px-4 py-2.5 bg-slate-950 border border-slate-800 rounded-xl cursor-pointer hover:bg-slate-900 transition-colors">
                <input 
                  type="checkbox" 
                  checked={showUpcomingOnly} 
                  onChange={e => setShowUpcomingOnly(e.target.checked)}
                  className="rounded text-purple-500 bg-slate-800 border-slate-700 focus:ring-purple-500/50 outline-none"
                  style={{ width: "16px", height: "16px" }}
                />
                <span className="text-sm font-medium text-slate-300 whitespace-nowrap">
                  Séjours en cours / à venir
                </span>
              </label>
              
              <button
                onClick={handleExportCSV}
                disabled={filteredContacts.length === 0}
                className="flex items-center space-x-2 px-4 py-2.5 bg-slate-950 border border-slate-800 rounded-xl hover:bg-slate-900 transition-colors cursor-pointer text-sm font-medium text-slate-300 whitespace-nowrap disabled:opacity-50 disabled:cursor-not-allowed"
                title="Exporter les contacts filtrés en CSV"
              >
                <Download className="w-4 h-4 text-slate-400" />
                <span>Exporter CSV</span>
              </button>
            </div>
          </div>

          {loading ? (
            <div className="flex-1 flex flex-col items-center justify-center text-slate-500 space-y-3">
              <Loader2 className="w-8 h-8 text-purple-500 animate-spin" />
              <p className="text-sm">Chargement depuis la base de données Firestore...</p>
            </div>
          ) : error ? (
            <div className="flex-1 flex items-center justify-center p-6 text-center">
              <div className="p-5 bg-red-950/20 border border-red-900/50 rounded-xl inline-block text-red-200 max-w-md">
                <AlertTriangle className="w-8 h-8 text-red-500 mx-auto mb-3" />
                <p className="font-bold">Erreur de connexion</p>
                <p className="text-sm mt-1 text-red-400">{error}</p>
                <button
                  onClick={loadContacts}
                  className="mt-4 px-4 py-2 bg-slate-950 text-red-400 hover:bg-red-900 rounded-lg border border-red-900/50 transition-colors"
                >
                  Réessayer
                </button>
              </div>
            </div>
          ) : filteredContacts.length === 0 ? (
            <div className="flex-1 flex flex-col items-center justify-center p-8 mt-4 bg-slate-950/20 border border-dashed border-slate-800 rounded-2xl text-slate-500 text-center max-w-4xl mx-auto w-full">
              <User className="w-10 h-10 text-slate-700 mb-3" />
              <p className="text-sm font-medium">Aucun voyageur disponible dans la base</p>
              <p className="text-xs text-slate-600 mt-1 max-w-sm leading-relaxed">
                {searchQuery 
                  ? "Ajustez vos critères de recherche commerciale." 
                  : "La base de données est vide. Veuillez cliquer sur 'Synchroniser depuis le Spreadsheet' en haut pour indexer les clients des tableaux de bord."
                }
              </p>
              {!searchQuery && (
                <button
                  onClick={() => setShowConfirmSync(true)}
                  className="mt-5 px-5 py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-xs rounded-lg shadow-lg flex items-center cursor-pointer"
                >
                  <RefreshCw className="w-3.5 h-3.5 mr-2" />
                  Lancer la synchronisation initiale
                </button>
              )}
            </div>
          ) : (
            <div className="flex-1 overflow-y-auto space-y-2 pr-2 pb-12 max-w-4xl mx-auto w-full scroll-smooth">
              <div className="flex items-center justify-between text-[11px] text-slate-500 font-bold px-1 mb-2 sticky top-0 bg-slate-900 z-10 py-2">
                <span>NOM DES LOCATAIRES ({filteredContacts.length})</span>
                <span>DERNIER CANAL / ACTIONS</span>
              </div>
              
              {filteredContacts.map(contact => {
                const isSelected = selectedContact?.resourceName === contact.resourceName;
                const matches = activeBookingsForContact(contact.name);
                const info = extractChannelFromBio(contact.biography);
                
                return (
                  <div key={contact.resourceName} className="mb-2">
                    <div
                      onClick={() => {
                        setSelectedContact(isSelected ? null : contact);
                        // Optional scroll to focus when expanded on mobile
                        if (!isSelected && window.innerWidth < 1024) {
                          setTimeout(() => {
                            const el = document.getElementById(`contact-${contact.resourceName}`);
                            if (el) {
                              el.scrollIntoView({ behavior: 'smooth', block: 'start' });
                            }
                          }, 100);
                        }
                      }}
                      id={`contact-${contact.resourceName}`}
                      className={`p-4 rounded-xl border transition-all cursor-pointer flex items-center justify-between group
                        ${isSelected 
                          ? 'bg-slate-950 border-purple-500/40 shadow-sm shadow-purple-500/5' 
                          : 'bg-slate-950/40 border-slate-800 hover:border-slate-700/60'}`}
                    >
                      <div className="flex items-center space-x-4 min-w-0">
                        <div className={`w-11 h-11 rounded-full flex items-center justify-center text-xs font-bold font-mono tracking-wider shrink-0
                          ${isSelected ? 'bg-purple-500 text-white' : 'bg-slate-850 text-slate-400 border border-slate-800'}`}>
                          {contact.name.substring(0, 2).toUpperCase()}
                        </div>
                        
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <h4 className="font-semibold text-sm text-slate-200 truncate">{contact.name}</h4>
                            {matches.length > 0 && (
                              <span className="text-[9px] font-bold pr-2 pl-1 py-0.5 rounded-full bg-amber-500/10 text-amber-400 border border-amber-500/20 uppercase tracking-wide shrink-0 inline-flex items-center">
                                <span className="w-3.5 h-3.5 rounded-full bg-amber-500/20 flex items-center justify-center mr-1.5 text-[8px] border border-amber-500/30">{matches.length}</span>
                                {matches.length > 1 ? 'séjours' : 'séjour'}
                              </span>
                            )}
                          </div>
                          
                          <div className="flex flex-wrap items-center mt-1 gap-x-3 gap-y-1">
                            {contact.phone && (
                              <div className="flex items-center text-xs text-slate-500 font-mono">
                                <Phone className="w-3.5 h-3.5 mr-1 text-slate-600 shrink-0" />
                                {contact.phone}
                              </div>
                            )}
                            {contact.biography && (
                              <div className="text-[11px] text-slate-400 truncate max-w-[280px] font-medium italic">
                                {contact.biography}
                              </div>
                            )}
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center space-x-2 shrink-0">
                        {info.channel === 'Airbnb' ? (
                          <span className="text-[10px] font-bold bg-rose-500/10 text-rose-400 border border-rose-500/20 px-2 py-0.5 rounded uppercase hidden sm:inline-block">
                            Airbnb
                          </span>
                        ) : info.channel === 'Direct' ? (
                          <span className="text-[10px] font-bold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 px-2 py-0.5 rounded uppercase hidden sm:inline-block">
                            Direct
                          </span>
                        ) : null}

                        <button className={`text-xs transition-colors px-3 py-1.5 rounded-lg border ${isSelected ? 'bg-purple-500 text-white border-purple-500' : 'bg-slate-900/50 text-slate-400 border-slate-800 group-hover:text-purple-400 group-hover:border-purple-500/30'}`}>
                          {isSelected ? 'Fermer' : 'Dossier'}
                        </button>
                      </div>
                    </div>
                    
                    {isSelected && renderContactDossier(contact)}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Custom Sync Confirmation Modal */}
      {showConfirmSync && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-sm p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl shadow-xl shadow-black/50 w-full max-w-md overflow-hidden text-slate-100 font-sans">
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800/80 bg-slate-950/50">
              <h3 className="text-base font-bold text-white tracking-tight flex items-center gap-2">
                <Database className="w-4 h-4 text-indigo-400" />
                Synchronisation de l'Annuaire
              </h3>
              <button 
                onClick={() => setShowConfirmSync(false)}
                className="text-slate-500 hover:text-slate-300 transition-colors cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-6 space-y-4">
              <p className="text-slate-300 text-sm leading-relaxed">
                Voulez-vous synchroniser les contacts d'Hélène et Matthieu avec les réservations ?
              </p>
              <p className="text-slate-400 text-xs leading-relaxed bg-slate-950/50 border border-slate-800 p-3 rounded-xl">
                Cette action va :
                <br />• Analyser toutes les réservations des chalets (fichiers Google Sheets).
                <br />• Exclure les séjours familiaux (famille Milliot).
                <br />• Identifier la dernière réservation pour préciser la provenance (Airbnb ou Direct).
                <br />• Mettre à jour votre base de données partagée de façon sécurisée (Firestore).
              </p>
            </div>

            <div className="flex items-center justify-end gap-3 px-6 py-4 bg-slate-950/30 border-t border-slate-800/80">
              <button
                onClick={() => setShowConfirmSync(false)}
                className="px-4 py-2 text-xs font-bold text-slate-400 hover:text-white transition-colors cursor-pointer"
              >
                Annuler
              </button>
              <button
                onClick={() => {
                  setShowConfirmSync(false);
                  handleSyncFromSheets();
                }}
                className="px-4 py-2 text-xs font-bold text-white bg-indigo-600 hover:bg-indigo-500 rounded-lg flex items-center gap-2 shadow-lg cursor-pointer shadow-indigo-500/10"
              >
                Confirmer la synchronisation
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Syncing Loader / Overlay Stats Modal */}
      {syncing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/90 backdrop-blur-md p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-3xl shadow-2xl p-8 max-w-lg w-full text-center">
            {syncError ? (
              <div className="space-y-6">
                <div className="w-14 h-14 bg-rose-500/10 text-rose-400 rounded-full flex items-center justify-center mx-auto border border-rose-500/30">
                  <AlertTriangle className="w-8 h-8" />
                </div>
                
                <div>
                  <h3 className="text-xl font-bold text-white tracking-tight">Erreur de synchronisation</h3>
                  <p className="text-slate-400 text-xs mt-2 px-4 leading-relaxed">
                    Une erreur est survenue lors de l'accès aux données des Chalets ou de la base Firestore.
                  </p>
                  <p className="bg-slate-950 border border-slate-800 rounded-xl p-3 text-red-400 font-mono text-left text-xs mt-4 max-h-40 overflow-y-auto whitespace-pre-wrap">
                    {syncError}
                  </p>
                </div>

                <button
                  onClick={() => setSyncing(false)}
                  className="w-full py-2.5 bg-red-650 hover:bg-red-650 text-white font-bold text-sm rounded-xl transition-all border border-transparent cursor-pointer"
                >
                  Fermer
                </button>
              </div>
            ) : !syncStats ? (
              <div className="space-y-6">
                <Loader2 className="w-12 h-12 text-indigo-500 animate-spin mx-auto" />
                <h3 className="text-lg font-bold text-white tracking-tight">Synchronisation de l'Annuaire Voyageurs</h3>
                <p className="text-slate-400 text-xs px-4 leading-relaxed">{syncStep}</p>
                <div className="w-full bg-slate-950 rounded-full h-1.5 overflow-hidden">
                  <div className="bg-indigo-500 h-1.5 rounded-full animate-pulse" style={{ width: '100%' }}></div>
                </div>
              </div>
            ) : (
              <div className="space-y-6">
                <div className="w-14 h-14 bg-emerald-500/10 text-emerald-400 rounded-full flex items-center justify-center mx-auto border border-emerald-500/30">
                  <Check className="w-8 h-8" />
                </div>
                
                <div>
                  <h3 className="text-xl font-bold text-white tracking-tight">Mise à jour complétée !</h3>
                  <p className="text-slate-500 text-xs mt-1">
                    La base voyageurs partagée d'Hélène & Matthieu a été mise à jour avec succès dans Firestore.
                  </p>
                </div>

                {/* Sync statistics table */}
                <div className="bg-slate-950 rounded-2xl border border-slate-800/80 p-4 divide-y divide-slate-900 text-xs text-left">
                  <div className="flex justify-between py-2">
                    <span className="text-slate-400">Total lignes analysées</span>
                    <span className="font-mono font-bold text-slate-250">{syncStats.totalAnalyzed}</span>
                  </div>
                  <div className="flex justify-between py-2">
                    <span className="text-slate-455 flex items-center gap-1.5">
                      <Sparkles className="w-3.5 h-3.5 text-purple-400" />
                      Séjours Milliot (exclus)
                    </span>
                    <span className="font-mono font-bold text-purple-300">{syncStats.totalSkippedFamily}</span>
                  </div>
                  <div className="flex justify-between py-2">
                    <span className="text-slate-400 font-semibold text-indigo-400">Voyageurs uniques identifiés</span>
                    <span className="font-mono font-bold text-indigo-300">{syncStats.uniqueGuests}</span>
                  </div>
                  <div className="flex justify-between py-2">
                    <span className="text-slate-400">Nouveaux contacts créés</span>
                    <span className="font-mono font-bold text-emerald-400">+{syncStats.created}</span>
                  </div>
                  <div className="flex justify-between py-2">
                    <span className="text-slate-400">Contacts mis à jour</span>
                    <span className="font-mono font-bold text-amber-500">+{syncStats.updated}</span>
                  </div>
                  <div className="flex justify-between py-2 border-t border-slate-900 mt-1 pt-3">
                    <span className="text-slate-400 flex items-center gap-1.5">
                      <Trash2 className="w-3.5 h-3.5 text-rose-500" />
                      Voyageurs obsolètes supprimés
                    </span>
                    <span className="font-mono font-bold text-rose-400">-{syncStats.deleted}</span>
                  </div>
                  {syncStats.errors > 0 && (
                    <div className="flex justify-between py-2 text-red-400">
                      <span>Échecs d'API</span>
                      <span className="font-mono font-bold">{syncStats.errors}</span>
                    </div>
                  )}
                </div>

                <button
                  onClick={() => setSyncing(false)}
                  className="w-full py-2.5 bg-indigo-600 hover:bg-slate-800 text-white hover:text-white font-bold text-sm rounded-xl transition-all border border-transparent cursor-pointer"
                >
                  Fermer
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Manual Add Contact Modal */}
      {isAdding && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-sm p-4 animate-fade-in">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl shadow-xl shadow-black/50 w-full max-w-md overflow-hidden text-slate-100 font-sans">
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800/80 bg-slate-950/50">
              <h3 className="text-base font-bold text-white tracking-tight flex items-center gap-2">
                <UserPlus className="w-4 h-4 text-purple-400" />
                Nouveau Voyageur Google
              </h3>
              <button
                onClick={() => setIsAdding(false)}
                className="text-slate-400 hover:text-white hover:bg-slate-800 transition-colors p-1.5 rounded-lg cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleCreateContact} className="p-6 space-y-4">
              {submitError && (
                <div className="p-3.5 bg-red-950/30 border border-red-900/50 rounded-xl text-xs text-red-200">
                  {submitError}
                </div>
              )}

              <div className="space-y-1.5">
                <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider">Prénom et Nom*</label>
                <input
                  type="text"
                  required
                  value={newName}
                  onChange={e => setNewName(e.target.value)}
                  placeholder="ex: Jean Dupont"
                  className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg focus:ring-1 focus:ring-purple-500 focus:border-purple-500 text-sm text-slate-200 outline-none transition-all placeholder:text-slate-700"
                />
              </div>

              <div className="space-y-1.5">
                <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider">Adresse E-mail</label>
                <input
                  type="email"
                  value={newEmail}
                  onChange={e => setNewEmail(e.target.value)}
                  placeholder="ex: jean.dupont@gmail.com"
                  className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg focus:ring-1 focus:ring-purple-500 focus:border-purple-500 text-sm text-slate-200 outline-none transition-all placeholder:text-slate-700"
                />
              </div>

              <div className="space-y-1.5">
                <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider">Téléphone</label>
                <input
                  type="text"
                  value={newPhone}
                  onChange={e => setNewPhone(e.target.value)}
                  placeholder="ex: 06 12 34 56 78"
                  className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg focus:ring-1 focus:ring-purple-500 focus:border-purple-500 text-sm text-slate-200 outline-none transition-all placeholder:text-slate-700"
                />
              </div>

              <p className="text-[10px] text-slate-500 mt-2 leading-relaxed">
                * Ce contact sera directement ajouté à l'annuaire partagé d'Hélène et Matthieu.
              </p>

              <div className="pt-4 border-t border-slate-800/80 flex justify-end space-x-3">
                <button
                  type="button"
                  onClick={() => setIsAdding(false)}
                  className="px-4 py-2 text-xs font-semibold text-slate-300 bg-slate-800 border border-slate-700 rounded-lg hover:bg-slate-700 transition-colors cursor-pointer"
                  disabled={isSubmitting}
                >
                  Annuler
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="px-4 py-2 text-xs font-bold text-white bg-purple-600 hover:bg-purple-500 border border-transparent rounded-lg focus:ring-2 focus:ring-offset-2 focus:ring-offset-slate-950 focus:ring-purple-500 transition-colors"
                >
                  {isSubmitting ? (
                    'Création...'
                  ) : (
                    'Enregistrer'
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
