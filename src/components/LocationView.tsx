import React, { useState, useEffect, useMemo } from 'react';
import { SheetLocation, SheetData, fetchSheetData, ReservationRow } from '../lib/sheets';
import { Calendar, CreditCard, Edit3, ArrowUpDown, Check, X, Phone, Globe, Briefcase, MapPin, List, RefreshCw } from 'lucide-react';
import { EditRowModal } from './EditRowModal';
import { SimpleCalendar } from './SimpleCalendar';
import { LocationStats } from './LocationStats';
import { AnnualCalendar } from './AnnualCalendar';
import { BarChart as BarChartIcon } from 'lucide-react';
import { fetchExternalCalendar, IcalEvent } from '../lib/ical';

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
  const [sortCol, setSortCol] = useState<string | null>(null);
  const [sortAsc, setSortAsc] = useState(true);
  const [externalEvents, setExternalEvents] = useState<IcalEvent[]>([]);
  const [loadingExternal, setLoadingExternal] = useState(false);

  // Fetch Airbnb iCal external events when active location changes
  useEffect(() => {
    let isMounted = true;
    async function loadIcal() {
      try {
        setLoadingExternal(true);
        const evts = await fetchExternalCalendar(location);
        if (isMounted) {
          setExternalEvents(evts);
        }
      } catch (err) {
        console.warn("Failed to load external calendar:", err);
      } finally {
        if (isMounted) {
          setLoadingExternal(false);
        }
      }
    }
    loadIcal();
    return () => { isMounted = false; };
  }, [location]);

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
  }, [location]);

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
          <div className="flex items-center gap-3">
            <h1 className="text-xl font-bold tracking-tight text-white">Maison: {location}</h1>
            <div className="flex items-center gap-1.5 bg-emerald-500/10 text-emerald-400 text-xs px-2.5 py-1 rounded-full border border-emerald-500/20 font-medium whitespace-nowrap">
              <RefreshCw className={`w-3.5 h-3.5 ${loadingExternal ? 'animate-spin' : ''}`} />
              <span>Synchro active</span>
            </div>
          </div>
          <p className="text-slate-500 text-xs mt-1">{data.rows.length} enregistrements trouvés.</p>
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
      {view === 'table' ? (
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
                {sortedRows.map((row, idx) => (
                  <tr key={row.id} className="hover:bg-slate-900/50 transition-colors group">
                    {data.headers.map(header => (
                      <td key={header} className="px-4 py-3">
                        <TableCell header={header} val={row[header]} />
                      </td>
                    ))}
                    <td className="px-4 py-3 text-right">
                      <button 
                        onClick={() => setEditingRow(row)}
                        className="text-indigo-400 hover:text-indigo-300 p-1.5 rounded-lg hover:bg-indigo-500/10 transition-colors opacity-0 group-hover:opacity-100 inline-flex items-center justify-center"
                        title="Modifier cette ligne"
                      >
                        <Edit3 className="w-4 h-4" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
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
        <LocationStats data={data} />
      )}
      </div>

      {editingRow && (
        <EditRowModal 
          row={editingRow} 
          headers={data.headers} 
          location={location} 
          onClose={() => setEditingRow(null)} 
          onSaved={() => {
            setEditingRow(null);
            loadData();
          }}
        />
      )}
    </div>
  );
}
