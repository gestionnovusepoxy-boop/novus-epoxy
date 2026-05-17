import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';

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

async function notifyTelegram(nom: string, email: string, telephone: string | null, extra: { service?: string; espace?: string; superficie?: string; adresse?: string }) {
  // Leads FB = toujours notifier, pas de quiet hours
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  const groupId = (process.env.TELEGRAM_GROUP_CHAT_ID ?? '').trim();
  const adminIds = (process.env.TELEGRAM_ADMIN_CHAT_IDS ?? '').split(',').map(s => s.trim()).filter(Boolean);
  const chatIds = groupId ? [groupId] : adminIds; // groupe en priorité
  if (!botToken || !chatIds.length) return;

  const lines = [
    `🔥 <b>Nouveau lead Facebook!</b>`,
    ``,
    `👤 ${nom}`,
    `📧 ${email}`,
    telephone ? `📞 ${telephone}` : '',
    extra.espace ? `🏗 ${extra.espace}` : '',
    extra.service ? `🔧 ${extra.service}` : '',
    extra.superficie ? `📐 ${extra.superficie} pi²` : '',
    extra.adresse ? `🏠 ${extra.adresse}` : '',
    ``,
    `<i>⚡ Contacte-le ASAP — premier rendu gagne!</i>`,
  ].filter(Boolean).join('\n');

  await Promise.all(chatIds.map(chatId =>
    fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId.trim(), text: lines, parse_mode: 'HTML',
        reply_markup: { inline_keyboard: [[{ text: '📋 Voir CRM', url: 'https://novus-epoxy.vercel.app/dashboard/crm' }]] },
      }),
    }).catch(() => {})
  ));
}

export async function GET(req: NextRequest) {
  const secret = req.headers.get('authorization')?.replace('Bearer ', '') ?? '';
  if (secret !== (process.env.CRON_SECRET ?? '') && secret !== (process.env.ADMIN_API_KEY ?? '')) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const accessToken = process.env.META_PAGE_TOKEN;
  if (!accessToken) return NextResponse.json({ error: 'META_PAGE_TOKEN missing' }, { status: 500 });

  // Fetch last 50 leads from the active form
  const formId = '1645385520039445';
  const res = await fetch(
    `https://graph.facebook.com/v25.0/${formId}/leads?fields=id,created_time,field_data&limit=50&access_token=${accessToken}`
  );
  if (!res.ok) return NextResponse.json({ error: 'Meta API error', status: res.status });

  const data = await res.json();
  const fbLeads: Array<{ id: string; created_time: string; field_data: Array<{ name: string; values: string[] }> }> = data.data ?? [];

  let imported = 0;
  let skipped = 0;

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
        await notifyTelegram(nom, email ?? '', telephone, { service: service ?? undefined, espace: espace ?? undefined, superficie: superficie ?? undefined, adresse: adresse ?? undefined });
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
    const chatIds = (process.env.TELEGRAM_ADMIN_CHAT_IDS ?? '').split(',').filter(Boolean);
    if (botToken && chatIds.length && imported > 1) {
      // Summary only if more than 1 lead recovered (avoid spam for 1 lead already notified individually)
    }
  }

  return NextResponse.json({ ok: true, imported, skipped });
}
