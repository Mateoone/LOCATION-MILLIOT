/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useState } from 'react';
import { initAuth, logout, reconnect, AUTH_EXPIRED_EVENT } from './lib/auth';
import { LoginScreen } from './components/LoginScreen';
import { LocationView } from './components/LocationView';
import { ContactsView } from './components/ContactsView';
import { OverviewDashboard } from './components/OverviewDashboard';
import { SheetLocation } from './lib/sheets';
import { OFFLINE_DATA_EVENT, ONLINE_DATA_EVENT } from './lib/offlineCache';
import { LogOut, Home, Sunset, FileSpreadsheet, Users, LayoutDashboard, AlertTriangle, Loader2, WifiOff } from 'lucide-react';

const APP_VERSION = '2.8';

type Tab = 'overview' | 'houses' | 'contacts';

function ReconnectOverlay() {
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  const handleReconnect = async () => {
    setBusy(true);
    setFailed(false);
    const ok = await reconnect();
    setBusy(false);
    if (!ok) setFailed(true);
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/80 backdrop-blur-sm p-4">
      <div className="max-w-sm w-full bg-slate-900 border border-slate-800 rounded-2xl shadow-xl p-6 text-center space-y-4">
        <div className="w-12 h-12 bg-amber-500/10 text-amber-400 rounded-full flex items-center justify-center mx-auto">
          <AlertTriangle className="w-6 h-6" />
        </div>
        <div>
          <h2 className="text-lg font-bold text-white">Connexion Google à renouveler</h2>
          <p className="text-sm text-slate-400 mt-1">
            Reconnectez-vous pour continuer — vous resterez sur la même page. Sur l'écran Google, <span className="text-slate-200 font-medium">acceptez bien l'accès à Google Sheets, Agenda et Contacts</span>.
          </p>
        </div>
        {failed && (
          <p className="text-xs text-rose-400 bg-rose-950/30 border border-rose-900/50 rounded-lg py-2 px-3">
            La reconnexion a échoué. Vérifiez que le popup Google n'est pas bloqué, puis réessayez.
          </p>
        )}
        <button
          onClick={handleReconnect}
          disabled={busy}
          className="w-full flex items-center justify-center gap-2 px-4 py-2.5 font-bold text-white bg-indigo-600 hover:bg-indigo-500 rounded-lg transition-colors disabled:opacity-60"
        >
          {busy ? <><Loader2 className="w-4 h-4 animate-spin" /> Reconnexion…</> : 'Se reconnecter'}
        </button>
      </div>
    </div>
  );
}

