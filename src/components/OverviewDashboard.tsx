import React, { useEffect, useMemo, useState } from 'react';
import { format, differenceInCalendarDays, startOfDay } from 'date-fns';
import { fr } from 'date-fns/locale';
import { LogIn, LogOut, Home as HomeIcon, AlertTriangle, RefreshCw, CalendarDays } from 'lucide-react';
import { SheetLocation, fetchSheetData } from '../lib/sheets';
import { fetchExternalCalendar } from '../lib/ical';
import { buildBookings, findConflicts, UnifiedBooking, BookingConflict, LOCATION_LABELS } from '../lib/bookings';
import { AUTH_RESTORED_EVENT } from '../lib/auth';

const LOCATIONS: SheetLocation[] = ['HAUT', 'BAS', 'PORTIVY'];
const HORIZON_DAYS = 14;

interface OverviewDashboardProps {
  onOpenLocation: (loc: SheetLocation) => void;
}

const locationDot: Record<SheetLocation, string> = {
  HAUT: 'bg-indigo-400',
  BAS: 'bg-emerald-400',
  PORTIVY: 'bg-amber-400',
};

export function OverviewDashboard({ onOpenLocation }: OverviewDashboardProps) {
  const [bookings, setBookings] = useState<UnifiedBooking[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    try {
      setLoading(true);
      setError(null);
      const perLocation = await Promise.all(
        LOCATIONS.map(async (loc) => {
          const [sheet, external] = await Promise.all([
            fetchSheetData(loc).catch(() => ({ headers: [], rawHeaders: [], rows: [] })),
            fetchExternalCalendar(loc).catch(() => []),
          ]);
          return buildBookings(sheet, loc, external);
        })
      );
      setBookings(perLocation.flat());
    } catch (err: any) {
      setError(err.message || 'Erreur de chargement');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    const onRestored = () => load();
    window.addEventListener(AUTH_RESTORED_EVENT, onRestored);
    return () => window.removeEventListener(AUTH_RESTORED_EVENT, onRestored);
  }, []);

  const today = startOfDay(new Date());
  const horizonEnd = new Date(today);
  horizonEnd.setDate(horizonEnd.getDate() + HORIZON_DAYS);

  // Toutes les arrivées futures, sans limite d'horizon.
  const arrivals = useMemo(
    () =>
      bookings
        .filter(b => b.start >= today)
        .sort((a, b) => a.start.getTime() - b.start.getTime()),
    [bookings]
  );

  const departures = useMemo(
    () =>
      bookings
        .filter(b => b.end >= today && b.end < horizonEnd)
        .sort((a, b) => a.end.getTime() - b.end.getTime()),
    [bookings]
  );

  const current = useMemo(
    () =>
      bookings
        .filter(b => b.start <= today && b.end > today)
        .sort((a, b) => a.end.getTime() - b.end.getTime()),
    [bookings]
  );

  const conflicts = useMemo(() => findConflicts(bookings), [bookings]);

  const relDay = (d: Date) => {
    const diff = differenceInCalendarDays(d, today);
    if (diff === 0) return "aujourd'hui";
    if (diff === 1) return 'demain';
    return `dans ${diff} j`;
  };

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center bg-slate-900 text-slate-500 gap-3">
        <RefreshCw className="w-4 h-4 animate-spin" /> Chargement de la vue d'ensemble…
      </div>
    );
  }

  const Row: React.FC<{ b: UnifiedBooking; dateField: 'start' | 'end' }> = ({ b, dateField }) => {
    const d = b[dateField];
    return (
      <button
        onClick={() => onOpenLocation(b.location)}
        className="w-full flex items-center justify-between gap-3 p-3 rounded-lg border border-slate-800 bg-slate-900/40 hover:bg-slate-900 hover:border-slate-700 transition-colors text-left"
      >
        <div className="flex items-center gap-3 min-w-0">
          <span className={`w-2 h-2 rounded-full shrink-0 ${locationDot[b.location]}`} />
          <div className="min-w-0">
            <p className="text-sm font-semibold text-slate-200 truncate">{b.title}</p>
            <p className="text-[11px] text-slate-500">{LOCATION_LABELS[b.location]} · {b.source}</p>
          </div>
        </div>
        <div className="text-right shrink-0">
          <p className="text-xs font-mono text-slate-300">
            {format(d, d.getFullYear() === today.getFullYear() ? 'EEE d MMM' : 'EEE d MMM yyyy', { locale: fr })}
          </p>
          <p className="text-[10px] text-slate-500">{relDay(d)}</p>
        </div>
      </button>
    );
  };

  const Section: React.FC<{
    title: string; icon: React.ReactNode; items: UnifiedBooking[]; dateField: 'start' | 'end'; empty: string;
  }> = ({ title, icon, items, dateField, empty }) => (
    <div className="bg-slate-950/40 border border-slate-800 rounded-xl p-4 flex flex-col min-h-0">
      <h3 className="text-xs font-bold uppercase text-slate-400 tracking-widest mb-3 flex items-center gap-2 shrink-0">
        {icon} {title} <span className="text-slate-600 font-mono">{items.length}</span>
      </h3>
      <div className="space-y-2 overflow-y-auto">
        {items.length === 0 ? (
          <p className="text-sm text-slate-600 py-6 text-center">{empty}</p>
        ) : (
          items.map(b => <Row key={`${dateField}-${b.id}`} b={b} dateField={dateField} />)
        )}
      </div>
    </div>
  );

  return (
    <div className="flex-1 flex flex-col overflow-hidden bg-slate-900 text-slate-100">
      <header className="h-20 border-b border-slate-800 flex items-center justify-between px-6 lg:px-8 bg-slate-900/50 shrink-0">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-white flex items-center gap-2">
            <CalendarDays className="w-5 h-5 text-sky-400" /> Vue d'ensemble
          </h1>
          <p className="text-slate-500 text-xs mt-1">Toutes les arrivées à venir, départs sur {HORIZON_DAYS} jours et séjours en cours — toutes maisons.</p>
        </div>
        <button onClick={load} className="p-2 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors" title="Rafraîchir">
          <RefreshCw className="w-4 h-4" />
        </button>
      </header>

      <div className="flex-1 overflow-y-auto p-6 lg:p-8 space-y-6">
        {error && (
          <div className="p-4 bg-red-950/30 text-red-400 rounded-lg border border-red-900/50 text-sm">{error}</div>
        )}

        {conflicts.length > 0 && (
          <div className="bg-rose-950/30 border border-rose-800/60 rounded-xl p-4">
            <h3 className="text-xs font-bold uppercase text-rose-400 tracking-widest mb-3 flex items-center gap-2">
              <AlertTriangle className="w-4 h-4" /> Conflits de réservation possibles <span className="font-mono">{conflicts.length}</span>
            </h3>
            <div className="space-y-2">
              {conflicts.map((c: BookingConflict, i) => (
                <button
                  key={i}
                  onClick={() => onOpenLocation(c.a.location)}
                  className="w-full text-left p-3 rounded-lg border border-rose-900/50 bg-rose-950/20 hover:bg-rose-950/40 transition-colors"
                >
                  <p className="text-sm font-semibold text-rose-200">
                    {LOCATION_LABELS[c.a.location]} — chevauchement
                  </p>
                  <p className="text-xs text-rose-300/80 mt-1 font-mono">
                    « {c.a.title} » ({format(c.a.start, 'dd/MM', { locale: fr })}→{format(c.a.end, 'dd/MM', { locale: fr })})
                    {'  ×  '}
                    « {c.b.title} » ({format(c.b.start, 'dd/MM', { locale: fr })}→{format(c.b.end, 'dd/MM', { locale: fr })})
                  </p>
                </button>
              ))}
            </div>
          </div>
        )}

        {current.length > 0 && (
          <div className="bg-slate-950/40 border border-slate-800 rounded-xl p-4">
            <h3 className="text-xs font-bold uppercase text-slate-400 tracking-widest mb-3 flex items-center gap-2">
              <HomeIcon className="w-4 h-4 text-emerald-400" /> Séjours en cours <span className="font-mono text-slate-600">{current.length}</span>
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-2">
              {current.map(b => <Row key={`cur-${b.id}`} b={b} dateField="end" />)}
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <Section title="Arrivées à venir" icon={<LogIn className="w-4 h-4 text-sky-400" />} items={arrivals} dateField="start" empty="Aucune arrivée à venir." />
          <Section title="Prochains départs" icon={<LogOut className="w-4 h-4 text-amber-400" />} items={departures} dateField="end" empty="Aucun départ à venir." />
        </div>
      </div>
    </div>
  );
}
