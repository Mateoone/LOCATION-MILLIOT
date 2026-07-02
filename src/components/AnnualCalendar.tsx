import React, { useMemo, useState } from 'react';
import { SheetData, ReservationRow, SheetLocation } from '../lib/sheets';
import { parse, isValid, format, isSameDay } from 'date-fns';
import { fr } from 'date-fns/locale';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { IcalEvent } from '../lib/ical';

interface AnnualCalendarProps {
  data: SheetData;
  location: SheetLocation;
  externalEvents: IcalEvent[];
  onCellClick: (row: ReservationRow) => void;
}

interface UnifiedBooking {
  id: string;
  title: string;
  start: Date;
  end: Date;
  source: string;
  row?: ReservationRow;
}

export function AnnualCalendar({ data, location, externalEvents, onCellClick }: AnnualCalendarProps) {
  const [selectedYear, setSelectedYear] = useState<number>(() => new Date().getFullYear());

  // Parse Google Sheets data into typed reservation events
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

  // Merge internal sheets bookings and external Airbnb calendar events
  const unifiedBookings = useMemo(() => {
    const list: UnifiedBooking[] = [];

    // 1. Google Sheet bookings
    if (startHeader) {
      data.rows.forEach((row, idx) => {
        const startStr = row[startHeader];
        const endStr = endHeader ? row[endHeader] : null;
        const start = parseDateStr(startStr);
        const end = endStr ? parseDateStr(endStr) : null;

        if (start) {
          const actualEnd = end || start;
          list.push({
            id: `sheet-${row.id || idx}`,
            title: row[nameHeader] || 'Réservation',
            start,
            end: actualEnd,
            source: (sourceHeader && row[sourceHeader]) ? row[sourceHeader] : 'Direct',
            row
          });
        }
      });
    }

    // 2. Airbnb External bookings (prevent duplicates if they overlap exactly)
    externalEvents.forEach((ext, idx) => {
      const isAlreadyIncluded = list.some(b => {
        // Simple overlapping or date coincidence check
        return isSameDay(b.start, ext.start) && isSameDay(b.end, ext.end);
      });

      if (!isAlreadyIncluded) {
        list.push({
          id: `ext-${idx}`,
          title: ext.summary || 'Airbnb Externe',
          start: ext.start,
          end: ext.end,
          source: 'Airbnb'
        });
      }
    });

    return list;
  }, [data.rows, startHeader, endHeader, nameHeader, sourceHeader, externalEvents]);

  // Switch years
  const handlePrevYear = () => setSelectedYear(prev => prev - 1);
  const handleNextYear = () => setSelectedYear(prev => prev + 1);

  // Generate 12 months for the selected year
  const months = useMemo(() => {
    return Array.from({ length: 12 }, (_, i) => {
      const firstDay = new Date(selectedYear, i, 1);
      const name = format(firstDay, 'MMMM', { locale: fr });
      
      // French start week Monday: (day + 6) % 7
      const startOffset = (firstDay.getDay() + 6) % 7;
      const totalDays = new Date(selectedYear, i + 1, 0).getDate();

      // Build day cells list including null padding
      const cells: (Date | null)[] = [];
      for (let offset = 0; offset < startOffset; offset++) {
        cells.push(null);
      }
      for (let day = 1; day <= totalDays; day++) {
        cells.push(new Date(selectedYear, i, day));
      }

      // Group days into weeks array
      const weeks: (Date | null)[][] = [];
      let currentWeek: (Date | null)[] = [];
      
      cells.forEach((cell, idx) => {
        currentWeek.push(cell);
        if (currentWeek.length === 7 || idx === cells.length - 1) {
          // Pad last week to always have 7 keys
          while (currentWeek.length < 7) {
            currentWeek.push(null);
          }
          weeks.push(currentWeek);
          currentWeek = [];
        }
      });

      return {
        monthIndex: i,
        name,
        weeks
      };
    });
  }, [selectedYear]);

  // Check if a day has a booking night (start is inclusive, end checkout is exclusive for stay night)
  const getBookingForDay = (date: Date | null) => {
    if (!date) return null;
    return unifiedBookings.find(b => {
      const dTime = date.getTime();
      return dTime >= b.start.getTime() && dTime < b.end.getTime();
    });
  };

  // Helper to get initials for guest profiles
  const getInitials = (title: string) => {
    const cleaned = title.replace(/(Chalet|Maison|Airbnb|Booking|Appartement|Studio)/gi, '').trim();
    if (!cleaned) return 'G';
    const parts = cleaned.split(/[\s+]+/);
    if (parts.length >= 2) {
      return (parts[0][0] + parts[1][0]).toUpperCase();
    }
    return cleaned.substring(0, 2).toUpperCase();
  };

  return (
    <div className="border border-slate-800 rounded-xl bg-slate-950/40 flex-1 flex flex-col shadow-lg overflow-hidden h-full">
      {/* Calendar Toolbar */}
      <div className="px-6 py-4 border-b border-slate-800 bg-slate-900/80 shrink-0 flex flex-col sm:flex-row justify-between items-center gap-4">
        <div>
          <h3 className="text-sm font-semibold uppercase text-slate-400 tracking-wider">Calendrier Annuel</h3>
          <p className="text-xs text-slate-500 mt-1">Vision d'ensemble des jours occupés, des week-ends et du barème de tarifs.</p>
        </div>

        {/* Year Changer */}
        <div className="flex items-center space-x-4 bg-slate-950 px-3 py-1.5 rounded-lg border border-slate-800">
          <button 
            onClick={handlePrevYear}
            className="p-1 hover:bg-slate-800 rounded text-slate-400 hover:text-white transition-colors cursor-pointer"
            title="Année précédente"
          >
            <ChevronLeft className="w-5 h-5" />
          </button>
          <span className="font-mono font-bold text-lg text-white select-none whitespace-nowrap min-w-[60px] text-center">
            {selectedYear}
          </span>
          <button 
            onClick={handleNextYear}
            className="p-1 hover:bg-slate-800 rounded text-slate-400 hover:text-white transition-colors cursor-pointer"
            title="Année suivante"
          >
            <ChevronRight className="w-5 h-5" />
          </button>
        </div>
      </div>

      {/* Grid of Months */}
      <div className="flex-1 overflow-y-auto p-6 space-y-12">
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-8">
          {months.map((month) => (
            <div key={month.monthIndex} className="bg-slate-950/20 border border-slate-800/50 rounded-xl p-4 flex flex-col">
              {/* Month Name */}
              <h4 className="text-lg font-bold text-slate-200 capitalize mb-4 tracking-tight px-1 flex items-center justify-between">
                <span>{month.name}</span>
                <span className="text-xs font-mono font-light text-slate-500">{selectedYear}</span>
              </h4>

              {/* Weekday Header */}
              <div className="grid grid-cols-7 text-center text-[10px] font-bold text-slate-500 mb-2 border-b border-slate-800/40 pb-1.5 uppercase tracking-wider">
                <div>L</div>
                <div>M</div>
                <div>M</div>
                <div>J</div>
                <div>V</div>
                <div className="text-slate-400">S</div>
                <div className="text-slate-400">D</div>
              </div>

              {/* Month Grid */}
              <div className="space-y-1 flex-1">
                {month.weeks.map((week, wIdx) => {
                  // Determine distinct reservation spans inside this week
                  const spans: { startCol: number; endCol: number; booking: UnifiedBooking }[] = [];
                  let currentSpan: { startCol: number; booking: UnifiedBooking } | null = null;

                  week.forEach((day, colIdx) => {
                    const booking = getBookingForDay(day);
                    if (booking) {
                      if (currentSpan && currentSpan.booking.id === booking.id) {
                        // Keep current span going
                      } else {
                        // End current span if exists and different
                        if (currentSpan) {
                          spans.push({
                            startCol: currentSpan.startCol,
                            endCol: colIdx - 1,
                            booking: currentSpan.booking
                          });
                        }
                        currentSpan = { startCol: colIdx, booking };
                      }
                    } else {
                      if (currentSpan) {
                        spans.push({
                          startCol: currentSpan.startCol,
                          endCol: colIdx - 1,
                          booking: currentSpan.booking
                        });
                        currentSpan = null;
                      }
                    }
                  });

                  // Log final span if it goes to the end of the week
                  if (currentSpan) {
                    spans.push({
                      startCol: currentSpan.startCol,
                      endCol: 6,
                      booking: currentSpan.booking
                    });
                  }

                  return (
                    <div key={wIdx} className="grid grid-cols-7 gap-px relative min-h-[46px] group/week">
                      {/* Background Day Cells */}
                      {week.map((day, dIdx) => {
                        if (!day) {
                          return <div key={`empty-${dIdx}`} className="bg-slate-950/10 min-h-[46px]" />;
                        }

                        const dayNum = day.getDate();
                        const isWeekend = dIdx === 5 || dIdx === 6; // Saturdays and Sundays
                        const booking = getBookingForDay(day);

                        return (
                          <div 
                            key={`day-${dayNum}`} 
                            className={`min-h-[46px] p-1 flex flex-col rounded border border-transparent transition-all relative
                              ${isWeekend ? 'bg-slate-900/40' : 'bg-slate-950/30'}
                              ${booking ? 'bg-slate-900/10' : 'hover:border-slate-700/60'}
                            `}
                          >
                            {/* Day Number */}
                            <span className={`text-[11px] font-semibold block leading-none
                              ${booking ? 'line-through text-slate-600 font-normal' : isWeekend ? 'text-slate-400' : 'text-slate-500'}
                            `}>
                              {dayNum}
                            </span>
                          </div>
                        );
                      })}

                      {/* Foreground Booking Span Overlay Bars */}
                      {spans.map((span, sIdx) => {
                        const { startCol, endCol, booking } = span;
                        const isMilliot = /milliot/i.test(booking.title);
                        const isAirbnb = /airbnb/i.test(booking.source) && !isMilliot;
                        const isBookingCom = /booking/i.test(booking.source) && !isMilliot;
                        
                        // Layout properties based on booking source
                        let barBgColor = "bg-indigo-600/95 border-indigo-500/30 text-white";
                        if (isMilliot) {
                          barBgColor = "bg-purple-600/95 border-purple-500/30 text-white";
                        } else if (isAirbnb) {
                          barBgColor = "bg-rose-500/90 border-rose-400/30 text-white";
                        } else if (isBookingCom) {
                          barBgColor = "bg-sky-600/95 border-sky-500/30 text-white";
                        } else if (booking.source === 'Direct') {
                          barBgColor = "bg-emerald-600/95 border-emerald-500/30 text-white";
                        } else {
                          // Standard beautiful slate-colored booking
                          barBgColor = "bg-slate-700/95 border-slate-600/30 text-white";
                        }

                        const leftPercent = (startCol / 7) * 100;
                        const widthPercent = ((endCol - startCol + 1) / 7) * 100;

                        return (
                          <div
                            key={`span-${sIdx}`}
                            onClick={() => {
                              if (booking.row) {
                                onCellClick(booking.row);
                              }
                            }}
                            className={`absolute bottom-1 h-5 rounded flex items-center px-1 border select-none overflow-hidden transition-all shadow-[0_2px_4px_rgba(0,0,0,0.2)]
                              ${barBgColor}
                              ${booking.row ? 'cursor-pointer hover:scale-[1.02] active:scale-[0.98]' : 'cursor-default'}
                            `}
                            style={{
                              left: `calc(${leftPercent}% + 2px)`,
                              width: `calc(${widthPercent}% - 4px)`
                            }}
                            title={`${booking.title} (${isMilliot ? "Séjour Famille" : booking.source})`}
                          >
                            <div className="flex items-center space-x-1 shrink-0">
                              {/* Avatar Initials Circle */}
                              <div className="w-3.5 h-3.5 rounded-full bg-black/25 flex items-center justify-center text-[8px] font-bold text-slate-100">
                                {isMilliot ? "🏠" : getInitials(booking.title)}
                              </div>
                            </div>
                            <span className="text-[9px] font-medium truncate ml-1 leading-none">
                              {booking.title}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
