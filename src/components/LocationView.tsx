import React, { useState, useEffect, useMemo, Suspense, lazy } from 'react';
import { format } from 'date-fns';
import { SheetLocation, SheetData, fetchSheetData, updateSheetRow, ReservationRow } from '../lib/sheets';
import { Calendar, CreditCard, Edit3, ArrowUpDown, Check, X, Phone, Globe, Briefcase, MapPin, List, RefreshCw, Search, FileText, Loader2, Pencil } from 'lucide-react';
import { EditRowModal } from './EditRowModal';
import { SimpleCalendar } from './SimpleCalendar';
import { AnnualCalendar } from './AnnualCalendar';

// Chargés à la demande : recharts (~graphiques) et react-pdf (~contrats) sont
// lourds et rarement utilisés — on les sort du bundle initial.
const LocationStats = lazy(() => import('./LocationStats').then(m => ({ default: m.LocationStats })));
const ContractModal = lazy(() => import('./contracts/ContractModal').then(m => ({ default: m.ContractModal })));

const LazyFallback = () => (
  <div className="flex-1 flex items-center justify-center text-slate-500 gap-2 py-12">
    <Loader2 className="w-4 h-4 animate-spin" /> Chargement…
  </div>
);
import { BarChart as BarChartIcon, AlertTriangle } from 'lucide-react';
import { fetchCalendarsWithStatus, IcalEvent, CalendarSourceStatus } from '../lib/ical';
import { buildBookings, findConflicts, detectHeaders, UnifiedBooking } from '../lib/bookings';
import { AUTH_RESTORED_EVENT } from '../lib/auth';

function timeAgo(d: Date | null): string {
  if (!d) return '—';
  const mins = Math.round((Date.now() - d.getTime()) / 60000);
  if (mins < 1) return "à l'instant";
  if (mins < 60) return `il y a ${mins} min`;
  const h = Math.round(mins / 60);
  if (h < 24) return `il y a ${h} h`;
  const j = Math.round(h / 24);
  return `il y a ${j} j`;
}

const TableCell = ({ header, val }: { header: string, val: string }) => {
  const [showPhone, setShowPhone] = useState(false);
  if (!val) return null;
  const upperVal = val.toUpperCase().trim();

  if (['TRUE', 'VRAI', 'OUI'].includes(upperVal)) return <Check className="w-4 h-4 text-emerald-500" />;
  if (['FALSE', 'FAUX', 'NON'].includes(upperVal)) return <X className="w-4 h-4 text-rose-500" />;
  
  if (/tel|tél|phone/i.test(header)) {
    if (showPhone) return <span className="font-mono text-slate-300 whitespace-nowrap">{val}</span>;
    return (
      <button onClick={() => setShowPhone(true)} className="flex items-center text-xs text-indigo-400 hover:text-indigo-300 transition-colors bg-indigo-500/10 border border-indigo-500/20 px-2 py-1 rounded">
        <Phone className="w-3 h-3 mr-1.5" />
        Voir
      </button>
    );
  }

  if (/source|plateforme|origine/i.test(header)) {
    if (/airbnb/i.test(val)) return <div className="flex items-center gap-1.5 text-rose-400" title={val}><MapPin className="w-4 h-4"/><span className="text-[10px] font-bold uppercase tracking-wider">Airbnb</span></div>;
    if (/booking/i.test(val)) return <div className="flex items-center gap-1.5 text-sky-400" title={val}><Briefcase className="w-4 h-4"/><span className="text-[10px] font-bold uppercase tracking-wider">Booking</span></div>;
    return <div className="flex items-center gap-1.5 text-slate-400" title={val}><Globe className="w-4 h-4"/><span className="text-[10px] font-bold uppercase tracking-wider">{val}</span></div>;
  }

  if (/prix|loyer|total|montant|tarif/i.test(header) && /\d/.test(val)) {
    const cleanNum = val.replace(/[^\d.,-]/g, '').trim();
    if (cleanNum) return <span className="px-2 py-0.5 bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 rounded text-xs font-mono font-medium whitespace-nowrap">{cleanNum} €</span>;
  }

  return <span className="truncate max-w-[200px] block" title={val}>{val}</span>;
};

