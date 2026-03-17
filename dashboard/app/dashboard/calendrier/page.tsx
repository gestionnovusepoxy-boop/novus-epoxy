import { query } from '@/lib/db';
import { auth } from '@/lib/auth';
import { redirect } from 'next/navigation';
import CalendrierClient from './CalendrierClient';

export default async function CalendrierPage() {
  const session = await auth();
  if (!session) redirect('/auth/signin');

  // Get bookings for the next 60 days and past 7 days
  const bookings = await query(
    `SELECT b.id, b.jour1_date, b.jour1_slot, b.jour2_date, b.jour2_slot, b.statut,
            q.client_nom, q.client_adresse, q.client_tel, q.client_email,
            q.type_service, q.superficie, q.total, q.id AS quote_id
     FROM bookings b
     JOIN quotes q ON q.id = b.quote_id
     WHERE b.statut != 'annule'
       AND b.jour1_date >= CURRENT_DATE - INTERVAL '7 days'
     ORDER BY b.jour1_date ASC`,
    []
  );

  const calendarToken = process.env.CALENDAR_TOKEN || '';

  // Serialize dates
  const serialized = bookings.map(b => ({
    id: b.id as number,
    jour1_date: (b.jour1_date as Date).toISOString().split('T')[0],
    jour1_slot: b.jour1_slot as string,
    jour2_date: (b.jour2_date as Date).toISOString().split('T')[0],
    jour2_slot: b.jour2_slot as string,
    statut: b.statut as string,
    client_nom: b.client_nom as string,
    client_adresse: b.client_adresse as string | null,
    client_tel: b.client_tel as string | null,
    client_email: b.client_email as string | null,
    type_service: b.type_service as string,
    superficie: Number(b.superficie),
    total: Number(b.total),
    quote_id: b.quote_id as number,
  }));

  return <CalendrierClient bookings={serialized} calendarToken={calendarToken} />;
}
