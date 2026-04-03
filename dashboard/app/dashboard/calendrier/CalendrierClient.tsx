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
  { label: 'Jaune', value: '#f59e0b' },
  { label: 'Bleu', value: '#3b82f6' },
  { label: 'Vert', value: '#22c55e' },
  { label: 'Rouge', value: '#ef4444' },
  { label: 'Violet', value: '#8b5cf6' },
  { label: 'Rose', value: '#ec4899' },
  { label: 'Cyan', value: '#06b6d4' },
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
                {props.tel && (
                  <a
                    href={`tel:${props.tel}`}
                    className="flex-1 text-center px-4 py-2.5 bg-green-600 text-white rounded-lg font-medium text-sm hover:bg-green-500 transition"
                  >
                    Appeler
                  </a>
                )}
                <a
                  href={`/dashboard/devis/${props.quoteId}`}
                  className="flex-1 text-center px-4 py-2.5 bg-amber-500 text-black rounded-lg font-medium text-sm hover:bg-amber-400 transition"
                >
                  Devis #{props.quoteId as number}
                </a>
              </div>
              {(props.statut === 'facture' || props.statut === 'paye') && (
                <a
                  href={`/dashboard/factures`}
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
              <label className="block text-slate-400 text-xs mb-1">Début</label>
              <input
                type={isAllDay ? 'date' : 'datetime-local'}
                value={isAllDay ? start.split('T')[0] : start.slice(0, 16)}
                onChange={e => setStart(isAllDay ? e.target.value + 'T08:00:00' : e.target.value)}
                className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-amber-500"
              />
            </div>
            <div>
              <label className="block text-slate-400 text-xs mb-1">Fin</label>
              <input
                type={isAllDay ? 'date' : 'datetime-local'}
                value={isAllDay ? end.split('T')[0] : end.slice(0, 16)}
                onChange={e => setEnd(isAllDay ? e.target.value + 'T17:00:00' : e.target.value)}
                className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-amber-500"
              />
            </div>
          </div>

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

/* ─── Main Calendar Component ─── */
export default function CalendrierClient({ bookings, calendarToken }: { bookings: Booking[]; calendarToken: string }) {
  const calendarRef = useRef<FullCalendar | null>(null);
  const [events, setEvents] = useState<EventInput[]>([]);
  const [showCreate, setShowCreate] = useState<{ start: string; end: string; allDay: boolean } | null>(null);
  const [selectedEvent, setSelectedEvent] = useState<{ id: string; title: string; start: string; end?: string; props: Record<string, unknown> } | null>(null);
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

  // Handle event click — show details
  const handleEventClick = useCallback((clickInfo: EventClickArg) => {
    const ev = clickInfo.event;
    let props: Record<string, unknown> = {};
    try {
      // FullCalendar stores our extendedProps string inside ev.extendedProps.extendedProps
      const raw = ev.extendedProps?.extendedProps;
      if (typeof raw === 'string' && raw.length > 0) {
        props = JSON.parse(raw);
      } else if (ev.extendedProps?.type) {
        // Direct props (shouldn't happen but fallback)
        props = { ...ev.extendedProps };
      }
    } catch {
      props = {};
    }
    setSelectedEvent({
      id: ev.id,
      title: ev.title,
      start: ev.startStr,
      end: ev.endStr || undefined,
      props,
    });
  }, []);

  // Handle drag-and-drop move
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

      {/* Event Detail Modal */}
      {selectedEvent && (
        <EventDetailModal
          event={selectedEvent}
          onClose={() => setSelectedEvent(null)}
          onDelete={handleDeleteEvent}
        />
      )}
    </div>
  );
}
