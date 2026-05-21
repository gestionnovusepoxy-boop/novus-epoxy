import { NextRequest, NextResponse } from 'next/server';
import { getAdminChatIds } from '@/lib/telegram-utils';
import { query } from '@/lib/db';
import { SERVICES, type ServiceType, calculateQuote } from '@/lib/pricing';

export const maxDuration = 60;

const FB_SERVICE_MAP: Record<string, string> = {
  'flocon': 'flake', 'flake': 'flake', 'flocon_(flake)': 'flake', 'flocon (flake)': 'flake',
  'metallique': 'metallique', 'métallique': 'metallique',
  'quartz': 'quartz',
  'couleur_unie': 'couleur_unie', 'couleur unie': 'couleur_unie',
  'antiderapant': 'antiderapant', 'antidérapant': 'antiderapant',
  'commercial': 'commercial',
};

function mapService(raw: string): string {
  const lower = raw.toLowerCase().trim();
  return FB_SERVICE_MAP[lower] ?? lower.slice(0, 120);
}

function mapEspace(raw: string): string {
  const lower = raw.toLowerCase();
  if (lower.includes('garage')) return 'Garage';
  if (lower.includes('sous-sol') || lower.includes('sous sol')) return 'Sous-sol';
  if (lower.includes('balcon')) return 'Balcon';
  if (lower.includes('commercial')) return 'Commercial';
  return raw.slice(0, 120);
}

function extractVille(adresse: string): string | null {
  const parts = adresse.split(',').map(s => s.trim());
  if (parts.length > 1) return parts[parts.length - 1].replace(/[A-Z]\d[A-Z]\s?\d[A-Z]\d/i, '').trim() || null;
  return adresse.trim() || null;
}

async function notifyTelegram(nom: string, email: string, telephone: string | null, extra: { service?: string; espace?: string; superficie?: string; adresse?: string; quoteId?: number }) {
  // Leads FB = toujours notifier, pas de quiet hours
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  const chatIds = getAdminChatIds();
  if (!botToken || !chatIds.length) return;

  const lines = [
    `🔥 <b>Nouveau lead Facebook!</b>`,
    ``,
    `👤 ${nom}`,
    email ? `📧 ${email}` : '',
    telephone ? `📞 ${telephone}` : '',
    extra.espace ? `🏗 ${extra.espace}` : '',
    extra.service ? `🔧 ${extra.service}` : '',
    extra.superficie ? `📐 ${extra.superficie} pi²` : '',
    extra.adresse ? `🏠 ${extra.adresse}` : '',
    ``,
    extra.quoteId
      ? `✅ <b>Devis #${extra.quoteId} prêt — approuve pour envoyer!</b>`
      : `<i>⚡ Contacte-le ASAP — premier rendu gagne!</i>`,
  ].filter(Boolean).join('\n');

  const buttons = extra.quoteId
    ? [[
        { text: '✅ Approuver & envoyer', callback_data: `approve_quote_${extra.quoteId}` },
      ], [
        { text: '📋 Voir CRM', url: 'https://novus-epoxy.vercel.app/dashboard/crm' },
      ]]
    : [[{ text: '📋 Voir CRM', url: 'https://novus-epoxy.vercel.app/dashboard/crm' }]];

  await Promise.all(chatIds.map(chatId =>
    fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId.trim(), text: lines, parse_mode: 'HTML',
        reply_markup: { inline_keyboard: buttons },
      }),
    }).catch(() => {})
  ));
}

async function tryCreateDraftQuote(leadId: number, nom: string, email: string | null, telephone: string | null, adresse: string | null, service: string, superficieStr: string): Promise<number | null> {
  if (!SERVICES[service as ServiceType]) return null;
  const superficie = parseFloat(superficieStr);
  if (!superficie || superficie < 10) return null;

  // Avoid duplicate quotes for same lead
  const existing = await query(`SELECT id FROM quotes WHERE client_tel = $1 AND statut = 'brouillon' AND created_at >= NOW() - INTERVAL '7 days' LIMIT 1`, [telephone]).catch(() => []);
  if (existing?.length > 0) return existing[0].id as number;

  // Check active promo
  let rabaisPct = 0;
  try {
    const promoRows = await query(`SELECT rabais_pct FROM promotions WHERE actif = true AND date_debut <= CURRENT_DATE AND date_fin >= CURRENT_DATE ORDER BY rabais_pct DESC LIMIT 1`);
    if (promoRows.length > 0) rabaisPct = Number(promoRows[0].rabais_pct);
  } catch { /* no promo */ }

  const calc = calculateQuote(service as ServiceType, superficie, rabaisPct);
  const token = Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);

  const rows = await query(
    `INSERT INTO quotes (client_nom, client_email, client_tel, client_adresse, type_service, superficie,
      prix_pied_carre, rabais_pct, rabais_montant, sous_total, tps, tvq, total, depot_requis, statut, secret_token, notes)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,'brouillon',$15,$16) RETURNING id`,
    [nom, email, telephone, adresse, service, superficie,
     calc.prixPiedCarre, calc.rabaisPct, calc.rabaisMontant,
     calc.sousTotal, calc.tps, calc.tvq, calc.total, calc.depotRequis,
     token, `Lead Facebook #${leadId} — auto-devis`]
  ).catch(() => []);

  return rows?.[0]?.id ?? null;
}

