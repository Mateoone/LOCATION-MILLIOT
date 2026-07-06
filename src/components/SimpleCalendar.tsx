import React, { useMemo, useState, useEffect } from 'react';
import { SheetData, ReservationRow, SheetLocation, addSheetRow } from '../lib/sheets';
import { parse, isValid, format, differenceInDays } from 'date-fns';
import { fr } from 'date-fns/locale';
import { ChevronDown, ChevronRight, Euro, Moon, Link, Plus, Loader2 } from 'lucide-react';
import { IcalEvent } from '../lib/ical';
import { addEventToGoogleCalendar } from '../lib/calendarApi';

interface CalendarProps {
  data: SheetData;
  location: SheetLocation;
  externalEvents: IcalEvent[];
  loadingExternal: boolean;
  onExternalAdded: (evt: IcalEvent) => void;
  onCellClick: (row: ReservationRow) => void;
  onReload: () => void;
}

export function SimpleCalendar({ data, location, externalEvents, loadingExternal, onExternalAdded, onCellClick, onReload }: CalendarProps) {
  const [expandedYears, setExpandedYears] = useState<Record<string, boolean>>({});
  const [syncing, setSyncing] = useState(false);
  const [pushing, setPushing] = useState(false);

  const startHeader = useMemo(() => {
    return data.headers.find(h => /début|debut|arrivée|arrivee|start/i.test(h)) || 
           data.headers.find(h => /date/i.test(h));
  }, [data.headers]);

  const endHeader = useMemo(() => {
    return data.headers.find(h => /fin|départ|depart|end/i.test(h));
  }, [data.headers]);

  const nameHeader = useMemo(() => {
    return data.headers.find(h => /nom|locataire|client|name/i.test(h)) || data.headers[0];
  }, [data.headers]);

  const priceHeader = useMemo(() => {
    return data.headers.find(h => /prix|loyer|total|montant|tarif/i.test(h));
  }, [data.headers]);

  const sourceHeader = useMemo(() => {
    return data.headers.find(h => /source|plateforme|origine/i.test(h));
  }, [data.headers]);

  const parseDateStr = (dateStr: string) => {
    if (!dateStr) return null;
    let parsed = parse(dateStr, 'dd/MM/yyyy', new Date());
    if (!isValid(parsed)) parsed = new Date(dateStr);
    return isValid(parsed) ? parsed : null;
  };

  const events = useMemo(() => {
    if (!startHeader) return [];

    return data.rows.map(row => {
      const startStr = row[startHeader];
      const endStr = endHeader ? row[endHeader] : null;
      
      const start = parseDateStr(startStr);
      const end = endStr ? parseDateStr(endStr) : null;

      if (!start) return null;
      
      const days = end ? differenceInDays(end, start) : 1;
      
      let priceStr = null;
      if (priceHeader && row[priceHeader]) {
        const val = row[priceHeader];
        // clean up currency symbols, keep numbers and decimals
        const cleanNum = val.replace(/[^\d.,-]/g, '').trim();
        if (cleanNum) priceStr = cleanNum;
      }

      let sourceStr = null;
      if (sourceHeader && row[sourceHeader]) {
        sourceStr = row[sourceHeader];
      }

      return {
        row,
        start,
        end: end || start,
        title: row[nameHeader] || 'Réservation',
        days: days > 0 ? days : 1,
        price: priceStr,
        source: sourceStr
      };
    }).filter(Boolean) as { row: ReservationRow, start: Date, end: Date, title: string, days: number, price: string | null, source: string | null }[];
  }, [data.rows, startHeader, endHeader, nameHeader, priceHeader, sourceHeader]);

  if (!startHeader) {
    return (
      <div className="border border-slate-800 rounded-xl bg-slate-950/50 p-8 text-center text-slate-500 flex-1 flex flex-col items-center justify-center shadow-lg">
        <p className="font-semibold text-slate-300 mb-2">Affichage du Calendrier impossible</p>
        <p className="text-sm">Impossible de trouver une colonne de date (ex: "Date de début", "Arrivée") dans cet onglet.</p>
      </div>
    );
  }

  const now = new Date();
  
  // Sort all events chronologically
  const sortedEvents = [...events].sort((a, b) => a.start.getTime() - b.start.getTime());
  
  const upcomingEvents = sortedEvents.filter(e => e.end >= now);
  const pastEvents = sortedEvents.filter(e => e.end < now);

  const unsyncedExternal = useMemo(() => {
    return externalEvents.filter(ext => {
      // Règles de dispo Airbnb (délai mini, calendrier fermé…) : pas des résas.
      if (ext.kind === 'unavailable') return false;
      if (ext.end < now) return false; // Only care about syncing upcoming dates typically
      const hasOverlap = events.some(int => {
        return ext.start < int.end && int.start < ext.end;
      });
      return !hasOverlap;
    }).sort((a, b) => a.start.getTime() - b.start.getTime());
  }, [events, externalEvents, now]);

  const unsyncedInternal = useMemo(() => {
    return upcomingEvents.filter(int => {
      const hasOverlap = externalEvents.some(ext => {
        return int.start < ext.end && ext.start < int.end;
      });
      return !hasOverlap;
    });
  }, [upcomingEvents, externalEvents]);

  const handlePushToCalendar = async (evt: typeof events[0]) => {
    if (pushing) return;
    try {
      setPushing(true);
      await addEventToGoogleCalendar(location, evt.start, evt.end, evt.title);
      
      // On répercute immédiatement l'ajout dans l'état parent pour que
      // l'UI se mette à jour sans re-télécharger le calendrier.
      onExternalAdded({ start: evt.start, end: evt.end, summary: evt.title, kind: 'reservation', origin: 'google' });
      
      alert(`Les dates ${format(evt.start, 'dd/MM/yyyy')} ➔ ${format(evt.end, 'dd/MM/yyyy')} ont été bloquées sur Airbnb avec succès (via Google Agenda).`);
    } catch (e: any) {
      let msg = e.message;
      if (msg.includes("writer access") || msg.includes("403")) {
        msg = "Vous n'avez pas les droits d'écriture sur cet agenda Google.\n\nVeuillez demander au propriétaire de l'agenda de le partager avec votre adresse email avec le niveau d'autorisation 'Apporter des modifications aux événements'.";
      } else {
        msg += "\n\nAssurez-vous d'avoir accepté les permissions d'agenda lors de la connexion.";
      }
      alert("Erreur lors de l'ajout au calendrier Google:\n\n" + msg);
    } finally {
      setPushing(false);
    }
  };

  const handleSyncToSheet = async (ext: IcalEvent) => {
    if (syncing) return;
    try {
      setSyncing(true);
      const newRow = new Array(data.headers.length).fill("");
      
      const stIdx = data.headers.findIndex(h => h === startHeader);
      const edIdx = data.headers.findIndex(h => h === endHeader);
      const nmIdx = data.headers.findIndex(h => h === nameHeader);
      const prIdx = data.headers.findIndex(h => h === priceHeader);
      const srcIdx = data.headers.findIndex(h => h === sourceHeader);
      
      if (stIdx !== -1) newRow[stIdx] = format(ext.start, 'dd/MM/yyyy');
      if (edIdx !== -1) newRow[edIdx] = format(ext.end, 'dd/MM/yyyy');
      if (nmIdx !== -1) newRow[nmIdx] = ext.summary || "Blocage externe";
      if (prIdx !== -1) newRow[prIdx] = "";
      if (srcIdx !== -1) newRow[srcIdx] = "Airbnb Externe";
      
      await addSheetRow(location, newRow);
      onReload(); // Trigger generic reload for this view
    } catch (e: any) {
      alert("Erreur lors de l'ajout au tableur: " + e.message);
    } finally {
      setSyncing(false);
    }
  };

  // Group past events by year, sorted newest year first
  const pastByYear = pastEvents.reduce((acc, curr) => {
    const year = curr.start.getFullYear().toString();
    if (!acc[year]) acc[year] = [];
    acc[year].push(curr);
    return acc;
  }, {} as Record<string, typeof pastEvents>);

  const years = Object.keys(pastByYear).sort((a, b) => parseInt(b) - parseInt(a));

  const toggleYear = (year: string) => {
    setExpandedYears(prev => ({ ...prev, [year]: !prev[year] }));
  };

  const EventCard = ({ evt, isPast }: { evt: typeof events[0], isPast: boolean, key?: string }) => {
    const isMilliot = /milliot/i.test(evt.title || '');
    const indicatorColor = isPast 
      ? 'bg-slate-700' 
      : isMilliot 
        ? 'bg-purple-500 shadow-[0_0_10px_rgba(168,85,247,0.3)]' 
        : 'bg-indigo-500 shadow-[0_0_10px_rgba(99,102,241,0.3)]';

    return (
      <div 
        onClick={() => onCellClick(evt.row)}
        className={`flex flex-col md:flex-row md:items-center justify-between p-4 rounded-xl border transition-all cursor-pointer group hover:bg-slate-900/40 ${isPast ? 'bg-slate-950/60 border-slate-800/50 opacity-60 hover:opacity-100' : 'bg-slate-900/30 border-slate-800 hover:border-indigo-500/50'}`}
      >
        <div className="flex items-center space-x-4">
          <div className={`w-1.5 h-12 rounded-full shrink-0 ${indicatorColor}`}></div>
          <div>
            <div className="flex items-center gap-2">
              <h4 className={`font-semibold text-sm md:text-base ${isPast ? 'text-slate-400' : 'text-slate-200'}`}>{evt.title || 'Inconnu'}</h4>
              {isMilliot && (
                <span className="text-[9px] font-bold px-2 py-0.5 rounded-full bg-purple-500/20 text-purple-300 border border-purple-500/30 uppercase tracking-wide">
                  Famille
                </span>
              )}
            </div>
            <p className="text-xs text-slate-500 mt-1 font-mono">
              {format(evt.start, 'dd MMM yyyy', { locale: fr })}
              {evt.end && evt.end.getTime() !== evt.start.getTime() && (
                <> <span className="mx-2 text-slate-600">→</span> {format(evt.end, 'dd MMM yyyy', { locale: fr })} </>
              )}
            </p>
          </div>
        </div>
        
        <div className="mt-4 md:mt-0 ml-5 md:ml-4 flex items-center flex-wrap gap-2">
          <div className="flex items-center gap-1.5 px-2.5 py-1 rounded bg-slate-900 border border-slate-800 text-slate-400 text-xs font-medium">
            <Moon className="w-3 h-3 text-slate-500" />
            <span>{evt.days} {evt.days > 1 ? 'nuits' : 'nuit'}</span>
          </div>
          {evt.price && (
            <div className="flex items-center gap-1 px-2.5 py-1 rounded bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-xs font-mono font-medium">
              <span>{evt.price}</span>
              <Euro className="w-3 h-3" />
            </div>
          )}
          <span className={`ml-auto md:ml-2 text-[10px] font-bold uppercase px-3 py-1.5 rounded-md border transition-colors ${isPast ? 'bg-slate-900/50 border-slate-800 text-slate-600' : 'bg-slate-900 border-slate-700 text-indigo-400 group-hover:bg-indigo-500/10 group-hover:border-indigo-500/30'}`}>
            Gérer
          </span>
        </div>
      </div>
    );
  };

  return (
    <div className="border border-slate-800 rounded-xl bg-slate-950/50 flex-1 flex flex-col overflow-hidden shadow-lg h-full">
      <div className="px-6 py-4 border-b border-slate-800 bg-slate-900/80 shrink-0 flex justify-between items-start">
        <div>
          <h3 className="text-sm font-semibold uppercase text-slate-400 tracking-wider">Réservations à venir</h3>
          <p className="text-xs text-slate-500 mt-1">Cliquez sur une ligne pour en éditer les détails ou gérer le paiement.</p>
        </div>
        {loadingExternal && (
          <div className="flex items-center text-xs text-indigo-400 bg-indigo-500/10 px-2 py-1 rounded-md border border-indigo-500/20">
            <Loader2 className="w-3 h-3 mr-1.5 animate-spin" />
            Vérification Airbnb...
          </div>
        )}
      </div>
      <div className="flex-1 overflow-y-auto p-4 space-y-8">
        
        {/* Unsynced External Events section */}
        {unsyncedExternal.length > 0 && (
          <div className="bg-rose-950/20 border border-rose-900/50 rounded-xl p-4">
            <h3 className="text-xs font-bold uppercase text-rose-500 tracking-widest mb-4 flex items-center gap-2">
              <Link className="w-4 h-4" />
              Dates bloquées sur Airbnb (non synchronisées)
            </h3>
            <div className="space-y-3">
              {unsyncedExternal.map((ext, i) => (
                <div key={`ext-${i}`} className="flex flex-col sm:flex-row sm:items-center justify-between p-3 rounded-lg border border-rose-900/30 bg-rose-950/30">
                  <div className="flex items-center gap-3">
                    <div className="w-1.5 h-10 rounded-full bg-rose-500 shrink-0"></div>
                    <div>
                      <h4 className="font-semibold text-sm text-rose-200">{ext.summary.trim() || 'Airbnb'}</h4>
                      <p className="text-xs text-rose-400/80 mt-0.5 font-mono">
                        {format(ext.start, 'dd MMM yyyy', { locale: fr })}
                        {ext.end && ext.end.getTime() !== ext.start.getTime() && (
                          <> <span className="mx-1 opacity-50">→</span> {format(ext.end, 'dd MMM yyyy', { locale: fr })} </>
                        )}
                      </p>
                    </div>
                  </div>
                  <button
                    onClick={() => handleSyncToSheet(ext)}
                    disabled={syncing}
                    className="mt-3 sm:mt-0 px-3 py-1.5 bg-rose-500/20 hover:bg-rose-500/30 text-rose-300 rounded text-xs tracking-wide font-medium transition-colors border border-rose-500/30 flex items-center justify-center gap-1.5 focus:outline-none focus:ring-2 focus:ring-rose-500/50 disabled:opacity-50"
                  >
                    {syncing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
                    Ajouter au Google Sheet
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Unsynced Internal Events section */}
        {unsyncedInternal.length > 0 && (
          <div className="bg-indigo-950/20 border border-indigo-900/50 rounded-xl p-4 mt-8">
            <h3 className="text-xs font-bold uppercase text-indigo-400 tracking-widest mb-4 flex items-center gap-2">
              <Link className="w-4 h-4" />
              Dates non synchronisées avec Google Agenda (non visibles Airbnb)
            </h3>
            <div className="space-y-3">
              {unsyncedInternal.map((intEvt, i) => (
                <div key={`int-${i}`} className="flex flex-col sm:flex-row sm:items-center justify-between p-3 rounded-lg border border-indigo-900/30 bg-indigo-950/30">
                  <div className="flex items-center gap-3">
                    <div className="w-1.5 h-10 rounded-full bg-indigo-500 shrink-0"></div>
                    <div>
                      <h4 className="font-semibold text-sm text-indigo-200">{intEvt.title || 'Réservation'}</h4>
                      <p className="text-xs text-indigo-400/80 mt-0.5 font-mono">
                        {format(intEvt.start, 'dd MMM yyyy', { locale: fr })}
                        {intEvt.end && intEvt.end.getTime() !== intEvt.start.getTime() && (
                          <> <span className="mx-1 opacity-50">→</span> {format(intEvt.end, 'dd MMM yyyy', { locale: fr })} </>
                        )}
                      </p>
                    </div>
                  </div>
                  <button
                    onClick={() => handlePushToCalendar(intEvt)}
                    disabled={pushing}
                    className="mt-3 sm:mt-0 px-3 py-1.5 bg-indigo-500/20 hover:bg-indigo-500/30 text-indigo-300 rounded text-xs tracking-wide font-medium transition-colors border border-indigo-500/30 flex items-center justify-center gap-1.5 focus:outline-none focus:ring-2 focus:ring-indigo-500/50 disabled:opacity-50"
                  >
                    {pushing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
                    Bloquer sur Airbnb
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Upcoming Events section */}
        <div className="pt-4">
          {upcomingEvents.length === 0 ? (
            <div className="p-8 text-center text-slate-500 text-sm bg-slate-900/30 rounded-xl border border-slate-800/50 block">Aucune réservation à venir.</div>
          ) : (
            <div className="space-y-3">
              {upcomingEvents.map((evt, i) => (
                <EventCard key={`up-${i}`} evt={evt} isPast={false} />
              ))}
            </div>
          )}
        </div>

        {/* Past Events section (grouped by year) */}
        {years.length > 0 && (
          <div className="pt-4 border-t border-slate-800/80">
            <h3 className="text-xs font-bold uppercase text-slate-500 tracking-widest mb-4">Anciennes Locations</h3>
            <div className="space-y-4">
              {years.map(year => {
                const isExpanded = expandedYears[year] || false;
                const yearEvents = pastByYear[year];
                
                const totalNuits = yearEvents.reduce((acc, evt) => acc + evt.days, 0);
                const nuitsPayees = yearEvents.reduce((acc, evt) => acc + ((evt.price && !/milliot/i.test(evt.title || '')) ? evt.days : 0), 0);
                const nuitsPerso = yearEvents.reduce((acc, evt) => acc + ((!evt.price || /milliot/i.test(evt.title || '')) ? evt.days : 0), 0);
                const airbnbNuits = yearEvents.reduce((acc, evt) => acc + ((/airbnb/i.test(evt.source || '') && !/milliot/i.test(evt.title || '')) ? evt.days : 0), 0);
                
                return (
                  <div key={year} className="border border-slate-800/60 rounded-xl overflow-hidden bg-slate-900/20">
                    <button 
                      onClick={() => toggleYear(year)}
                      className="w-full flex flex-col md:flex-row md:items-center justify-between p-4 bg-slate-900/50 hover:bg-slate-900 transition-colors text-left"
                    >
                      <div className="flex items-center gap-3 mb-3 md:mb-0">
                        <span className="font-mono text-lg font-bold text-slate-400">{year}</span>
                        <span className="text-xs font-medium text-slate-500 bg-slate-800 px-2 py-0.5 rounded-full">{yearEvents.length} séjours</span>
                      </div>
                      <div className="flex flex-wrap items-center gap-4 text-xs font-medium text-slate-400">
                        <div className="flex flex-col">
                          <span className="text-slate-500 uppercase text-[9px] tracking-wider font-bold">Nuits Louées</span>
                          <span className="font-mono text-emerald-400">{nuitsPayees}</span>
                        </div>
                        <div className="flex flex-col">
                          <span className="text-slate-500 uppercase text-[9px] tracking-wider font-bold">Nuits Perso</span>
                          <span className="font-mono text-indigo-400">{nuitsPerso}</span>
                        </div>
                        <div className="flex flex-col hidden sm:flex">
                          <span className="text-slate-500 uppercase text-[9px] tracking-wider font-bold">Airbnb</span>
                          <span className="font-mono text-rose-400">{airbnbNuits} nuits</span>
                        </div>
                        <div className="flex flex-col">
                          <span className="text-slate-500 uppercase text-[9px] tracking-wider font-bold">Jours Loués</span>
                          <span className="font-mono text-emerald-400">{nuitsPayees + yearEvents.filter(e => e.price).length} jours</span>
                        </div>
                        <div className="ml-0 sm:ml-2">
                          {isExpanded ? <ChevronDown className="w-5 h-5 text-slate-500" /> : <ChevronRight className="w-5 h-5 text-slate-500" />}
                        </div>
                      </div>
                    </button>
                    
                    {isExpanded && (
                      <div className="p-4 pt-2 space-y-3 border-t border-slate-800/50">
                        {yearEvents.map((evt, i) => (
                          <EventCard key={`past-${year}-${i}`} evt={evt} isPast={true} />
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

      </div>
    </div>
  );
}
