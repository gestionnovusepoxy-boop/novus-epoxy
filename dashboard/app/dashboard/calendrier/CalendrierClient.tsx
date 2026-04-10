'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import FullCalendar from '@fullcalendar/react';
import dayGridPlugin from '@fullcalendar/daygrid';
import timeGridPlugin from '@fullcalendar/timegrid';
import interactionPlugin from '@fullcalendar/interaction';
import listPlugin from '@fullcalendar/list';
import type { EventClickArg, DateSelectArg, EventDropArg, EventInput } from '@fullcalendar/core';
import type { EventResizeDoneArg } from '@fullcalendar/interaction';
import frLocale from '@fullcalendar/core/locales/fr-ca';

interface Booking {
  id: number;
  jour1_date: string;
  jour1_slot: string;
  jour2_date: string;
  jour2_slot: string;
  statut: string;
  client_nom: string;
  client_adresse: string | null;
  client_tel: string | null;
  client_email: string | null;
  type_service: string;
  superficie: number;
  total: number;
  quote_id: number;
}

interface CalendarEvent {
  id: string;
  title: string;
  start: string;
  end?: string;
  allDay?: boolean;
  backgroundColor?: string;
  borderColor?: string;
  extendedProps?: string;
  editable?: boolean;
}

const EVENT_COLORS = [
  { label: 'Rendez-vous client', value: '#f59e0b' },
  { label: 'Travaux confirmes', value: '#3b82f6' },
  { label: 'Complete / Termine', value: '#22c55e' },
  { label: 'Urgent / Important', value: '#ef4444' },
  { label: 'Estimation / Visite', value: '#8b5cf6' },
  { label: 'Personnel', value: '#ec4899' },
  { label: 'Rappel / Suivi', value: '#06b6d4' },
];

const EVENT_TYPES = [
  { label: 'Rendez-vous', value: 'rdv' },
  { label: 'Rappel', value: 'rappel' },
  { label: 'Estimation', value: 'estimation' },
  { label: 'Personnel', value: 'personnel' },
  { label: 'Autre', value: 'autre' },
];

function formatMoney(n: number) {
  return new Intl.NumberFormat('fr-CA', { style: 'currency', currency: 'CAD' }).format(n);
}