export function LocationView({ location }: { location: SheetLocation }) {
  const [data, setData] = useState<SheetData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<'table' | 'calendar' | 'recap' | 'graph'>('calendar');
  const [editingRow, setEditingRow] = useState<ReservationRow | null>(null);
  const [contractRow, setContractRow] = useState<ReservationRow | null>(null);
  const [sortCol, setSortCol] = useState<string | null>(null);
  const [sortAsc, setSortAsc] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [externalEvents, setExternalEvents] = useState<IcalEvent[]>([]);
  const [sources, setSources] = useState<CalendarSourceStatus[]>([]);
  const [loadingExternal, setLoadingExternal] = useState(false);

  const [syncedAt, setSyncedAt] = useState<Date | null>(null);

  // Fetch Airbnb/Google calendar events (and per-source status). Réutilisé par
  // le clic sur les capsules de statut pour relancer une synchro à la demande.
  const loadIcal = React.useCallback(async () => {
    try {
      setLoadingExternal(true);
      const { events, sources } = await fetchCalendarsWithStatus(location);
      setExternalEvents(events);
      setSources(sources);
      setSyncedAt(new Date());
    } catch (err) {
      console.warn("Failed to load external calendar:", err);
      setSources([]);
    } finally {
      setLoadingExternal(false);
    }
  }, [location]);

  useEffect(() => {
    loadIcal();
    window.addEventListener(AUTH_RESTORED_EVENT, loadIcal);
    return () => {
      window.removeEventListener(AUTH_RESTORED_EVENT, loadIcal);
    };
  }, [loadIcal]);

  // Resynchronisation complète (agendas + tableau) au clic sur une capsule.
  const syncNow = () => {
    if (loadingExternal) return;
    loadIcal();
    loadData();
  };

  const loadData = async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await fetchSheetData(location);
      
      // Filter out rows that do not start with a date in the first column
      if (res && res.headers.length > 0) {
        const firstHeader = res.headers[0];
        res.rows = res.rows.filter(row => {
          const val = row[firstHeader];
          if (!val) return false;
          // Match standard date formats like DD/MM/YYYY or YYYY-MM-DD
          return /^\d{1,4}[\/\-]\d{1,2}[\/\-]\d{1,4}/.test(val.trim());
        });
        
        // Default to sorting by the first column (the date column) descending (newest on top)
        setSortCol(firstHeader);
        setSortAsc(false);
      }

      setData(res);
    } catch (err: any) {
      setError(err.message || 'Failed to load data');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
    // Set initial sort state (which gets confirmed when data loads)
    setSortCol(null);
    setSortAsc(false);
    window.addEventListener(AUTH_RESTORED_EVENT, loadData);
    return () => window.removeEventListener(AUTH_RESTORED_EVENT, loadData);
  }, [location]);

  // Chevauchements actuels/à venir (le filtre "période passée" est dans findConflicts).
  const conflicts = useMemo(() => {
    if (!data || data.headers.length === 0) return [];
    return findConflicts(buildBookings(data, location, externalEvents));
  }, [data, location, externalEvents]);

  const [aligning, setAligning] = useState(false);

  // Résolution d'un conflit Sheet ↔ Airbnb : Airbnb fait foi (impossible à
  // modifier à distance), on réécrit les dates de la ligne du tableau.
  const handleAlignToAirbnb = async (sheetBooking: UnifiedBooking, ext: UnifiedBooking) => {
    if (!data || !sheetBooking.row || aligning) return;
    const { startHeader, endHeader } = detectHeaders(data.headers);
    if (!startHeader || !endHeader) {
      alert("Impossible de trouver les colonnes de dates (début/fin) dans le tableau.");
      return;
    }
    const newStart = format(ext.start, 'dd/MM/yyyy');
    const newEnd = format(ext.end, 'dd/MM/yyyy');
    const oldStart = sheetBooking.row[startHeader] || '?';
    const oldEnd = sheetBooking.row[endHeader] || '?';
    if (!window.confirm(
      `Caler « ${sheetBooking.title} » sur les dates Airbnb ?\n\n` +
      `Tableau actuel : ${oldStart} → ${oldEnd}\n` +
      `Airbnb :        ${newStart} → ${newEnd}\n\n` +
      `La ligne du Google Sheet sera mise à jour.`
    )) return;
    try {
      setAligning(true);
      const updated: Record<string, string> = {};
      data.headers.forEach(h => { updated[h] = sheetBooking.row![h] || ''; });
      updated[startHeader] = newStart;
      updated[endHeader] = newEnd;
      await updateSheetRow(location, sheetBooking.row.rowIndex, data.headers, updated, data.rawHeaders);
      await loadData();
    } catch (e: any) {
      alert('Échec de la mise à jour du tableau : ' + (e.message || e));
    } finally {
      setAligning(false);
    }
  };

  const sortedRows = useMemo(() => {
    if (!data) return [];
    const rows = [...data.rows];
    if (!sortCol) return rows;
    
    return rows.sort((a, b) => {
      const aVal = a[sortCol] || '';
      const bVal = b[sortCol] || '';
      
      // Robust date parsing heuristic
      const parseDateStr = (str: string) => {
        if (!str) return NaN;
        const cleaned = str.trim();
        // Check for DD/MM/YYYY or DD-MM-YYYY
        const dmyMatch = cleaned.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/);
        if (dmyMatch) {
          return new Date(parseInt(dmyMatch[3]), parseInt(dmyMatch[2]) - 1, parseInt(dmyMatch[1])).getTime();
        }
        // Check for YYYY-MM-DD or YYYY/MM/DD
        const ymdMatch = cleaned.match(/^(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})/);
        if (ymdMatch) {
          return new Date(parseInt(ymdMatch[1]), parseInt(ymdMatch[2]) - 1, parseInt(ymdMatch[3])).getTime();
        }
        const time = Date.parse(cleaned);
        return isNaN(time) ? NaN : time;
      };

      const dateA = parseDateStr(aVal);
      const dateB = parseDateStr(bVal);

      if (!isNaN(dateA) && !isNaN(dateB)) {
        return sortAsc ? dateA - dateB : dateB - dateA;
      }

      // Basic number parsing
      const numA = parseFloat(aVal.replace(/[^0-9.-]+/g, ""));
      const numB = parseFloat(bVal.replace(/[^0-9.-]+/g, ""));
      
      // Only treat as number if it actually contains digits and doesn't look like a phone number (checking length/spaces can be tricky, so this is minimal)
      if (!isNaN(numA) && !isNaN(numB) && /\d/.test(aVal) && /\d/.test(bVal) && !/tel|phone/i.test(sortCol)) {
        return sortAsc ? numA - numB : numB - numA;
      }
      
      return sortAsc ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal);
    });
  }, [data, sortCol, sortAsc]);

  const handleSort = (header: string) => {
    if (sortCol === header) {
      setSortAsc(!sortAsc);
    } else {
      setSortCol(header);
      setSortAsc(true);
    }
  };

  // Une ligne Airbnb « à compléter » : source Airbnb + nom ou prix manquant
  // (les dates viennent de l'iCal, le nom et le prix se saisissent à la main).
  const rowNeedsCompletion = useMemo(() => {
    if (!data) return () => false;
    const { sourceHeader, nameHeader, priceHeader } = detectHeaders(data.headers);
    return (row: ReservationRow): boolean => {
      const src = sourceHeader ? String(row[sourceHeader] || '') : '';
      if (!/airbnb/i.test(src)) return false;
      const nameVal = nameHeader ? String(row[nameHeader] || '').trim() : '';
      const priceVal = priceHeader ? String(row[priceHeader] || '').trim() : '';
      const nameMissing = !nameVal || /^(reserved|airbnb|blocage|voyageur airbnb|indisponible|not available)/i.test(nameVal);
      const priceMissing = !!priceHeader && (!priceVal || !/\d/.test(priceVal));
      return nameMissing || priceMissing;
    };
  }, [data]);

  const toCompleteCount = useMemo(
    () => (data ? data.rows.filter(rowNeedsCompletion).length : 0),
    [data, rowNeedsCompletion]
  );

  const [onlyToComplete, setOnlyToComplete] = useState(false);

  const filteredRows = useMemo(() => {
    let rows = sortedRows;
    if (onlyToComplete) rows = rows.filter(rowNeedsCompletion);
    if (!searchQuery.trim()) return rows;
    const query = searchQuery.toLowerCase();
    return rows.filter(row => {
      // Check if any of the row's values (except id, rowIndex) matches the query
      return Object.entries(row).some(([key, val]) => {
        if (key === 'id' || key === 'rowIndex') return false;
        return String(val).toLowerCase().includes(query);
      });
    });
  }, [sortedRows, searchQuery, onlyToComplete, rowNeedsCompletion]);

  if (loading) {
    return <div className="flex-1 p-8 flex items-center justify-center text-slate-500 bg-slate-900">Chargement des données...</div>;
  }

  if (error) {
    return (
      <div className="flex-1 p-8 text-center bg-slate-900">
        <div className="p-4 bg-red-950/30 text-red-400 rounded-lg inline-block border border-red-900/50">
          <p className="font-medium">Erreur lors du chargement</p>
          <p className="text-sm mt-1">{error}</p>
          <button onClick={loadData} className="mt-4 px-4 py-2 bg-slate-950 text-red-400 hover:bg-slate-900 rounded border border-red-900/50 transition-colors">
            Réessayer
          </button>
        </div>
      </div>
    );
  }

  if (!data || data.headers.length === 0) {
    return <div className="flex-1 p-8 text-center text-slate-500 bg-slate-900">Aucune donnée trouvée pour {location}.</div>;
  }

  return (
    <div className="flex-1 flex flex-col font-sans overflow-hidden bg-slate-900 text-slate-100">
      <header className="h-20 border-b border-slate-800 flex items-center justify-between px-6 lg:px-8 bg-slate-900/50 shrink-0">
        <div>
          <div className="flex items-center gap-3 flex-wrap">
            <h1 className="text-xl font-bold tracking-tight text-white">Maison: {location}</h1>
            {loadingExternal ? (
              <div className="flex items-center gap-1.5 bg-slate-800/60 text-slate-400 text-xs px-2.5 py-1 rounded-full border border-slate-700 font-medium whitespace-nowrap">
                <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                <span>Synchronisation…</span>
              </div>
            ) : (
              <>
                {/* Fraîcheur réelle de la synchro (heure du dernier fetch) — cliquer pour resynchroniser */}
                <button
                  onClick={syncNow}
                  title="Relancer la synchronisation (agendas + tableau)"
                  className="flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full border font-medium whitespace-nowrap bg-slate-800/60 text-slate-300 border-slate-700 hover:bg-slate-700/60 hover:text-white transition-colors cursor-pointer"
                >
                  <RefreshCw className="w-3 h-3" />
                  <span>synchro {timeAgo(syncedAt)}</span>
                </button>
                {sources.map(s => (
                  <button
                    key={s.label}
                    onClick={syncNow}
                    title={
                      s.ok
                        ? `${s.count} événement(s) · dernier changement dans cet agenda ${timeAgo(s.updated)} · cliquer pour resynchroniser`
                        : 'Agenda inaccessible avec ce compte · cliquer pour réessayer'
                    }
                    className={`flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full border font-medium whitespace-nowrap transition-colors cursor-pointer ${
                      s.ok
                        ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20 hover:bg-emerald-500/20'
                        : 'bg-rose-500/10 text-rose-400 border-rose-500/20 hover:bg-rose-500/20'
                    }`}
                  >
                    <span className={`w-1.5 h-1.5 rounded-full ${s.ok ? 'bg-emerald-400' : 'bg-rose-400'}`} />
                    <span>{s.label}</span>
                    {s.ok && <span className="text-emerald-500/70 font-normal">· {s.count}</span>}
                  </button>
                ))}
              </>
            )}
          </div>
          <div className="flex items-center gap-3 mt-1">
            <p className="text-slate-500 text-xs">{data.rows.length} enregistrements trouvés.</p>
            {toCompleteCount > 0 && (
              <button
                onClick={() => { setView('table'); setOnlyToComplete(true); }}
                title="Réservations Airbnb dont il manque le nom ou le prix"
                className="flex items-center gap-1.5 text-[11px] font-bold px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-400 border border-amber-500/30 hover:bg-amber-500/20 transition-colors"
              >
                <Pencil className="w-3 h-3" />
                {toCompleteCount} à compléter
              </button>
            )}
          </div>
        </div>
        <div className="flex items-center space-x-1 sm:space-x-2 bg-slate-950 p-1 rounded-lg border border-slate-800 shrink-0">
          <button
            onClick={() => setView('table')}
            className={`px-3 py-1.5 rounded-md text-xs sm:text-sm font-medium transition-colors flex items-center cursor-pointer ${view === 'table' ? 'bg-slate-800 text-slate-200' : 'text-slate-500 hover:text-slate-300'}`}
          >
            <CreditCard className="w-4 h-4 mr-1.5" />
            Tableau
          </button>
          <button
            onClick={() => setView('calendar')}
            className={`px-3 py-1.5 rounded-md text-xs sm:text-sm font-medium transition-colors flex items-center cursor-pointer ${view === 'calendar' ? 'bg-slate-800 text-slate-200' : 'text-slate-500 hover:text-slate-300'}`}
          >
            <Calendar className="w-4 h-4 mr-1.5" />
            Calendrier
          </button>
          <button
            onClick={() => setView('recap')}
            className={`px-3 py-1.5 rounded-md text-xs sm:text-sm font-medium transition-colors flex items-center cursor-pointer ${view === 'recap' ? 'bg-slate-800 text-slate-200' : 'text-slate-500 hover:text-slate-300'}`}
          >
            <List className="w-4 h-4 mr-1.5" />
            Récap
          </button>
          <button
            onClick={() => setView('graph')}
            className={`px-3 py-1.5 rounded-md text-xs sm:text-sm font-medium transition-colors flex items-center cursor-pointer ${view === 'graph' ? 'bg-slate-800 text-slate-200' : 'text-slate-500 hover:text-slate-300'}`}
          >
            <BarChartIcon className="w-4 h-4 mr-1.5" />
            Graphique
          </button>
        </div>
      </header>

      <div className="flex-1 overflow-hidden flex flex-col p-6 lg:p-8 shrink min-h-0 bg-slate-900">
      {conflicts.length > 0 && (
        <div className="mb-4 shrink-0 bg-rose-950/30 border border-rose-800/60 rounded-xl p-3 max-h-56 overflow-y-auto">
          <div className="flex items-center gap-2 text-rose-400 text-xs font-bold uppercase tracking-widest mb-2">
            <AlertTriangle className="w-4 h-4" />
            Chevauchement{conflicts.length > 1 ? 's' : ''} détecté{conflicts.length > 1 ? 's' : ''} ({conflicts.length})
          </div>
          <div className="space-y-2">
            {conflicts.map((c, i) => {
              const ext = c.a.isExternal ? c.a : c.b.isExternal ? c.b : null;
              const sheetSide = c.a.isExternal ? c.b : c.a;
              return (
                <div key={i} className="flex flex-col sm:flex-row sm:items-center gap-2 justify-between p-2 rounded-lg bg-rose-950/20 border border-rose-900/40">
                  <p className="text-xs text-rose-300/90 font-mono min-w-0">
                    « {c.a.title} » ({c.a.start.toLocaleDateString('fr-FR')}→{c.a.end.toLocaleDateString('fr-FR')})
                    {'  ×  '}
                    « {c.b.title} » ({c.b.start.toLocaleDateString('fr-FR')}→{c.b.end.toLocaleDateString('fr-FR')})
                  </p>
                  <div className="flex items-center gap-2 shrink-0">
                    {ext && sheetSide.row ? (
                      <>
                        <button
                          onClick={() => handleAlignToAirbnb(sheetSide, ext)}
                          disabled={aligning}
                          className="px-2.5 py-1 text-[11px] font-bold rounded-md bg-rose-500/20 hover:bg-rose-500/30 text-rose-200 border border-rose-500/40 transition-colors disabled:opacity-50 whitespace-nowrap"
                        >
                          {aligning ? '…' : `Caler sur Airbnb (${format(ext.start, 'dd/MM')}→${format(ext.end, 'dd/MM')})`}
                        </button>
                        <button
                          onClick={() => setEditingRow(sheetSide.row!)}
                          className="px-2.5 py-1 text-[11px] font-medium rounded-md bg-slate-800/80 hover:bg-slate-700 text-slate-300 border border-slate-700 transition-colors whitespace-nowrap"
                        >
                          Modifier
                        </button>
                      </>
                    ) : (
                      <>
                        {c.a.row && (
                          <button
                            onClick={() => setEditingRow(c.a.row!)}
                            className="px-2.5 py-1 text-[11px] font-medium rounded-md bg-slate-800/80 hover:bg-slate-700 text-slate-300 border border-slate-700 transition-colors whitespace-nowrap"
                          >
                            Modifier « {c.a.title.slice(0, 14)} »
                          </button>
                        )}
                        {c.b.row && (
                          <button
                            onClick={() => setEditingRow(c.b.row!)}
                            className="px-2.5 py-1 text-[11px] font-medium rounded-md bg-slate-800/80 hover:bg-slate-700 text-slate-300 border border-slate-700 transition-colors whitespace-nowrap"
                          >
                            Modifier « {c.b.title.slice(0, 14)} »
                          </button>
                        )}
                      </>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
      {view === 'table' ? (
        <div className="flex-1 flex flex-col min-h-0 gap-4">
          <div className="flex items-center gap-3 shrink-0 flex-wrap">
            <div className="relative max-w-sm flex-1 min-w-[200px]">
               <span className="absolute inset-y-0 left-0 flex items-center pl-3.5 pointer-events-none text-slate-500">
                 <Search className="w-4 h-4" />
               </span>
               <input
                 type="text"
                 placeholder="Rechercher (nom, date, montant)..."
                 value={searchQuery}
                 onChange={e => setSearchQuery(e.target.value)}
                 className="w-full pl-10 pr-4 py-2.5 bg-slate-950 border border-slate-800 rounded-xl focus:ring-1 focus:ring-purple-500 focus:border-purple-500 text-sm text-slate-200 outline-none transition-all placeholder:text-slate-600 shadow-sm"
               />
            </div>
            {onlyToComplete && (
              <button
                onClick={() => setOnlyToComplete(false)}
                className="flex items-center gap-1.5 text-xs font-medium px-3 py-2 rounded-lg bg-amber-500/10 text-amber-400 border border-amber-500/30 hover:bg-amber-500/20 transition-colors"
              >
                <Pencil className="w-3.5 h-3.5" />
                À compléter uniquement
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
          <div className="border border-slate-800 rounded-xl bg-slate-950/50 flex-1 flex flex-col min-h-0">
            <div className="overflow-x-auto overflow-y-auto flex-1">
              <table className="w-full text-left text-sm text-slate-300 relative border-collapse">
                <thead className="bg-slate-900 border-b border-slate-800 text-xs font-bold text-slate-500 uppercase tracking-wide sticky top-0 md:top-0 z-10 before:content-[''] before:absolute before:inset-0 before:border-b before:border-slate-800">
                  <tr>
                    {data.headers.map(header => (
                      <th 
                        key={header} 
                        onClick={() => handleSort(header)}
                        className="px-4 py-3 whitespace-nowrap cursor-pointer hover:bg-slate-800/80 transition-colors select-none group"
                      >
                        <div className="flex items-center gap-2">
                          {header}
                          <ArrowUpDown className={`w-3 h-3 transition-opacity ${sortCol === header ? 'opacity-100 text-indigo-400' : 'opacity-40 group-hover:opacity-100'}`} />
                        </div>
                      </th>
                    ))}
                    <th className="px-4 py-3 text-right bg-slate-900 z-10">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/50">
                  {filteredRows.map((row, idx) => {
                  const needsCompletion = rowNeedsCompletion(row);
                  return (
                  <tr key={row.id} className={`transition-colors group ${needsCompletion ? 'bg-amber-500/[0.06] hover:bg-amber-500/10' : 'hover:bg-slate-900/50'}`}>
                    {data.headers.map(header => (
                      <td key={header} className="px-4 py-3">
                        <TableCell header={header} val={row[header]} />
                      </td>
                    ))}
                    <td className="px-4 py-3 text-right whitespace-nowrap">
                      {needsCompletion && (
                        <button
                          onClick={() => setEditingRow(row)}
                          className="text-amber-300 bg-amber-500/15 hover:bg-amber-500/25 border border-amber-500/40 px-2.5 py-1 rounded-md text-[11px] font-bold transition-colors inline-flex items-center gap-1.5 mr-1 align-middle"
                          title="Renseigner le nom et le prix de cette réservation Airbnb"
                        >
                          <Pencil className="w-3 h-3" />
                          Compléter
                        </button>
                      )}
                      {['PORTIVY', 'BAS', 'HAUT'].includes(location) && (
                        <button
                          onClick={() => setContractRow(row)}
                          className="text-amber-400 hover:text-amber-300 p-1.5 rounded-lg hover:bg-amber-500/10 transition-colors opacity-0 group-hover:opacity-100 inline-flex items-center justify-center mr-1 align-middle"
                          title="Générer un contrat"
                        >
                          <FileText className="w-4 h-4" />
                        </button>
                      )}
                      <button
                        onClick={() => setEditingRow(row)}
                        className="text-indigo-400 hover:text-indigo-300 p-1.5 rounded-lg hover:bg-indigo-500/10 transition-colors opacity-0 group-hover:opacity-100 inline-flex items-center justify-center align-middle"
                        title="Modifier cette ligne"
                      >
                        <Edit3 className="w-4 h-4" />
                      </button>
                    </td>
                  </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
        </div>
      ) : view === 'calendar' ? (
        <AnnualCalendar data={data} location={location} externalEvents={externalEvents} onCellClick={(row) => setEditingRow(row)} />
      ) : view === 'recap' ? (
        <SimpleCalendar
          data={data}
          location={location}
          externalEvents={externalEvents}
          loadingExternal={loadingExternal}
          onExternalAdded={(evt) => setExternalEvents(prev => [...prev, evt])}
          onCellClick={(row) => setEditingRow(row)}
          onReload={loadData}
        />
      ) : (
        <Suspense fallback={<LazyFallback />}>
          <LocationStats data={data} />
        </Suspense>
      )}
      </div>

      {contractRow && (
        <Suspense fallback={null}>
          <ContractModal
            isOpen={!!contractRow}
            onClose={() => setContractRow(null)}
            reservation={contractRow}
            location={location}
          />
        </Suspense>
      )}

      {editingRow && (
        <EditRowModal 
          row={editingRow} 
          headers={data.headers}
          rawHeaders={data.rawHeaders}
          location={location} 
          onClose={() => setEditingRow(null)} 
          onSaved={() => {
            setEditingRow(null);
            loadData();
          }}
          onGenerateContract={() => {
            setContractRow(editingRow);
            setEditingRow(null); 
          }}
        />
      )}
    </div>
  );
}