export async function GET(req: NextRequest) {
  const secret = req.headers.get('authorization')?.replace('Bearer ', '') ?? '';
  if (secret !== (process.env.CRON_SECRET ?? '') && secret !== (process.env.ADMIN_API_KEY ?? '')) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const accessToken = process.env.META_PAGE_TOKEN;
  if (!accessToken) return NextResponse.json({ error: 'META_PAGE_TOKEN missing' }, { status: 500 });

  // Fetch all active forms on the page, then sync leads from each
  const pageId = '636757822863288';
  const formsRes = await fetch(
    `https://graph.facebook.com/v25.0/${pageId}/leadgen_forms?fields=id,status,leads_count&limit=50&access_token=${accessToken}`
  );
  if (!formsRes.ok) return NextResponse.json({ error: 'Meta forms API error', status: formsRes.status });
  const formsData = await formsRes.json();
  const activeForms: Array<{ id: string; leads_count: number }> = (formsData.data ?? [])
    .filter((f: { status: string; leads_count: number }) => f.status === 'ACTIVE' && f.leads_count > 0);

  let imported = 0;
  let skipped = 0;
  const allLeads: Array<{ id: string; created_time: string; field_data: Array<{ name: string; values: string[] }> }> = [];

  for (const form of activeForms) {
    const res = await fetch(
      `https://graph.facebook.com/v25.0/${form.id}/leads?fields=id,created_time,field_data&limit=50&access_token=${accessToken}`
    );
    if (!res.ok) continue;
    const data = await res.json();
    allLeads.push(...(data.data ?? []));
  }

  // Deduplicate by lead ID before processing
  const seen = new Set<string>();
  const fbLeads = allLeads.filter(l => { if (seen.has(l.id)) return false; seen.add(l.id); return true; });

  for (const lead of fbLeads) {
    // Skip test leads
    if (lead.field_data?.some(f => String(f.values?.[0] ?? '').startsWith('<test lead'))) { skipped++; continue; }

    const fields: Record<string, string> = {};
    for (const f of lead.field_data ?? []) {
      fields[f.name] = Array.isArray(f.values) ? f.values[0] : String(f.values);
    }

    const nom = (fields.full_name ?? fields.first_name ?? 'Lead Facebook').slice(0, 120);
    const email = (fields.email ?? '').slice(0, 255) || null;
    const rawPhone = fields.phone_number ?? fields.phone ?? '';
    const telephone = rawPhone.replace(/\D/g, '').slice(-10) || null;

    if (!email && !telephone) { skipped++; continue; }

    const serviceRaw = fields['quel_type_de_plancher_époxy_vous_intéresse?'] ?? fields.service ?? '';
    const service = serviceRaw ? mapService(serviceRaw) : null;
    const espaceRaw = fields["quel_type_d'espace?"] ?? '';
    const espace = espaceRaw ? mapEspace(espaceRaw) : null;
    let superficie = fields['superficie_approximative_(pi²)?'] ?? null;
    if (superficie) {
      superficie = superficie.replace(/\s*(sf|pi2?|pi²|pieds?\s*carr[eé]s?|sqft|p2|pc)\s*$/i, '').trim();
      if (/^\d+\s*[x×]\s*\d+$/i.test(superficie)) {
        const parts = superficie.split(/[x×]/i).map(s => parseFloat(s.trim()));
        superficie = String(Math.round(parts[0] * parts[1]));
      }
    }
    const adresse = (fields['quel_est_votre_adresse_complete_des_travaux?'] ?? '').trim().slice(0, 255) || null;
    const ville = adresse ? extractVille(adresse) : null;

    const notes = `Lead Facebook Ad #${lead.id}${espace ? ` — Espace: ${espace}` : ''}${service ? ` — Service: ${service}` : ''}${superficie ? ` — Superficie: ${superficie} pi²` : ''}${adresse ? ` — Adresse: ${adresse}` : ''}`;

    try {
      const result = await query(
        `INSERT INTO crm_leads (nom, email, telephone, service, superficie, ville, adresse, source, statut, temperature, notes, type, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,'facebook-leadad','nouveau','chaud',$8,'residential',$9)
         ON CONFLICT (email) WHERE email IS NOT NULL AND email != '' DO NOTHING
         RETURNING id`,
        [nom, email, telephone, service, superficie, ville, adresse, notes, lead.created_time]
      );

      if (result?.[0]?.id) {
        imported++;
        const leadId = result[0].id as number;
        // Auto-create draft quote if we have enough info
        let quoteId: number | null = null;
        if (service && superficie && SERVICES[service as ServiceType]) {
          quoteId = await tryCreateDraftQuote(leadId, nom, email, telephone, adresse, service, superficie);
        }
        await notifyTelegram(nom, email ?? '', telephone, { service: service ?? undefined, espace: espace ?? undefined, superficie: superficie ?? undefined, adresse: adresse ?? undefined, quoteId: quoteId ?? undefined });
      } else {
        skipped++;
      }
    } catch (err) {
      console.error('fb-leads-sync insert error:', err);
      skipped++;
    }
  }

  if (imported > 0) {
    const botToken = process.env.TELEGRAM_BOT_TOKEN;
    const chatIds = getAdminChatIds();
    if (botToken && chatIds.length && imported > 1) {
      // Summary only if more than 1 lead recovered (avoid spam for 1 lead already notified individually)
    }
  }

  return NextResponse.json({ ok: true, imported, skipped });
}
