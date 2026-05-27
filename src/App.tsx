/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useState } from 'react';
import { initAuth, logout } from './lib/auth';
import { LoginScreen } from './components/LoginScreen';
import { LocationView } from './components/LocationView';
import { ContactsView } from './components/ContactsView';
import { SheetLocation } from './lib/sheets';
import { LogOut, Home, Sunset, FileSpreadsheet, Users } from 'lucide-react';

export default function App() {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [loading, setLoading] = useState(true);
  const [activeLocation, setActiveLocation] = useState<SheetLocation>('HAUT');
  const [currentTab, setCurrentTab] = useState<'houses' | 'contacts'>('houses');

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
            <span className="text-xl font-bold tracking-tight text-white">Location Milliot</span>
            <span className="text-xs text-slate-500 font-bold tracking-wide uppercase">Maisons</span>
          </div>
        </div>
        
        <div className="p-4 flex-1 space-y-1">
          <span className="px-4 py-1.5 block text-[10px] font-bold text-slate-500 uppercase tracking-widest leading-none">Propriétés</span>
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
      {currentTab === 'houses' ? (
        <LocationView location={activeLocation} />
      ) : (
        <ContactsView />
      )}
    </div>
  );
}