/* ─── Event Detail Modal ─── */
function EventDetailModal({
  event,
  onClose,
  onDelete,
}: {
  event: { id: string; title: string; start: string; end?: string; props: Record<string, unknown> };
  onClose: () => void;
  onDelete: (id: string) => void;
}) {
  const props = event.props;
  const isBooking = props.type === 'booking';

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-slate-800 rounded-xl max-w-md w-full border border-slate-700" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between p-4 border-b border-slate-700">
          <h3 className="text-white font-bold text-lg">{event.title}</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-white text-xl">&times;</button>
        </div>
        <div className="p-4 space-y-3">
          {isBooking ? (
            <>
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div>
                  <span className="text-slate-500">Client</span>
                  <p className="text-white font-medium">{props.nom as string}</p>
                </div>
                <div>
                  <span className="text-slate-500">Service</span>
                  <p className="text-white">{props.service as string}</p>
                </div>
                <div>
                  <span className="text-slate-500">Superficie</span>
                  <p className="text-white">{props.superficie as number} pi²</p>
                </div>
                <div>
                  <span className="text-slate-500">Total</span>
                  <p className="text-amber-400 font-bold">{formatMoney(props.total as number)}</p>
                </div>
              </div>
              {props.adresse && (
                <div className="text-sm">
                  <span className="text-slate-500">Adresse</span>
                  <p className="text-white">{props.adresse as string}</p>
                </div>
              )}
              {props.tel && (
                <a href={`tel:${props.tel}`} className="block text-amber-400 text-sm hover:underline">
                  {props.tel as string}
                </a>
              )}
              <div className="flex items-center gap-2 text-xs mt-2">
                {(() => {
                  const s = props.statut as string;
                  const isComplete = s === 'complete' || s === 'paye' || s === 'facture';
                  const isProvisoire = s === 'en_attente';
                  const cls = isComplete
                    ? 'bg-green-500/20 text-green-400 border border-green-500/30'
                    : isProvisoire
                    ? 'bg-amber-500/20 text-amber-400 border border-amber-500/30'
                    : 'bg-blue-500/20 text-blue-400 border border-blue-500/30';
                  const label = isComplete ? 'Complete' : isProvisoire ? 'Provisoire' : 'Confirme';
                  return <span className={`px-2 py-1 rounded ${cls}`}>{label}</span>;
                })()}
              </div>
              <div className="flex gap-2 mt-3">
                {String(props.tel || '') && (
                  <a
                    href={`tel:${String(props.tel)}`}
                    className="flex-1 text-center px-4 py-2.5 bg-green-600 text-white rounded-lg font-medium text-sm hover:bg-green-500 transition"
                  >
                    Appeler
                  </a>
                )}
                <a
                  href={`/dashboard/devis/${String(props.quoteId)}`}
                  className="flex-1 text-center px-4 py-2.5 bg-amber-500 text-black rounded-lg font-medium text-sm hover:bg-amber-400 transition"
                >
                  Devis #{String(props.quoteId)}
                </a>
              </div>
              {(props.statut === 'facture' || props.statut === 'paye') && (
                <a
                  href="/dashboard/factures"
                  className="block w-full text-center px-4 py-2.5 bg-purple-600 text-white rounded-lg font-medium text-sm hover:bg-purple-500 transition"
                >
                  Voir facture
                </a>
              )}
            </>
          ) : (
            <>
              {props.description && (
                <div className="text-sm">
                  <span className="text-slate-500">Description</span>
                  <p className="text-white">{props.description as string}</p>
                </div>
              )}
              <div className="text-sm">
                <span className="text-slate-500">Type</span>
                <p className="text-white capitalize">{(props.event_type as string) || 'Manuel'}</p>
              </div>
              <button
                onClick={() => { onDelete(event.id); onClose(); }}
                className="w-full mt-3 px-4 py-2 bg-red-500/20 text-red-400 border border-red-500/30 rounded-lg text-sm font-medium hover:bg-red-500/30 transition"
              >
                Supprimer cet événement
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/* ─── Create Event Modal ─── */
function CreateEventModal({
  initialStart,
  initialEnd,
  allDay,
  onClose,
  onSave,
}: {
  initialStart: string;
  initialEnd: string;
  allDay: boolean;
  onClose: () => void;
  onSave: (data: { title: string; description: string; start: string; end: string; allDay: boolean; color: string; event_type: string }) => void;
}) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [start, setStart] = useState(initialStart);
  const [end, setEnd] = useState(initialEnd);
  const [isAllDay, setIsAllDay] = useState(allDay);
  const [color, setColor] = useState('#f59e0b');
  const [eventType, setEventType] = useState('rdv');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;
    onSave({ title, description, start, end, allDay: isAllDay, color, event_type: eventType });
  };

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-slate-800 rounded-xl max-w-md w-full border border-slate-700" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between p-4 border-b border-slate-700">
          <h3 className="text-white font-bold text-lg">Nouveau rendez-vous</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-white text-xl">&times;</button>
        </div>
        <form onSubmit={handleSubmit} className="p-4 space-y-3">
          <div>
            <label className="block text-slate-400 text-xs mb-1">Titre *</label>
            <input
              type="text"
              value={title}
              onChange={e => setTitle(e.target.value)}
              placeholder="Ex: Estimation chez M. Tremblay"
              className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-amber-500"
              autoFocus
            />
          </div>

          <div>
            <label className="block text-slate-400 text-xs mb-1">Description</label>
            <textarea
              value={description}
              onChange={e => setDescription(e.target.value)}
              placeholder="Notes, adresse, details..."
              rows={2}
              className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-amber-500 resize-none"
            />
          </div>

          <div>
            <label className="block text-slate-400 text-xs mb-1">Type</label>
            <div className="flex flex-wrap gap-1.5">
              {EVENT_TYPES.map(t => (
                <button
                  key={t.value}
                  type="button"
                  onClick={() => setEventType(t.value)}
                  className={`px-2.5 py-1 rounded-lg text-xs font-medium transition ${
                    eventType === t.value ? 'bg-amber-500 text-black' : 'bg-slate-700 text-slate-400 hover:text-white'
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-slate-400 text-xs mb-1">Date début</label>
              <input
                type="date"
                value={start.split('T')[0]}
                onChange={e => {
                  const time = start.includes('T') ? start.split('T')[1] : '08:00:00';
                  setStart(e.target.value + 'T' + time);
                }}
                className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-amber-500"
              />
            </div>
            <div>
              <label className="block text-slate-400 text-xs mb-1">Date fin</label>
              <input
                type="date"
                value={end.split('T')[0]}
                onChange={e => {
                  const time = end.includes('T') ? end.split('T')[1] : '16:00:00';
                  setEnd(e.target.value + 'T' + time);
                }}
                className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-amber-500"
              />
            </div>
          </div>

          {!isAllDay && (
            <div className="space-y-2">
              <div className="flex gap-2">
                {[
                  { label: 'AM', value: 'am' },
                  { label: 'PM', value: 'pm' },
                ].map(slot => {
                  const currentHour = parseInt(start.split('T')[1]?.split(':')[0] || '8');
                  const isAm = currentHour < 12;
                  const active = (slot.value === 'am' && isAm) || (slot.value === 'pm' && !isAm);
                  return (
                    <button
                      key={slot.value}
                      type="button"
                      onClick={() => {
                        const date = start.split('T')[0];
                        const endDate = end.split('T')[0];
                        if (slot.value === 'am') {
                          setStart(date + 'T08:00:00');
                          setEnd(endDate + 'T12:00:00');
                        } else {
                          setStart(date + 'T12:00:00');
                          setEnd(endDate + 'T16:00:00');
                        }
                      }}
                      className={`flex-1 px-3 py-2 rounded-lg text-sm font-medium transition ${
                        active ? 'bg-amber-500 text-black' : 'bg-slate-700 text-slate-400 hover:text-white'
                      }`}
                    >
                      {slot.label}
                    </button>
                  );
                })}
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-400 text-[10px] mb-0.5">Heure debut</label>
                  <input
                    type="time"
                    value={start.split('T')[1]?.slice(0, 5) || '08:00'}
                    onChange={e => setStart(start.split('T')[0] + 'T' + e.target.value + ':00')}
                    className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-amber-500"
                  />
                </div>
                <div>
                  <label className="block text-slate-400 text-[10px] mb-0.5">Heure fin</label>
                  <input
                    type="time"
                    value={end.split('T')[1]?.slice(0, 5) || '12:00'}
                    onChange={e => setEnd(end.split('T')[0] + 'T' + e.target.value + ':00')}
                    className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-amber-500"
                  />
                </div>
              </div>
            </div>
          )}

          <label className="flex items-center gap-2 text-sm text-slate-400 cursor-pointer">
            <input type="checkbox" checked={isAllDay} onChange={e => setIsAllDay(e.target.checked)} className="rounded" />
            Journée complète
          </label>

          <div>
            <label className="block text-slate-400 text-xs mb-1">Couleur</label>
            <div className="flex gap-2">
              {EVENT_COLORS.map(c => (
                <button
                  key={c.value}
                  type="button"
                  onClick={() => setColor(c.value)}
                  className={`w-7 h-7 rounded-full border-2 transition ${color === c.value ? 'border-white scale-110' : 'border-transparent'}`}
                  style={{ backgroundColor: c.value }}
                  title={c.label}
                />
              ))}
            </div>
          </div>

          <div className="flex gap-2 pt-2">
            <button type="button" onClick={onClose} className="flex-1 px-4 py-2.5 bg-slate-700 text-slate-300 rounded-lg text-sm hover:bg-slate-600 transition">
              Annuler
            </button>
            <button type="submit" className="flex-1 px-4 py-2.5 bg-amber-500 text-black rounded-lg text-sm font-bold hover:bg-amber-400 transition">
              Ajouter
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

/* ─── Edit Booking Modal ─── */
function EditBookingModal({
  booking,
  onClose,
  onSave,
}: {
  booking: {
    bookingId: number;
    quoteId: number;
    nom: string;
    adresse: string | null;
    tel: string | null;
    service: string;
    superficie: number;
    total: number;
    statut: string;
    jour1_date: string;
    jour1_slot: string;
    jour2_date: string | null;
    jour2_slot: string | null;
  };
  onClose: () => void;
  onSave: (data: { id: number; jour1_date: string; jour1_slot: string; jour2_date: string | null; jour2_slot: string | null }) => void;
}) {
  const [jour1Date, setJour1Date] = useState(booking.jour1_date);
  const [jour1Slot, setJour1Slot] = useState<string>(booking.jour1_slot || 'matin');
  const [jour2Date, setJour2Date] = useState(booking.jour2_date || '');
  const [jour2Slot, setJour2Slot] = useState<string>(booking.jour2_slot || 'apres-midi');
  const [jour1Only, setJour1Only] = useState(!booking.jour2_date);
  const [saving, setSaving] = useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    onSave({
      id: booking.bookingId,
      jour1_date: jour1Date,
      jour1_slot: jour1Slot,
      jour2_date: jour1Only ? null : jour2Date || null,
      jour2_slot: jour1Only ? null : jour2Slot,
    });
  };

  const isComplete = booking.statut === 'complete' || booking.statut === 'paye' || booking.statut === 'facture';
  const isProvisoire = booking.statut === 'en_attente';
  const statusCls = isComplete
    ? 'bg-green-500/20 text-green-400 border border-green-500/30'
    : isProvisoire
    ? 'bg-amber-500/20 text-amber-400 border border-amber-500/30'
    : 'bg-blue-500/20 text-blue-400 border border-blue-500/30';
  const statusLabel = isComplete ? 'Complete' : isProvisoire ? 'Provisoire' : 'Confirme';

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-slate-800 rounded-xl max-w-lg w-full border border-slate-700" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between p-4 border-b border-slate-700">
          <h3 className="text-white font-bold text-lg">Modifier la reservation</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-white text-xl">&times;</button>
        </div>
        <div className="p-4 space-y-4">
          {/* Client info */}
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div>
              <span className="text-slate-500">Client</span>
              <p className="text-white font-medium">{booking.nom}</p>
            </div>
            <div>
              <span className="text-slate-500">Service</span>
              <p className="text-white">{booking.service}</p>
            </div>
            <div>
              <span className="text-slate-500">Superficie</span>
              <p className="text-white">{booking.superficie} pi&sup2;</p>
            </div>
            <div>
              <span className="text-slate-500">Total</span>
              <p className="text-amber-400 font-bold">{formatMoney(booking.total)}</p>
            </div>
          </div>
          {booking.adresse && (
            <div className="text-sm">
              <span className="text-slate-500">Adresse</span>
              <p className="text-white">{booking.adresse}</p>
            </div>
          )}
          {booking.tel && (
            <a href={`tel:${booking.tel}`} className="block text-amber-400 text-sm hover:underline">
              {booking.tel}
            </a>
          )}
          <div className="flex items-center gap-2 text-xs">
            <span className={`px-2 py-1 rounded ${statusCls}`}>{statusLabel}</span>
          </div>

          {/* Date editing */}
          {!isComplete && (
            <form onSubmit={handleSubmit} className="space-y-3 border-t border-slate-700 pt-4">
              {/* Jour 1 */}
              <div>
                <label className="block text-slate-400 text-xs mb-1 font-semibold">Jour 1 (preparation)</label>
                <div className="flex gap-2">
                  <input
                    type="date"
                    value={jour1Date}
                    onChange={e => setJour1Date(e.target.value)}
                    className="flex-1 bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-amber-500"
                    required
                  />
                  <div className="flex gap-1">
                    {[
                      { label: 'AM', value: 'matin', hint: '8h-12h' },
                      { label: 'PM', value: 'apres-midi', hint: '12h-16h' },
                    ].map(s => (
                      <button
                        key={s.value}
                        type="button"
                        onClick={() => setJour1Slot(s.value)}
                        title={s.hint}
                        className={`px-3 py-2 rounded-lg text-sm font-medium transition ${
                          jour1Slot === s.value ? 'bg-amber-500 text-black' : 'bg-slate-700 text-slate-400 hover:text-white'
                        }`}
                      >
                        {s.label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {/* Jour 1 only checkbox */}
              <label className="flex items-center gap-2 text-sm text-slate-400 cursor-pointer">
                <input
                  type="checkbox"
                  checked={jour1Only}
                  onChange={e => setJour1Only(e.target.checked)}
                  className="rounded"
                />
                Jour 1 seulement (pas de jour 2)
              </label>

              {/* Jour 2 */}
              {!jour1Only && (
                <div>
                  <label className="block text-slate-400 text-xs mb-1 font-semibold">Jour 2 (finition)</label>
                  <div className="flex gap-2">
                    <input
                      type="date"
                      value={jour2Date}
                      onChange={e => setJour2Date(e.target.value)}
                      className="flex-1 bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-amber-500"
                      required
                    />
                    <div className="flex gap-1">
                      {[
                        { label: 'AM', value: 'matin', hint: '8h-12h' },
                        { label: 'PM', value: 'apres-midi', hint: '12h-16h' },
                      ].map(s => (
                        <button
                          key={s.value}
                          type="button"
                          onClick={() => setJour2Slot(s.value)}
                          title={s.hint}
                          className={`px-3 py-2 rounded-lg text-sm font-medium transition ${
                            jour2Slot === s.value ? 'bg-amber-500 text-black' : 'bg-slate-700 text-slate-400 hover:text-white'
                          }`}
                        >
                          {s.label}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              <button
                type="submit"
                disabled={saving}
                className="w-full px-4 py-2.5 bg-amber-500 text-black rounded-lg text-sm font-bold hover:bg-amber-400 transition disabled:opacity-50"
              >
                {saving ? 'Enregistrement...' : 'Sauvegarder les dates'}
              </button>
            </form>
          )}

          {/* Action buttons */}
          <div className="flex gap-2">
            {booking.tel && (
              <a
                href={`tel:${booking.tel}`}
                className="flex-1 text-center px-4 py-2.5 bg-green-600 text-white rounded-lg font-medium text-sm hover:bg-green-500 transition"
              >
                Appeler
              </a>
            )}
            <a
              href={`/dashboard/devis/${booking.quoteId}`}
              className="flex-1 text-center px-4 py-2.5 bg-amber-500 text-black rounded-lg font-medium text-sm hover:bg-amber-400 transition"
            >
              Voir devis #{booking.quoteId}
            </a>
          </div>
          {(booking.statut === 'facture' || booking.statut === 'paye') && (
            <a
              href="/dashboard/factures"
              className="block w-full text-center px-4 py-2.5 bg-purple-600 text-white rounded-lg font-medium text-sm hover:bg-purple-500 transition"
            >
              Voir facture
            </a>
          )}
        </div>
      </div>
    </div>
  );
}

/* ─── Main Calendar Component ─── */
export default function CalendrierClient({ bookings, calendarToken }: { bookings: Booking[]; calendarToken: string }) {
  const calendarRef = useRef<FullCalendar | null>(null);
  const [events, setEvents] = useState<EventInput[]>([]);
  const [showCreate, setShowCreate] = useState<{ start: string; end: string; allDay: boolean } | null>(null);
  const [selectedEvent, setSelectedEvent] = useState<{ id: string; title: string; start: string; end?: string; props: Record<string, unknown> } | null>(null);
  const [editBooking, setEditBooking] = useState<{
    bookingId: number; quoteId: number; nom: string; adresse: string | null; tel: string | null;
    service: string; superficie: number; total: number; statut: string;
    jour1_date: string; jour1_slot: string; jour2_date: string | null; jour2_slot: string | null;
  } | null>(null);
  const [showSync, setShowSync] = useState(false);
  const [loading, setLoading] = useState(true);

  const feedUrl = calendarToken ? `https://novus-epoxy.vercel.app/api/calendar/feed?token=${calendarToken}` : '';

  // Load events from API
  const loadEvents = useCallback(async () => {
    try {
      const res = await fetch('/api/calendar/events');
      if (!res.ok) return;
      const json = await res.json();
      setEvents(json.events || []);
    } catch { /* ignore */ }
    setLoading(false);
  }, []);

  useEffect(() => { loadEvents(); }, [loadEvents]);

  // Refresh every 30s
  useEffect(() => {
    const interval = setInterval(loadEvents, 30000);
    return () => clearInterval(interval);
  }, [loadEvents]);

  // Handle date selection (click/drag to create event)
  const handleDateSelect = useCallback((selectInfo: DateSelectArg) => {
    setShowCreate({
      start: selectInfo.startStr,
      end: selectInfo.endStr,
      allDay: selectInfo.allDay,
    });
    selectInfo.view.calendar.unselect();
  }, []);

  // Handle event click — show edit modal for bookings, detail modal for manual events
  const handleEventClick = useCallback((clickInfo: EventClickArg) => {
    const ev = clickInfo.event;
    let props: Record<string, unknown> = {};
    // extendedProps is now sent as an object from API, FullCalendar merges it directly
    const ep = ev.extendedProps || {};
    if (ep.type) {
      props = { ...ep };
    } else if (typeof ep.extendedProps === 'string') {
      try { props = JSON.parse(ep.extendedProps); } catch { props = {}; }
    } else if (typeof ep.extendedProps === 'object') {
      props = { ...ep.extendedProps };
    }

    // For booking events, open the edit modal
    if (props.type === 'booking') {
      setEditBooking({
        bookingId: props.bookingId as number,
        quoteId: props.quoteId as number,
        nom: props.nom as string,
        adresse: (props.adresse as string | null) || null,
        tel: (props.tel as string | null) || null,
        service: props.service as string,
        superficie: props.superficie as number,
        total: props.total as number,
        statut: props.statut as string,
        jour1_date: props.jour1_date as string,
        jour1_slot: props.jour1_slot as string,
        jour2_date: (props.jour2_date as string | null) || null,
        jour2_slot: (props.jour2_slot as string | null) || null,
      });
      return;
    }

    // For manual events, show the detail modal
    setSelectedEvent({
      id: ev.id,
      title: ev.title,
      start: ev.startStr,
      end: ev.endStr || undefined,
      props,
    });
  }, []);

  // Handle drag-and-drop move (both manual events and bookings)
  const handleEventDrop = useCallback(async (dropInfo: EventDropArg) => {
    const ev = dropInfo.event;
    try {
      const res = await fetch('/api/calendar/events', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: ev.id,
          start: ev.startStr,
          end: ev.endStr || null,
          allDay: ev.allDay,
        }),
      });
      if (!res.ok) dropInfo.revert();
      else loadEvents();
    } catch {
      dropInfo.revert();
    }
  }, [loadEvents]);

  // Save booking dates from edit modal
  const handleSaveBooking = useCallback(async (data: { id: number; jour1_date: string; jour1_slot: string; jour2_date: string | null; jour2_slot: string | null }) => {
    try {
      const res = await fetch('/api/bookings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      if (res.ok) {
        setEditBooking(null);
        loadEvents();
      }
    } catch { /* ignore */ }
  }, [loadEvents]);

  // Handle resize
  const handleEventResize = useCallback(async (resizeInfo: EventResizeDoneArg) => {
    const ev = resizeInfo.event;
    try {
      const res = await fetch('/api/calendar/events', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: ev.id,
          start: ev.startStr,
          end: ev.endStr || null,
        }),
      });
      if (!res.ok) resizeInfo.revert();
      else loadEvents();
    } catch {
      resizeInfo.revert();
    }
  }, [loadEvents]);

  // Save new event
  const handleSaveEvent = useCallback(async (data: { title: string; description: string; start: string; end: string; allDay: boolean; color: string; event_type: string }) => {
    try {
      await fetch('/api/calendar/events', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      setShowCreate(null);
      loadEvents();
    } catch { /* ignore */ }
  }, [loadEvents]);

  // Delete event
  const handleDeleteEvent = useCallback(async (id: string) => {
    try {
      await fetch(`/api/calendar/events?id=${id}`, { method: 'DELETE' });
      loadEvents();
    } catch { /* ignore */ }
  }, [loadEvents]);

  return (
    <div className="p-4 md:p-6 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-2xl font-bold text-white">Calendrier</h2>
          <p className="text-slate-400 text-sm">{events.length} événements — cliquez pour ajouter, glissez pour déplacer</p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => setShowCreate({ start: new Date().toISOString(), end: new Date(Date.now() + 3600000).toISOString(), allDay: false })}
            className="px-4 py-2 bg-amber-500 text-black rounded-lg text-sm font-bold hover:bg-amber-400 transition"
          >
            + Nouveau
          </button>
          <button
            onClick={() => {
              const tomorrow = new Date();
              tomorrow.setDate(tomorrow.getDate() + 1);
              tomorrow.setHours(9, 0, 0, 0);
              const end = new Date(tomorrow);
              end.setHours(10, 0, 0, 0);
              setShowCreate({ start: tomorrow.toISOString(), end: end.toISOString(), allDay: false });
            }}
            className="px-4 py-2 bg-cyan-600 text-white rounded-lg text-sm font-bold hover:bg-cyan-500 transition"
          >
            + Rappel
          </button>
          <button
            onClick={() => setShowSync(!showSync)}
            className="px-4 py-2 border border-slate-600 text-slate-300 rounded-lg text-sm hover:border-amber-500 hover:text-amber-500 transition"
          >
            Sync
          </button>
        </div>
      </div>

      {/* Sync instructions */}
      {showSync && feedUrl && (
        <div className="bg-slate-800 rounded-xl p-4 border border-slate-700">
          <h3 className="text-amber-400 font-semibold text-sm mb-2">Synchroniser avec votre téléphone</h3>
          <p className="text-slate-400 text-xs mb-1"><strong>iPhone:</strong> Réglages &gt; Calendrier &gt; Comptes &gt; Ajouter &gt; Autre &gt; Calendrier avec abonnement</p>
          <p className="text-slate-400 text-xs mb-2"><strong>Google:</strong> Paramètres &gt; Ajouter un calendrier &gt; À partir de l'URL</p>
          <div
            className="bg-slate-900 rounded-lg p-3 text-xs text-amber-400 break-all cursor-pointer hover:bg-slate-900/80"
            onClick={() => navigator.clipboard?.writeText(feedUrl)}
          >
            {feedUrl}
            <span className="block text-slate-600 mt-1">Cliquez pour copier</span>
          </div>
        </div>
      )}

      {/* Calendar */}
      <div className={`novus-calendar bg-slate-800 rounded-xl border border-slate-700 p-3 md:p-4 ${loading ? 'opacity-50' : ''}`}>
        <FullCalendar
          ref={calendarRef}
          plugins={[dayGridPlugin, timeGridPlugin, interactionPlugin, listPlugin]}
          initialView="dayGridMonth"
          locale={frLocale}
          headerToolbar={{
            left: 'prev,next today',
            center: 'title',
            right: 'dayGridMonth,timeGridWeek,timeGridDay,listWeek',
          }}
          buttonText={{
            today: "Aujourd'hui",
            month: 'Mois',
            week: 'Semaine',
            day: 'Jour',
            list: 'Liste',
          }}
          events={events}
          editable={true}
          selectable={true}
          selectMirror={true}
          dayMaxEvents={4}
          dayMaxEventRows={4}
          eventDisplay="block"
          eventOrder="start,-duration,allDay,title"
          nowIndicator={true}
          weekNumbers={false}
          slotMinTime="06:00:00"
          slotMaxTime="20:00:00"
          slotDuration="00:30:00"
          allDaySlot={true}
          expandRows={true}
          stickyHeaderDates={true}
          height="auto"
          contentHeight="auto"
          aspectRatio={1.8}
          select={handleDateSelect}
          eventClick={handleEventClick}
          eventDrop={handleEventDrop}
          eventResize={handleEventResize}
          eventTimeFormat={{ hour: 'numeric', minute: '2-digit', meridiem: false, hour12: false }}
          slotLabelFormat={{ hour: 'numeric', minute: '2-digit', meridiem: false, hour12: false }}
          firstDay={1}
          businessHours={{ daysOfWeek: [1, 2, 3, 4, 5, 6], startTime: '07:00', endTime: '18:00' }}
        />
      </div>

      {/* Légende */}
      <div className="flex flex-wrap gap-4 text-xs text-slate-400">
        <div className="flex items-center gap-1.5">
          <div className="w-3 h-3 rounded bg-blue-500" />
          <span>Travaux confirmés</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-3 h-3 rounded bg-amber-500" />
          <span>Provisoire / Manuel</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-3 h-3 rounded bg-green-500" />
          <span>Rendez-vous</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-3 h-3 rounded bg-red-500" />
          <span>Urgent</span>
        </div>
      </div>

      {/* Create Event Modal */}
      {showCreate && (
        <CreateEventModal
          initialStart={showCreate.start}
          initialEnd={showCreate.end}
          allDay={showCreate.allDay}
          onClose={() => setShowCreate(null)}
          onSave={handleSaveEvent}
        />
      )}

      {/* Event Detail Modal (manual events only) */}
      {selectedEvent && (
        <EventDetailModal
          event={selectedEvent}
          onClose={() => setSelectedEvent(null)}
          onDelete={handleDeleteEvent}
        />
      )}

      {/* Edit Booking Modal */}
      {editBooking && (
        <EditBookingModal
          booking={editBooking}
          onClose={() => setEditBooking(null)}
          onSave={handleSaveBooking}
        />
      )}
    </div>
  );
}
