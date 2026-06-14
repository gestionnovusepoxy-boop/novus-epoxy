import { readFileSync } from 'fs';
const env = readFileSync('.env.local','utf8');
const get = (k) => env.match(new RegExp(`^${k}=(.*)$`,'m'))?.[1]?.replace(/^["']|["']$/g,'').trim();
const TOKEN = process.argv[2];
const ADMIN = get('ADMIN_API_KEY');
const V='v25.0', PAGE='636757822863288';
const g = async (u,o) => { try { const r = await fetch(u,o); return { ok:r.ok, data: await r.json() }; } catch(e){ return {ok:false,data:{error:{message:String(e)}}}; } };

// 1. Recupere un PAGE token (la subscription exige un token de Page)
let pageToken = TOKEN;
const accts = await g(`https://graph.facebook.com/${V}/me/accounts?fields=id,name,access_token&access_token=${TOKEN}`);
const pg = (accts.data.data||[]).find(p=>p.id===PAGE);
if (pg?.access_token) { pageToken = pg.access_token; console.log('✅ Page token obtenu'); }
else console.log('⚠️ Pas de page token via /me/accounts, j\'utilise le system user token');

// 2. RE-ABONNE leadgen
const sub = await g(`https://graph.facebook.com/${V}/${PAGE}/subscribed_apps`, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ subscribed_fields:['leadgen'], access_token: pageToken }) });
console.log('Re-abonnement leadgen:', sub.ok && sub.data.success ? '✅ FAIT' : '❌ '+JSON.stringify(sub.data.error||sub.data));

// 3. Verifie
const chk = await g(`https://graph.facebook.com/${V}/${PAGE}/subscribed_apps?access_token=${pageToken}`);
const ok = (chk.data.data||[]).some(a=>(a.subscribed_fields||[]).includes('leadgen'));
console.log('Verification:', ok ? '✅ leadgen ACTIF' : '❌ toujours manquant');

// 4. Backfill — declenche le cron prod qui pull les leads manques
const cron = await g('https://novus-epoxy.vercel.app/api/cron/fb-leads-sync', { headers:{ Authorization:`Bearer ${ADMIN}` } });
console.log('\nBackfill (cron fb-leads-sync):', cron.ok ? `✅ ${JSON.stringify(cron.data).slice(0,200)}` : `❌ ${JSON.stringify(cron.data).slice(0,200)}`);
