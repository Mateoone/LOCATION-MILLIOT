import React, { useMemo } from 'react';
import { SheetData } from '../lib/sheets';
import { parse, isValid, differenceInDays } from 'date-fns';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  ComposedChart,
  Line
} from 'recharts';

interface LocationStatsProps {
  data: SheetData;
}

export function LocationStats({ data }: LocationStatsProps) {
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

  const statsByYear = useMemo(() => {
    if (!startHeader) return [];

    const stats: Record<string, {
      year: string;
      nuitsPayees: number;
      nuitsPerso: number;
      ca: number;
      airbnbNuits: number;
      directNuits: number;
    }> = {};

    data.rows.forEach(row => {
      const startStr = row[startHeader];
      const endStr = endHeader ? row[endHeader] : null;
      
      const start = parseDateStr(startStr);
      const end = endStr ? parseDateStr(endStr) : null;

      if (!start) return;

      // Convention tableau : « fin » = dernière nuit → nuits = (fin − début) + 1.
      const days = end ? differenceInDays(end, start) + 1 : 1;
      if (days <= 0) return;
      
      let priceVal = 0;
      let hasPrice = false;
      if (priceHeader && row[priceHeader]) {
        const val = row[priceHeader];
        const cleanNum = val.replace(/[^\d.,-]/g, '').replace(',', '.').trim();
        if (cleanNum) {
          const parsedPrice = parseFloat(cleanNum);
          if (!isNaN(parsedPrice)) {
            priceVal = parsedPrice;
            hasPrice = true;
          }
        }
      }

      let isAirbnb = false;
      if (sourceHeader && row[sourceHeader]) {
        isAirbnb = /airbnb/i.test(row[sourceHeader]);
      }

      // If the guest is from the Milliot family, it's a personal stay (no cost, not Airbnb)
      const tenantName = nameHeader ? (row[nameHeader] || '') : '';
      const isMilliot = /milliot/i.test(tenantName);
      if (isMilliot) {
        isAirbnb = false;
        priceVal = 0;
        hasPrice = false;
      }

      const year = start.getFullYear().toString();
      if (!stats[year]) {
        stats[year] = { year, nuitsPayees: 0, nuitsPerso: 0, ca: 0, airbnbNuits: 0, directNuits: 0 };
      }

      if (hasPrice) {
        stats[year].nuitsPayees += days;
        stats[year].ca += priceVal;
        if (isAirbnb) {
          stats[year].airbnbNuits += days;
        } else {
          stats[year].directNuits += days;
        }
      } else {
        stats[year].nuitsPerso += days;
      }
    });

    return Object.values(stats).sort((a, b) => parseInt(a.year) - parseInt(b.year));
  }, [data.rows, startHeader, endHeader, priceHeader, sourceHeader]);

  if (!startHeader || statsByYear.length === 0) {
    return (
      <div className="flex-1 p-8 flex items-center justify-center text-slate-500 bg-slate-900/50 rounded-xl border border-slate-800">
        Données insuffisantes pour générer des statistiques.
      </div>
    );
  }

  const CustomTooltip = ({ active, payload, label }: any) => {
    if (active && payload && payload.length) {
      const airbnbNuits = payload.find((p: any) => p.dataKey === 'airbnbNuits')?.value || 0;
      const directNuits = payload.find((p: any) => p.dataKey === 'directNuits')?.value || 0;
      const totalPayees = airbnbNuits + directNuits;

      return (
        <div className="bg-slate-900 border border-slate-700 p-4 rounded-lg shadow-xl text-xs font-mono">
          <p className="font-bold text-sm text-slate-200 mb-2 border-b border-slate-800 pb-2">{label}</p>
          {payload.map((entry: any, index: number) => (
            <div key={index} className="flex justify-between gap-4 my-1">
              <span style={{ color: entry.color }}>{entry.name}:</span>
              <span className="font-bold text-slate-300">
                {entry.value} {entry.name === 'Chiffre d\'Affaire' ? '€' : 'nuits'}
              </span>
            </div>
          ))}
          {/* Calcul de la part airbnb si données dispo */}
          {totalPayees > 0 && (
            <div className="flex justify-between gap-4 mt-2 pt-2 border-t border-slate-800 text-slate-400">
              <span>Part Airbnb:</span>
              <span className="font-bold">
                {Math.round((airbnbNuits / totalPayees) * 100)}%
              </span>
            </div>
          )}
        </div>
      );
    }
    return null;
  };

  return (
    <div className="border border-slate-800 rounded-xl bg-slate-950/50 flex-1 flex flex-col p-6 shadow-lg overflow-y-auto">
      <div className="mb-6 shrink-0">
        <h3 className="text-sm font-semibold uppercase text-slate-400 tracking-wider">Statistiques annuelles</h3>
        <p className="text-xs text-slate-500 mt-1">Évolution du nombre de nuits louées, des nuits perso et du chiffre d'affaire.</p>
      </div>
      
      <div className="flex-1 w-full min-h-[400px]">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart
            data={statsByYear}
            margin={{ top: 20, right: 20, left: 0, bottom: 20 }}
          >
            <CartesianGrid strokeDasharray="3 3" stroke="#334155" vertical={false} />
            <XAxis dataKey="year" stroke="#94a3b8" tick={{ fill: '#94a3b8', fontSize: 12 }} tickLine={false} axisLine={false} dy={10} />
            <YAxis yAxisId="left" stroke="#94a3b8" tick={{ fill: '#94a3b8', fontSize: 12 }} tickLine={false} axisLine={false} dx={-10} />
            <YAxis yAxisId="right" orientation="right" stroke="#34d399" tick={{ fill: '#34d399', fontSize: 12 }} tickLine={false} axisLine={false} dx={10} />
            <Tooltip content={<CustomTooltip />} />
            <Legend wrapperStyle={{ paddingTop: '20px', fontSize: '12px' }} />
            
            <Bar yAxisId="left" dataKey="directNuits" name="Nuits Direct" stackId="rented" fill="#4f46e5" barSize={40} />
            <Bar yAxisId="left" dataKey="airbnbNuits" name="Nuits Airbnb" stackId="rented" fill="#FF5A5F" radius={[4, 4, 0, 0]} barSize={40} />
            <Bar yAxisId="left" dataKey="nuitsPerso" name="Nuits Perso" fill="#6366f1" opacity={0.5} radius={[4, 4, 0, 0]} barSize={40} />
            <Line yAxisId="right" type="monotone" dataKey="ca" name="Chiffre d'Affaire" stroke="#34d399" strokeWidth={3} dot={{ r: 5, fill: '#34d399', strokeWidth: 0 }} activeDot={{ r: 7 }} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      <div className="mt-8 grid grid-cols-1 md:grid-cols-3 gap-4 shrink-0">
        {statsByYear.map(stat => (
          <div key={stat.year} className="bg-slate-900 border border-slate-800 rounded-lg p-4 flex flex-col justify-between">
            <div className="flex justify-between items-center mb-4">
              <span className="font-mono text-lg font-bold text-slate-300">{stat.year}</span>
              <span className="text-xs bg-emerald-500/10 text-emerald-400 px-2 py-1 rounded font-mono">
                {stat.ca.toLocaleString('fr-FR')} €
              </span>
            </div>
            <div className="space-y-2 text-xs">
              <div className="flex justify-between text-slate-400">
                <span>Nuits Louées:</span>
                <span className="font-bold text-indigo-400">{stat.nuitsPayees}</span>
              </div>
              <div className="flex justify-between text-slate-400">
                <span>Nuits Perso:</span>
                <span className="font-bold text-slate-500">{stat.nuitsPerso}</span>
              </div>
              <div className="flex justify-between text-slate-400 pt-2 border-t border-slate-800/50">
                <span>Part Airbnb:</span>
                <span className="font-bold text-slate-300">
                  {stat.nuitsPayees > 0 ? Math.round((stat.airbnbNuits / stat.nuitsPayees) * 100) : 0}%
                </span>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