export default function App() {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [loading, setLoading] = useState(true);
  const [activeLocation, setActiveLocation] = useState<SheetLocation>('HAUT');
  const [currentTab, setCurrentTab] = useState<Tab>('overview');
  const [sessionExpired, setSessionExpired] = useState(false);
  const [offlineSince, setOfflineSince] = useState<number | null>(null);

  useEffect(() => {
    const unsubscribe = initAuth(
      () => {
        setIsAuthenticated(true);
        setLoading(false);
      },
      () => {
        setIsAuthenticated(false);
        setLoading(false);
      }
    );
    return () => unsubscribe();
  }, []);

  // Token OAuth expiré : on garde l'app montée et on affiche une bannière de
  // reconnexion en place (le popup Google exige un clic utilisateur).
  useEffect(() => {
    const onExpired = () => setSessionExpired(true);
    const onRestored = () => setSessionExpired(false);
    window.addEventListener(AUTH_EXPIRED_EVENT, onExpired);
    window.addEventListener('auth-restored', onRestored);
    return () => {
      window.removeEventListener(AUTH_EXPIRED_EVENT, onExpired);
      window.removeEventListener('auth-restored', onRestored);
    };
  }, []);

  // Données servies depuis le cache local (réseau indisponible) — et retour en
  // ligne dès qu'une lecture réussit, pour refermer le bandeau.
  useEffect(() => {
    const onOffline = (e: Event) => setOfflineSince((e as CustomEvent).detail?.savedAt ?? Date.now());
    const onOnline = () => setOfflineSince(null);
    window.addEventListener(OFFLINE_DATA_EVENT, onOffline);
    window.addEventListener(ONLINE_DATA_EVENT, onOnline);
    return () => {
      window.removeEventListener(OFFLINE_DATA_EVENT, onOffline);
      window.removeEventListener(ONLINE_DATA_EVENT, onOnline);
    };
  }, []);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-900">
        <div className="w-8 h-8 rounded-full border-4 border-indigo-500 border-t-transparent animate-spin"></div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return <LoginScreen onLogin={() => setIsAuthenticated(true)} />;
  }

  const locations: { id: SheetLocation, label: string, icon: any }[] = [
    { id: 'HAUT', label: 'Chalet Haut', icon: Home },
    { id: 'BAS', label: 'Chalet Bas', icon: Home },
    { id: 'PORTIVY', label: 'Portivy', icon: Sunset },
  ];

  return (
    <div className="min-h-screen bg-slate-900 text-slate-100 font-sans flex flex-col md:flex-row w-full overflow-hidden">
      {/* Sidebar */}
      <div className="w-full md:w-64 bg-slate-950 border-r border-slate-800 flex flex-col shrink-0">
        <div className="p-6 border-b border-slate-800 flex items-center justify-between">
          <div className="flex flex-col">
            <div className="flex items-baseline gap-1.5">
              <span className="text-xl font-bold tracking-tight text-white">Location Milliot</span>
              <span className="text-[10px] font-mono text-slate-500">v:{APP_VERSION}</span>
            </div>
            <span className="text-xs text-slate-500 font-bold tracking-wide uppercase">Maisons</span>
          </div>
        </div>

        <div className="p-4 flex-1 space-y-1">
          <button
            onClick={() => setCurrentTab('overview')}
            className={`w-full flex items-center space-x-3 px-4 py-3 rounded-lg transition-colors font-medium text-sm cursor-pointer
              ${currentTab === 'overview'
                ? 'bg-sky-600/20 text-sky-400'
                : 'text-slate-500 hover:bg-slate-900/50 hover:text-slate-300'
              }`}
          >
            <LayoutDashboard className={`w-5 h-5 ${currentTab === 'overview' ? 'text-sky-400' : 'text-slate-500'}`} />
            <span>Vue d'ensemble</span>
          </button>

          <span className="px-4 pt-4 pb-1.5 block text-[10px] font-bold text-slate-500 uppercase tracking-widest leading-none">Propriétés</span>
          {locations.map(loc => {
            const Icon = loc.icon;
            const isActive = currentTab === 'houses' && activeLocation === loc.id;
            return (
              <button
                key={loc.id}
                onClick={() => {
                  setCurrentTab('houses');
                  setActiveLocation(loc.id);
                }}
                className={`w-full flex items-center space-x-3 px-4 py-3 rounded-lg transition-colors font-medium text-sm cursor-pointer
                  ${isActive
                    ? 'bg-indigo-600/20 text-indigo-400'
                    : 'text-slate-500 hover:bg-slate-900/50 hover:text-slate-300'
                  }`}
              >
                <Icon className={`w-5 h-5 ${isActive ? 'text-indigo-400' : 'text-slate-500'}`} />
                <span>{loc.label}</span>
              </button>
            );
          })}

          <div className="pt-4 mt-4 border-t border-slate-900 space-y-1">
            <span className="px-4 py-1.5 block text-[10px] font-bold text-slate-500 uppercase tracking-widest leading-none">Annuaire Sync</span>
            <button
              onClick={() => setCurrentTab('contacts')}
              className={`w-full flex items-center space-x-3 px-4 py-3 rounded-lg transition-colors font-medium text-sm cursor-pointer
                ${currentTab === 'contacts'
                  ? 'bg-purple-600/20 text-purple-400'
                  : 'text-slate-500 hover:bg-slate-900/50 hover:text-slate-300'
                }`}
            >
              <Users className={`w-5 h-5 ${currentTab === 'contacts' ? 'text-purple-400' : 'text-slate-500'}`} />
              <span>Contacts Voyageurs</span>
            </button>
          </div>
        </div>

        <div className="p-4 border-t border-slate-800 bg-slate-900/20 space-y-2">
          <a
            href="https://docs.google.com/spreadsheets/d/1VVVMkx9Woqxvfs8u7IWWfWwxz_kJ7h4OD9s5oC4u2ts/edit"
            target="_blank"
            rel="noopener noreferrer"
            className="w-full flex items-center justify-center space-x-2 px-4 py-2 font-medium text-sm text-emerald-400 hover:text-emerald-300 bg-emerald-500/10 border border-emerald-500/20 hover:border-emerald-500/40 rounded-lg transition-colors cursor-pointer"
          >
            <FileSpreadsheet className="w-4 h-4 text-emerald-500" />
            <span>Tableau de bord (Sheets)</span>
          </a>

          <button
            onClick={() => logout()}
            className="w-full flex items-center justify-center space-x-2 px-4 py-2 font-medium text-sm text-slate-400 bg-slate-900 border border-slate-800 rounded-lg hover:bg-slate-800 hover:text-slate-200 transition-colors"
          >
            <LogOut className="w-4 h-4 text-slate-500" />
            <span>Déconnexion</span>
          </button>
        </div>
      </div>

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {offlineSince !== null && (
          <div className="flex items-center gap-2 px-4 py-1.5 bg-amber-500/10 border-b border-amber-500/20 text-amber-300 text-xs shrink-0">
            <WifiOff className="w-3.5 h-3.5 shrink-0" />
            <span>
              Mode hors-ligne — données du {new Date(offlineSince).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' })}.
            </span>
            <button onClick={() => setOfflineSince(null)} className="ml-auto text-amber-400/70 hover:text-amber-300">Masquer</button>
          </div>
        )}
        {currentTab === 'overview' ? (
          <OverviewDashboard onOpenLocation={(loc) => { setActiveLocation(loc); setCurrentTab('houses'); }} />
        ) : currentTab === 'houses' ? (
          <LocationView location={activeLocation} />
        ) : (
          <ContactsView />
        )}
      </div>

      {sessionExpired && <ReconnectOverlay />}
    </div>
  );
}
