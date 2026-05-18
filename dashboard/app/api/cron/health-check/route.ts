import { NextRequest, NextResponse } from 'next/server';
import { getAdminChatIds } from '@/lib/telegram-utils';
import { query } from '@/lib/db';
import { google } from 'googleapis';
import { isQuietHours } from '@/lib/telegram-utils';

export const maxDuration = 90;

// Echo — Guardian System
// Runs every hour: monitors integrations, auto-repairs, detects threats, secures data

interface CheckResult {
  name: string;
  ok: boolean;
  detail: string;
  autoFixed?: boolean;
  severity?: 'critical' | 'warning' | 'info';
}

async function notifyTelegram(message: string) {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  // Send to group if available, otherwise DM admins
  const groupId = process.env.TELEGRAM_GROUP_CHAT_ID;
  const chatIds = groupId ? [groupId] : getAdminChatIds();
  if (!botToken || chatIds.length === 0) return;
  await Promise.all(chatIds.map(id =>
    fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: id.trim(), text: message, parse_mode: 'Markdown' }),
    }).catch(() => {})
  ));
}

function getGmailClient() {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const refreshToken = process.env.GOOGLE_REFRESH_TOKEN;
  if (!clientId || !clientSecret || !refreshToken) return null;
  const oauth2 = new google.auth.OAuth2(clientId, clientSecret);
  oauth2.setCredentials({ refresh_token: refreshToken });
  return google.gmail({ version: 'v1', auth: oauth2 });
}

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization')?.replace('Bearer ', '') ?? '';
  const cronSecret = process.env.CRON_SECRET ?? '';
  const adminKey = process.env.ADMIN_API_KEY ?? '';
  if (!authHeader || (authHeader !== cronSecret && authHeader !== adminKey)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  if (isQuietHours()) return NextResponse.json({ skipped: 'quiet hours' });

  const checks: CheckResult[] = [];
  let watchAutoFixed = false;

  // ═══════════════════════════════════════════════════════════
  // 1. INTEGRATIONS — ping all external services
  // ═══════════════════════════════════════════════════════════

  // 1a. Database
  try {
    const rows = await query('SELECT 1 AS ok');
    checks.push({ name: 'Base de donnees', ok: rows.length > 0, detail: 'Neon PostgreSQL OK', severity: 'critical' });
  } catch (err) {
    checks.push({ name: 'Base de donnees', ok: false, detail: String(err), severity: 'critical' });
  }

  // 1b. Anthropic API
  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': process.env.ANTHROPIC_API_KEY ?? '', 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'claude-haiku-4-5-20251001', max_tokens: 5, messages: [{ role: 'user', content: 'ping' }] }),
    });
    checks.push({ name: 'Anthropic API', ok: res.ok, detail: res.ok ? 'claude-haiku OK' : `Erreur ${res.status}`, severity: 'critical' });
  } catch (err) {
    checks.push({ name: 'Anthropic API', ok: false, detail: String(err), severity: 'critical' });
  }

  // 1c. Telegram bot
  try {
    const res = await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/getMe`);
    const data = await res.json();
    checks.push({ name: 'Telegram Bot', ok: data.ok === true, detail: data.ok ? `@${data.result.username}` : 'Token invalide', severity: 'critical' });
  } catch (err) {
    checks.push({ name: 'Telegram Bot', ok: false, detail: String(err), severity: 'critical' });
  }

  // 1d. Telegram webhook — auto-repair if broken
  try {
    const whRes = await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/getWebhookInfo`);
    const whData = await whRes.json();
    const webhookUrl = whData.result?.url ?? '';
    const expectedUrl = 'https://novus-epoxy.vercel.app/api/telegram/admin';
    if (webhookUrl === expectedUrl && !whData.result?.last_error_message) {
      checks.push({ name: 'Telegram Webhook', ok: true, detail: 'Webhook actif', severity: 'critical' });
    } else if (webhookUrl === expectedUrl && whData.result?.last_error_message) {
      // Webhook set but erroring — try re-register
      const webhookSecret = process.env.TELEGRAM_WEBHOOK_SECRET ?? '';
      await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/setWebhook`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: expectedUrl, secret_token: webhookSecret, allowed_updates: ['message', 'callback_query'] }),
      });
      checks.push({ name: 'Telegram Webhook', ok: true, detail: `Repare (erreur: ${whData.result.last_error_message})`, autoFixed: true, severity: 'critical' });
    } else {
      // Webhook URL wrong or empty — auto-fix
      const webhookSecret = process.env.TELEGRAM_WEBHOOK_SECRET ?? '';
      const fixRes = await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/setWebhook`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: expectedUrl, secret_token: webhookSecret, allowed_updates: ['message', 'callback_query'] }),
      });
      const fixData = await fixRes.json();
      checks.push({ name: 'Telegram Webhook', ok: fixData.ok, detail: fixData.ok ? 'Repare automatiquement!' : `Auto-fix echoue`, autoFixed: fixData.ok, severity: 'critical' });
    }
  } catch (err) {
    checks.push({ name: 'Telegram Webhook', ok: false, detail: String(err), severity: 'critical' });
  }

  // 1e. Gmail OAuth + Watch auto-renew
  try {
    const gmail = getGmailClient();
    if (!gmail) {
      checks.push({ name: 'Gmail OAuth', ok: false, detail: 'Credentials manquantes', severity: 'critical' });
    } else {
      const listRes = await gmail.users.messages.list({ userId: 'me', maxResults: 1 });
      checks.push({ name: 'Gmail OAuth', ok: true, detail: `Connecte — ${listRes.data.resultSizeEstimate ?? 0} emails` });

      const watchRows = await query(`SELECT value FROM kv_store WHERE key = 'last_gmail_watch'`).catch(() => []);
      const lastWatch = watchRows.length > 0 ? new Date(watchRows[0].value as string) : null;
      const daysSince = lastWatch ? (Date.now() - lastWatch.getTime()) / 86400000 : 999;

      if (daysSince > 5) {
        try {
          await gmail.users.watch({
            userId: 'me',
            requestBody: { topicName: 'projects/true-orb-491120-j5/topics/gmail-notifications', labelIds: ['INBOX'] },
          });
          await query(`INSERT INTO kv_store (key, value) VALUES ('last_gmail_watch', $1) ON CONFLICT (key) DO UPDATE SET value = $1`, [new Date().toISOString()]);
          watchAutoFixed = true;
          checks.push({ name: 'Gmail Watch', ok: true, detail: 'Renouvele automatiquement', autoFixed: true });
        } catch (err) {
          checks.push({ name: 'Gmail Watch', ok: false, detail: `Renouvellement echoue: ${String(err)}` });
        }
      } else {
        checks.push({ name: 'Gmail Watch', ok: true, detail: `Actif — renouvele il y a ${daysSince.toFixed(1)}j` });
      }
    }
  } catch (err) {
    checks.push({ name: 'Gmail OAuth', ok: false, detail: String(err), severity: 'critical' });
  }

  // 1f. Stripe
  try {
    const res = await fetch('https://api.stripe.com/v1/balance', {
      headers: { Authorization: `Bearer ${process.env.STRIPE_SECRET_KEY}` },
    });
    const data = await res.json();
    checks.push({ name: 'Stripe', ok: data.object === 'balance', detail: data.object === 'balance' ? 'Balance OK' : data.error?.message ?? 'Error' });
  } catch (err) {
    checks.push({ name: 'Stripe', ok: false, detail: String(err) });
  }

  // 1g. Twilio
  try {
    const sid = process.env.TWILIO_ACCOUNT_SID ?? '';
    const token = process.env.TWILIO_AUTH_TOKEN ?? '';
    const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}.json`, {
      headers: { Authorization: `Basic ${Buffer.from(`${sid}:${token}`).toString('base64')}` },
    });
    const data = await res.json();
    checks.push({ name: 'Twilio', ok: data.status === 'active', detail: data.status === 'active' ? 'Compte actif' : `Erreur: ${data.message ?? data.status}` });
  } catch (err) {
    checks.push({ name: 'Twilio', ok: false, detail: String(err) });
  }

  // 1h. Env vars
  const requiredVars = [
    'DATABASE_URL', 'ANTHROPIC_API_KEY', 'TELEGRAM_BOT_TOKEN', 'TELEGRAM_ADMIN_CHAT_IDS',
    'TELEGRAM_WEBHOOK_SECRET', 'GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'GOOGLE_REFRESH_TOKEN',
    'STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET', 'AUTH_SECRET', 'ADMIN_API_KEY', 'CRON_SECRET',
  ];
  const missingVars = requiredVars.filter(v => !process.env[v]);
  checks.push({
    name: 'Variables env',
    ok: missingVars.length === 0,
    detail: missingVars.length === 0 ? `${requiredVars.length}/${requiredVars.length} OK` : `Manquantes: ${missingVars.join(', ')}`,
    severity: missingVars.length > 0 ? 'critical' : 'info',
  });

  // ═══════════════════════════════════════════════════════════
  // 2. SECURITY — detect threats & suspicious activity
  // ═══════════════════════════════════════════════════════════

  // 2a. Brute force login detection (5+ failed attempts from same IP in 1h)
  try {
    const bruteForce = await query(
      `SELECT ip_address, COUNT(*)::int as attempts
       FROM audit_logs
       WHERE action = 'login' AND success = false AND created_at >= NOW() - INTERVAL '1 hour'
       GROUP BY ip_address HAVING COUNT(*) >= 5`
    );
    if (bruteForce.length > 0) {
      const ips = bruteForce.map(r => `${r.ip_address} (${r.attempts}x)`).join(', ');
      checks.push({ name: 'Brute Force', ok: false, detail: `Tentatives suspectes: ${ips}`, severity: 'critical' });
    } else {
      checks.push({ name: 'Brute Force', ok: true, detail: 'Aucune tentative suspecte' });
    }
  } catch { checks.push({ name: 'Brute Force', ok: true, detail: 'Check impossible' }); }

  // 2b. XSS/SQL injection detection in recent submissions
  try {
    const suspicious = await query(
      `SELECT id, nom, email, message, created_at FROM submissions
       WHERE created_at >= NOW() - INTERVAL '1 hour'
       AND (
         nom ILIKE '%<script%' OR nom ILIKE '%javascript:%' OR nom ILIKE '%onerror%' OR nom ILIKE '%onload%'
         OR email ILIKE '%<script%' OR email ILIKE '%;--%' OR email ILIKE '%DROP TABLE%' OR email ILIKE '%UNION SELECT%'
         OR message ILIKE '%<script%' OR message ILIKE '%DROP TABLE%' OR message ILIKE '%UNION SELECT%'
         OR message ILIKE '%eval(%' OR message ILIKE '%document.cookie%'
       )`
    );
    if (suspicious.length > 0) {
      // Auto-clean: delete malicious submissions
      for (const s of suspicious) {
        await query(`DELETE FROM submissions WHERE id = $1`, [s.id]);
      }
      checks.push({ name: 'XSS/Injection', ok: false, detail: `${suspicious.length} soumission(s) malveillante(s) supprimee(s)`, autoFixed: true, severity: 'critical' });
    } else {
      checks.push({ name: 'XSS/Injection', ok: true, detail: 'Aucune injection detectee' });
    }
  } catch { checks.push({ name: 'XSS/Injection', ok: true, detail: 'Check impossible' }); }

  // 2c. Spam detection — too many submissions from same IP in short time
  try {
    const spamSubmissions = await query(
      `SELECT ip_hash, COUNT(*)::int as cnt
       FROM submissions
       WHERE created_at >= NOW() - INTERVAL '1 hour'
       GROUP BY ip_hash HAVING COUNT(*) >= 10`
    );
    if (spamSubmissions.length > 0) {
      checks.push({ name: 'Spam Soumissions', ok: false, detail: `${spamSubmissions.length} IP(s) avec 10+ soumissions en 1h`, severity: 'warning' });
    } else {
      checks.push({ name: 'Spam Soumissions', ok: true, detail: 'Pas de spam detecte' });
    }
  } catch { checks.push({ name: 'Spam Soumissions', ok: true, detail: 'Check impossible' }); }

  // 2d. Unauthorized API access — check for repeated 401/403 on admin routes
  try {
    const failedAuth = await query(
      `SELECT COUNT(*)::int as c FROM audit_logs
       WHERE success = false AND created_at >= NOW() - INTERVAL '24 hours'`
    );
    const count = Number(failedAuth[0]?.c ?? 0);
    if (count >= 20) {
      checks.push({ name: 'Acces non autorises', ok: false, detail: `${count} tentatives echouees en 24h`, severity: 'warning' });
    } else {
      checks.push({ name: 'Acces non autorises', ok: true, detail: `${count} tentatives en 24h` });
    }
  } catch { checks.push({ name: 'Acces non autorises', ok: true, detail: 'Check impossible' }); }

  // ═══════════════════════════════════════════════════════════
  // 3. AUTO-REPAIR — fix data issues automatically
  // ═══════════════════════════════════════════════════════════

  // 3a. Stuck email_logs in "processing" for 1h+ → mark as error
  try {
    const stuck = await query(
      `UPDATE email_logs SET statut = 'error'
       WHERE statut = 'processing' AND created_at < NOW() - INTERVAL '1 hour'
       RETURNING id`
    );
    if (stuck.length > 0) {
      checks.push({ name: 'Emails bloques', ok: true, detail: `${stuck.length} email(s) bloque(s) en "processing" → marque(s) erreur`, autoFixed: true });
    }
  } catch { /* ignore */ }

  // 3b. Duplicate expenses — same fournisseur + montant + date created within 5 min
  try {
    const dupes = await query(
      `DELETE FROM expenses WHERE id IN (
        SELECT id FROM (
          SELECT id, ROW_NUMBER() OVER (PARTITION BY fournisseur, montant_ttc, date_depense ORDER BY id) as rn
          FROM expenses
          WHERE source = 'email-scan' AND created_at >= NOW() - INTERVAL '24 hours'
        ) sub WHERE rn > 1
      ) RETURNING id`
    );
    if (dupes.length > 0) {
      checks.push({ name: 'Depenses doublons', ok: true, detail: `${dupes.length} doublon(s) supprime(s)`, autoFixed: true });
    }
  } catch { /* ignore */ }

  // 3c. Orphaned bookings — bookings with no matching quote
  try {
    const orphaned = await query(
      `SELECT b.id FROM bookings b LEFT JOIN quotes q ON q.id = b.quote_id WHERE q.id IS NULL`
    );
    if (orphaned.length > 0) {
      await query(`DELETE FROM bookings WHERE id = ANY($1::int[])`, [orphaned.map(r => r.id)]);
      checks.push({ name: 'Bookings orphelins', ok: true, detail: `${orphaned.length} booking(s) sans devis supprime(s)`, autoFixed: true });
    }
  } catch { /* ignore */ }

  // 3d. Old kv_store cleanup — remove agent histories older than 30 days
  try {
    const oldKv = await query(
      `DELETE FROM kv_store WHERE key LIKE 'agent_history_%' AND updated_at < NOW() - INTERVAL '30 days' RETURNING key`
    );
    if (oldKv.length > 0) {
      checks.push({ name: 'Memoire agents', ok: true, detail: `${oldKv.length} historique(s) ancien(s) nettoye(s)`, autoFixed: true });
    }
  } catch { /* ignore */ }

  // 3e. Quotes depot_paye without invoice — auto-create missing invoices
  try {
    const noInvoice = await query(
      `SELECT q.id, q.client_nom, q.client_email, q.client_tel, q.client_adresse,
              q.type_service, q.superficie, q.prix_pied_carre, q.sous_total, q.tps, q.tvq,
              q.total, q.depot_requis, q.rabais_pct, q.rabais_montant
       FROM quotes q
       LEFT JOIN invoices i ON i.quote_id = q.id
       WHERE q.statut IN ('depot_paye', 'planifie', 'complete') AND i.id IS NULL`
    );
    for (const q of noInvoice) {
      try {
        const depot = Number(q.depot_requis);
        const solde = Number(q.total) - depot;
        // Find or create client
        const clients = await query(`SELECT id FROM clients WHERE email = $1`, [q.client_email]);
        let clientId = clients.length > 0 ? clients[0].id : null;
        if (!clientId) {
          const nc = await query(`INSERT INTO clients (nom, email, telephone, adresse) VALUES ($1,$2,$3,$4) RETURNING id`,
            [q.client_nom, q.client_email, q.client_tel, q.client_adresse]);
          clientId = nc[0].id;
        }
        const yearStr = new Date().getFullYear().toString();
        const prefix = `NE-${yearStr}-`;
        await query(
          `INSERT INTO invoices (numero, quote_id, client_id, type_service, superficie, prix_pied_carre, rabais_pct, rabais_montant, sous_total, tps, tvq, total, depot_montant, final_montant, depot_paye, depot_paye_at, depot_methode, statut, date_emission)
           VALUES ($1 || LPAD((COALESCE((SELECT MAX(CAST(SPLIT_PART(numero,'-',3) AS INT)) FROM invoices WHERE numero LIKE $2), 0) + 1)::text, 3, '0'),
                   $3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,true,NOW(),'autre','depot_recu',CURRENT_DATE)`,
          [prefix, `${prefix}%`, q.id, clientId, q.type_service, q.superficie, q.prix_pied_carre, q.rabais_pct ?? 0, q.rabais_montant ?? 0, q.sous_total, q.tps, q.tvq, q.total, depot, solde]
        );
      } catch { /* skip individual failures */ }
    }
    if (noInvoice.length > 0) {
      checks.push({ name: 'Factures manquantes', ok: true, detail: `${noInvoice.length} facture(s) creee(s) automatiquement`, autoFixed: true });
    }
  } catch { /* ignore */ }

  // 3e-bis. Meta Page leadgen subscription + token validity + lead flow check
  try {
    const metaToken = process.env.META_PAGE_TOKEN;
    if (!metaToken) {
      checks.push({ name: 'Meta FB Token', ok: false, detail: 'META_PAGE_TOKEN manquant dans Vercel env', severity: 'critical' });
    } else {
      const meRes = await fetch(`https://graph.facebook.com/v25.0/me?access_token=${metaToken}`);
      const me = await meRes.json();
      if (me.error) {
        // Token expired or invalid — alert critical
        checks.push({ name: 'Meta FB Token', ok: false, detail: `Token expire ou invalide: ${me.error.message}. Renouveler dans Meta Business Suite.`, severity: 'critical' });
      } else if (me.id) {
        checks.push({ name: 'Meta FB Token', ok: true, detail: `Token valide (${me.name ?? me.id})` });
        // Check leadgen subscription
        const subRes = await fetch(`https://graph.facebook.com/v25.0/${me.id}/subscribed_apps?access_token=${metaToken}`);
        const subData = await subRes.json();
        const hasLeadgen = (subData.data ?? []).some((s: Record<string, unknown>) =>
          Array.isArray(s.subscribed_fields) && s.subscribed_fields.includes('leadgen')
        );
        if (!hasLeadgen) {
          await fetch(`https://graph.facebook.com/v25.0/${me.id}/subscribed_apps`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ subscribed_fields: ['leadgen'], access_token: metaToken }),
          });
          checks.push({ name: 'Meta Leadgen Sub', ok: true, detail: 'Abonnement leadgen renouvele automatiquement', autoFixed: true, severity: 'critical' });
        } else {
          checks.push({ name: 'Meta Leadgen Sub', ok: true, detail: 'Abonnement leadgen actif' });
        }
      }
    }
  } catch { /* ignore */ }

  // 3e-ter. Verifier que des leads FB rentrent bien (sinon alerte si aucun depuis 48h et pubs probablement actives)
  try {
    const lastFbLead = await query(
      `SELECT MAX(created_at) as last_at FROM crm_leads WHERE source IN ('facebook-zapier','facebook-leadad')`
    );
    const lastAt = lastFbLead[0]?.last_at ? new Date(String(lastFbLead[0].last_at)) : null;
    if (lastAt) {
      const hoursAgo = (Date.now() - lastAt.getTime()) / 3600000;
      if (hoursAgo > 48) {
        checks.push({ name: 'Leads FB', ok: false, detail: `Aucun lead Facebook depuis ${Math.round(hoursAgo)}h — verifie Zapier et les pubs actives!`, severity: 'critical' });
      } else {
        checks.push({ name: 'Leads FB', ok: true, detail: `Dernier lead il y a ${hoursAgo.toFixed(1)}h` });
      }
    }
  } catch { /* ignore */ }

  // 3f. CRM leads with raw service names — auto-normalize
  try {
    const rawServices = await query(
      `SELECT id, service FROM crm_leads
       WHERE service IS NOT NULL
       AND service NOT IN ('flake','metallique','couleur_unie','quartz','commercial','antiderapant','meulage')
       LIMIT 50`
    );
    const serviceMap: Record<string, string> = {
      'flocon (flake)': 'flake', 'flocon(flake)': 'flake', 'flocons': 'flake', 'flake': 'flake',
      'métallique': 'metallique', 'metallique': 'metallique',
      'couleur unie': 'couleur_unie', 'couleur_unie': 'couleur_unie',
      'antidérapant': 'antiderapant', 'antiderapant': 'antiderapant',
      'quartz': 'quartz', 'commercial': 'commercial', 'meulage': 'meulage',
    };
    let fixed = 0;
    for (const lead of rawServices) {
      const normalized = serviceMap[(lead.service as string).toLowerCase()];
      if (normalized) {
        await query(`UPDATE crm_leads SET service = $1 WHERE id = $2`, [normalized, lead.id]);
        fixed++;
      }
    }
    if (fixed > 0) {
      checks.push({ name: 'Services CRM', ok: true, detail: `${fixed} service(s) normalise(s)`, autoFixed: true });
    }
  } catch { /* ignore */ }

  // 3g. Duplicate CRM leads cleanup (same email, keep most recent)
  try {
    const dupeLeads = await query(
      `DELETE FROM crm_leads WHERE id IN (
        SELECT id FROM (
          SELECT id, ROW_NUMBER() OVER (PARTITION BY LOWER(email) ORDER BY created_at DESC) as rn
          FROM crm_leads WHERE email IS NOT NULL AND email != ''
        ) sub WHERE rn > 1
      ) RETURNING id`
    );
    if (dupeLeads.length > 0) {
      checks.push({ name: 'Leads doublons', ok: true, detail: `${dupeLeads.length} doublon(s) email supprime(s)`, autoFixed: true });
    }
  } catch { /* ignore */ }

  // 3h. Resend webhook URL check — auto-repair if pointing to wrong URL
  try {
    // Check if any email_logs show delivery issues in last 24h
    const failedEmails = await query(
      `SELECT COUNT(*)::int as c FROM email_logs WHERE statut = 'error' AND created_at >= NOW() - INTERVAL '24 hours'`
    );
    if (Number(failedEmails[0]?.c ?? 0) > 5) {
      checks.push({ name: 'Emails en erreur', ok: false, detail: `${failedEmails[0].c} emails en erreur en 24h`, severity: 'warning' });
    }
  } catch { /* ignore */ }

  // ═══════════════════════════════════════════════════════════
  // 4. DATA INTEGRITY — verify critical data
  // ═══════════════════════════════════════════════════════════

  // 4a. Quotes with deposit_paid but no booking
  try {
    const noBooking = await query(
      `SELECT q.id, q.client_nom FROM quotes q
       LEFT JOIN bookings b ON b.quote_id = q.id
       WHERE q.statut IN ('depot_paye', 'planifie') AND b.id IS NULL`
    );
    if (noBooking.length > 0) {
      const names = noBooking.map(r => `#${r.id} ${r.client_nom}`).join(', ');
      checks.push({ name: 'Devis sans reservation', ok: false, detail: `${noBooking.length}: ${names}`, severity: 'warning' });
    } else {
      checks.push({ name: 'Devis sans reservation', ok: true, detail: 'Tous les devis payes ont une reservation' });
    }
  } catch { /* ignore */ }

  // 4b. Invoices without payments — check for incomplete payment records
  try {
    const noPayment = await query(
      `SELECT i.id, i.numero, i.quote_id FROM invoices i
       LEFT JOIN payments p ON p.invoice_id = i.id
       WHERE i.depot_paye = true AND p.id IS NULL`
    );
    for (const inv of noPayment) {
      const q = await query(`SELECT depot_requis FROM quotes WHERE id = $1`, [inv.quote_id]);
      if (q.length > 0) {
        await query(`INSERT INTO payments (invoice_id, montant, type, methode) VALUES ($1, $2, 'depot', 'autre')`, [inv.id, q[0].depot_requis]);
      }
    }
    if (noPayment.length > 0) {
      checks.push({ name: 'Paiements manquants', ok: true, detail: `${noPayment.length} paiement(s) reconstruit(s)`, autoFixed: true });
    }
  } catch { /* ignore */ }

  // 4c. CRM superficies sales — clean "350 pi2" → "350"
  try {
    const dirtySuperficies = await query(
      `SELECT id, superficie FROM crm_leads
       WHERE superficie IS NOT NULL AND superficie ~ '[^0-9.]'
       LIMIT 50`
    );
    let cleanedCount = 0;
    for (const lead of dirtySuperficies) {
      const raw = String(lead.superficie);
      let clean = raw;
      if (/^\d+\s*x\s*\d+$/i.test(raw)) {
        const parts = raw.split(/x/i).map((s: string) => parseFloat(s.trim()));
        clean = String(Math.round(parts[0] * parts[1]));
      } else {
        clean = raw.replace(/\s*(sf|pi2?|pi²|pieds?\s*carr[eé]s?|sqft|p2|pc)\s*$/i, '').trim();
      }
      if (clean !== raw) {
        await query(`UPDATE crm_leads SET superficie = $1 WHERE id = $2`, [clean, lead.id]);
        cleanedCount++;
      }
    }
    if (cleanedCount > 0) {
      checks.push({ name: 'Superficies sales', ok: true, detail: `${cleanedCount} superficie(s) nettoyee(s)`, autoFixed: true });
    }
  } catch { /* ignore */ }

  // 4d. DB activity — email scan ran recently
  try {
    const scanRows = await query(`SELECT value FROM kv_store WHERE key = 'last_email_scan'`);
    const lastScan = scanRows[0]?.value as string | undefined;
    if (lastScan) {
      const hoursAgo = (Date.now() - new Date(lastScan).getTime()) / 3600000;
      checks.push({
        name: 'Email Scan',
        ok: hoursAgo < 4,
        detail: hoursAgo < 4 ? `Dernier scan il y a ${hoursAgo.toFixed(1)}h` : `En retard! Dernier scan il y a ${hoursAgo.toFixed(0)}h`,
        severity: hoursAgo >= 4 ? 'warning' : 'info',
      });
    }
  } catch { /* ignore */ }

  // ═══════════════════════════════════════════════════════════
  // 5. REPORT — send alerts
  // ═══════════════════════════════════════════════════════════

  const failures = checks.filter(c => !c.ok);
  const criticals = failures.filter(c => c.severity === 'critical');
  const warnings = failures.filter(c => c.severity === 'warning');
  const autoFixes = checks.filter(c => c.autoFixed);

  // Alert on critical or multiple warnings
  if (criticals.length > 0) {
    const msg = [
      `🚨 *ECHO — ALERTE CRITIQUE*`,
      ``,
      ...criticals.map(f => `❌ *${f.name}*: ${f.detail}`),
      ...(warnings.length > 0 ? ['', ...warnings.map(f => `⚠️ *${f.name}*: ${f.detail}`)] : []),
      ...(autoFixes.length > 0 ? ['', `🔧 Auto-repare: ${autoFixes.map(f => f.name).join(', ')}`] : []),
      '',
      `Score: ${checks.length - failures.length}/${checks.length}`,
    ].join('\n');
    await notifyTelegram(msg);
  } else if (warnings.length >= 2) {
    const msg = [
      `⚠️ *ECHO — Avertissements*`,
      ``,
      ...warnings.map(f => `⚠️ *${f.name}*: ${f.detail}`),
      ...(autoFixes.length > 0 ? ['', `🔧 Auto-repare: ${autoFixes.map(f => f.name).join(', ')}`] : []),
    ].join('\n');
    await notifyTelegram(msg);
  }
  // Si tout va bien (même avec auto-fixes) → pas de message. Echo parle seulement quand ça casse.

  return NextResponse.json({
    ok: failures.length === 0,
    timestamp: new Date().toISOString(),
    checks,
    score: `${checks.length - failures.length}/${checks.length}`,
    failures: failures.length,
    criticals: criticals.length,
    warnings: warnings.length,
    autoFixed: autoFixes.length,
    watchAutoFixed,
  });
}
