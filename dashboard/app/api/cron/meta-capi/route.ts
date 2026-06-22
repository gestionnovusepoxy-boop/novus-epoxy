import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { sendConversionEvent } from '@/lib/meta-capi';

export const maxDuration = 60;

/**
 * Vercel Cron — Meta Conversions API.
 *
 * Parcourt les devis passés à `depot_paye` dans les dernières 24h qui n'ont pas
 * encore d'event CAPI (capi_sent = FALSE), et envoie un event "Purchase" à Meta
 * avec la vraie valeur du contrat (total). Marque ensuite chaque devis pour ne
 * pas le ré-envoyer (dédup via event_id = quote_<id>).
 *
 * OFF si META_PIXEL_ID absent (no-op propre — la feature n'est pas activée tant
 * que le pixel n'est pas configuré). Aucun envoi de masse à des clients: c'est
 * du serveur-à-serveur vers Meta uniquement.
 */
export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization')?.replace('Bearer ', '') ?? '';
  const cronSecret = process.env.CRON_SECRET ?? '';
  const adminKey = process.env.ADMIN_API_KEY ?? '';
  if (!authHeader || (authHeader !== cronSecret && authHeader !== adminKey)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // OFF tant que le pixel n'est pas configuré.
  if (!(process.env.META_PIXEL_ID ?? '').trim()) {
    return NextResponse.json({ ok: true, skipped: 'META_PIXEL_ID absent' });
  }

  try {
    // Devis passés à depot_paye dans les dernières 24h, pas encore envoyés à Meta.
    const rows = await query(`
      SELECT id, client_email, client_tel, total, deposit_paid_at
      FROM quotes
      WHERE statut = 'depot_paye'
        AND capi_sent = FALSE
        AND deposit_paid_at IS NOT NULL
        AND deposit_paid_at >= NOW() - INTERVAL '24 hours'
      ORDER BY deposit_paid_at ASC
      LIMIT 50
    `);

    let sent = 0;
    let failed = 0;
    const errors: string[] = [];

    for (const r of rows) {
      const quoteId = r.id as number;
      const value = Number(r.total ?? 0);

      const result = await sendConversionEvent({
        eventName: 'Purchase',
        value,
        currency: 'CAD',
        email: (r.client_email as string) ?? null,
        phone: (r.client_tel as string) ?? null,
        eventTime: (r.deposit_paid_at as string) ?? null,
        eventId: `quote_${quoteId}`,
      });

      if (result.ok && !result.skipped) {
        await query(
          `UPDATE quotes SET capi_sent = TRUE, capi_sent_at = NOW() WHERE id = $1`,
          [quoteId]
        );
        sent++;
      } else if (result.skipped) {
        // Pixel disparu en cours de run — on arrête proprement.
        break;
      } else {
        failed++;
        if (result.error) errors.push(`#${quoteId}: ${result.error}`);
      }
    }

    return NextResponse.json({
      ok: true,
      candidates: rows.length,
      sent,
      failed,
      errors: errors.slice(0, 10),
    });
  } catch (err) {
    const e = err as Error;
    console.error('meta-capi cron fatal:', e);
    return NextResponse.json(
      { error: e?.message ?? 'unknown' },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  return GET(req);
}
