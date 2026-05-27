import React, { useState, useEffect, useMemo } from 'react';
import { ReservationRow, SheetLocation, updateSheetRow } from '../lib/sheets';
import { X, Loader2, Mail, Phone } from 'lucide-react';
import { fetchGoogleContacts, GoogleContact } from '../lib/contacts';
import { getAccessToken } from '../lib/auth';

interface EditRowModalProps {
  row: ReservationRow;
  headers: string[];
  location: SheetLocation;
  onClose: () => void;
  onSaved: () => void;
}

export function EditRowModal({ row, headers, location, onClose, onSaved }: EditRowModalProps) {
  const [formData, setFormData] = useState<Record<string, string>>(() => {
    const initial: Record<string, string> = {};
    headers.forEach(h => initial[h] = row[h] || '');
    return initial;
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Google Contacts autocomplete states
  const [contacts, setContacts] = useState<GoogleContact[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);

  useEffect(() => {
    async function loadContactsSuggestions() {
      try {
        const list = await fetchGoogleContacts();
        setContacts(list);
      } catch (err) {
        console.warn("Failed to load contacts suggestions:", err);
      }
    }
    loadContactsSuggestions();
  }, []);

  // Determine the primary name field key inside formData
  const nameFieldKey = useMemo(() => {
    return headers.find(h => /nom|locataire|client|name/i.test(h) && !/tél|phone|email/i.test(h)) || '';
  }, [headers]);

  // Filter contacts by current typed guest name value
  const filteredSuggestions = useMemo(() => {
    if (!nameFieldKey) return [];
    const val = formData[nameFieldKey] || '';
    if (!val.trim()) return contacts.slice(0, 5); // Show first 5 contacts by default
    const q = val.toLowerCase();
    return contacts.filter(c => c.name.toLowerCase().includes(q));
  }, [contacts, formData, nameFieldKey]);

  const handleSelectContact = (contact: GoogleContact, hKey: string) => {
    setFormData(prev => {
      const next = { ...prev, [hKey]: contact.name };
      // Auto-fill phone & email fields if they are empty
      headers.forEach(h => {
        if (/tel|tél|phone/i.test(h) && !next[h] && contact.phone) {
          next[h] = contact.phone;
        }
        if (/email|mail/i.test(h) && !next[h] && contact.email) {
          next[h] = contact.email;
        }
      });
      return next;
    });
    setShowSuggestions(false);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    try {
      setSaving(true);
      setError(null);
      await updateSheetRow(location, row.rowIndex, headers, formData);
      onSaved();
    } catch (err: any) {
      setError(err.message || "Erreur lors de la sauvegarde.");
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-sm p-4">
      <div className="bg-slate-900 border border-slate-800 rounded-2xl shadow-xl shadow-black/50 w-full max-w-2xl max-h-[90vh] flex flex-col overflow-hidden text-slate-100 font-sans">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800/80 bg-slate-950/50">
          <h3 className="text-lg font-bold text-white tracking-tight">Modifier la Réservation</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-white hover:bg-slate-800 transition-colors p-1.5 rounded-lg">
            <X className="w-5 h-5" />
          </button>
        </div>
        
        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-6 bg-slate-900">
          {error && (
            <div className="mb-6 p-4 bg-red-950/30 border border-red-900/50 rounded-xl text-sm flex items-center text-red-200">
              <span className="font-bold uppercase tracking-wider text-[10px] bg-red-900/50 px-2 py-0.5 rounded text-red-400 mr-3">Erreur</span> {error}
            </div>
          )}
          
          <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-5">
            {headers.map(header => {
              const isNameField = header === nameFieldKey;
              
              return (
                <div key={header} className="space-y-1.5 relative">
                  <label className="block text-xs font-bold text-slate-400 uppercase tracking-widest flex items-center justify-between">
                    <span>{header}</span>
                    {isNameField && (
                      <span className="text-[9px] text-purple-400 bg-purple-500/10 px-1.5 py-0.5 rounded normal-case font-bold border border-purple-500/25">
                        Contacts Google actifs
                      </span>
                    )}
                  </label>
                  
                  {isNameField ? (
                    <div className="relative">
                      <input
                        type="text"
                        value={formData[header]}
                        onChange={e => {
                          setFormData(prev => ({ ...prev, [header]: e.target.value }));
                          setShowSuggestions(true);
                        }}
                        onFocus={() => setShowSuggestions(true)}
                        className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg focus:ring-1 focus:ring-indigo-500 focus:border-indigo-500 text-sm text-slate-200 outline-none transition-shadow"
                        placeholder={`Saisir ${header}`}
                      />
                      
                      {showSuggestions && filteredSuggestions.length > 0 && (
                        <div className="absolute left-0 right-0 mt-1 max-h-48 overflow-y-auto bg-slate-950 border border-slate-800 rounded-lg shadow-xl shadow-black/80 z-50 divide-y divide-slate-850">
                          <div className="px-2.5 py-1 text-[10px] font-bold text-purple-400 bg-purple-950/20 uppercase tracking-wider flex justify-between items-center">
                            <span>Google Contacts</span>
                            <button 
                              type="button"
                              onClick={(e) => { e.stopPropagation(); setShowSuggestions(false); }}
                              className="text-slate-500 hover:text-white px-1 py-0.5 rounded"
                            >
                              Fermer
                            </button>
                          </div>
                          {filteredSuggestions.map(contact => (
                            <div
                              key={contact.resourceName}
                              onClick={() => handleSelectContact(contact, header)}
                              className="p-2 hover:bg-slate-900 cursor-pointer flex items-center justify-between text-left transition-colors"
                            >
                              <div className="min-w-0 pr-2">
                                <p className="text-xs font-bold text-slate-200 truncate">{contact.name}</p>
                                <div className="flex items-center space-x-2 mt-0.5">
                                  {contact.phone && (
                                    <span className="text-[9px] text-slate-500 flex items-center font-mono">
                                      <Phone className="w-2.5 h-2.5 mr-0.5" />
                                      {contact.phone}
                                    </span>
                                  )}
                                  {contact.email && (
                                    <span className="text-[9px] text-slate-500 flex items-center font-mono truncate max-w-[120px]">
                                      <Mail className="w-2.5 h-2.5 mr-0.5" />
                                      {contact.email}
                                    </span>
                                  )}
                                </div>
                              </div>
                              <span className="text-[9px] font-bold text-purple-400 bg-purple-500/10 px-1.5 py-0.5 rounded border border-purple-500/20 shrink-0">
                                Lier + Remplir
                              </span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  ) : (
                    <input
                      type="text"
                      value={formData[header]}
                      onChange={e => setFormData(prev => ({ ...prev, [header]: e.target.value }))}
                      className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg focus:ring-1 focus:ring-indigo-500 focus:border-indigo-500 text-sm text-slate-200 outline-none transition-shadow"
                      placeholder={`Saisir ${header}`}
                    />
                  )}
                </div>
              );
            })}
          </div>
        </form>

        <div className="px-6 py-4 border-t border-slate-800/80 bg-slate-950/50 flex justify-end space-x-3">
          <button
            type="button"
            onClick={onClose}
            className="px-5 py-2 text-sm font-medium text-slate-300 bg-slate-800 border border-slate-700 rounded-lg hover:bg-slate-700 transition-colors"
            disabled={saving}
          >
            Annuler
          </button>
          <button
            onClick={handleSubmit}
            disabled={saving}
            className="px-5 py-2 text-sm font-bold text-white bg-indigo-600 border border-transparent rounded-lg hover:bg-indigo-500 focus:ring-2 focus:ring-offset-2 focus:ring-offset-slate-950 focus:ring-indigo-500 transition-colors flex items-center"
          >
            {saving ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Enregistrement...
              </>
            ) : (
              'Enregistrer'
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
