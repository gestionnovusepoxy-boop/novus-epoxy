import { neon } from '@neondatabase/serverless';

const DATABASE_URL = 'postgresql://neondb_owner:npg_NF9cCIr2dfiO@ep-cold-frost-ajdcpqrk.c-3.us-east-2.aws.neon.tech/neondb?sslmode=require';
const sql = neon(DATABASE_URL);

const leads = [
  // Nouveaux leads (pas dans Cloud import)
  { nom: 'Constructions Contemporaines', email: 'info@constructionscontemporaines.com', telephone: '(581) 997-7037', ville: '', notes: 'Soumission CMS — Feb 23', source: 'cms', type: 'commercial' },
  { nom: 'Vicky Lowin', email: 'vickylowin@yahoo.com', telephone: '(514) 970-7780', ville: '', notes: 'Soumission CMS — Feb 12', source: 'cms', type: 'residentiel' },
  { nom: 'Inconnu', email: 'girolle2018@hotmail.com', telephone: '(418) 527-4141', ville: '', notes: 'Soumission CMS — Feb 9', source: 'cms', type: 'residentiel' },
  { nom: 'Melanie Paquin', email: '', telephone: '', ville: '', notes: 'Soumission CMS — Feb 7, pas de contact', source: 'cms', type: 'residentiel' },
  { nom: 'Marie-Hélène Lebel', email: '', telephone: '', ville: '', notes: 'Soumission CMS — Feb 5, pas de contact', source: 'cms', type: 'residentiel' },
  { nom: 'Dany Brassard', email: 'infotoitureftf@gmail.com', telephone: '(418) 928-8737', ville: '', notes: 'Toitures fortifiées — partenaire potentiel', source: 'cms', type: 'commercial' },
  { nom: 'J-RO Entreprises Inc', email: 'jroentreprises@gmail.com', telephone: '(581) 888-0825', ville: '', notes: 'Entreprise — soumission CMS Feb 5', source: 'cms', type: 'commercial' },
  { nom: 'Daroli', email: 'comptabilite@entretienpjp.com', telephone: '(418) 906-8333', ville: '', notes: 'Entretien PJP — soumission CMS Feb 5', source: 'cms', type: 'commercial' },
  { nom: 'Pavco', email: 'pavco@live.ca', telephone: '', ville: '', notes: 'Soumission CMS Feb 5', source: 'cms', type: 'commercial' },
  { nom: 'André Desjardins', email: 'andre.desjardins74@hot.com', telephone: '(418) 868-4854', ville: '', notes: 'Soumission CMS — Feb 5', source: 'cms', type: 'residentiel' },
];

// Check existing emails
const existing = await sql`SELECT email FROM crm_leads WHERE email IS NOT NULL`;
const existingEmails = new Set(existing.map(r => r.email?.toLowerCase()));

const toInsert = leads.filter(l => !l.email || !existingEmails.has(l.email.toLowerCase()));

console.log(`New CMS leads to insert: ${toInsert.length} / ${leads.length}`);

let inserted = 0;
for (const l of toInsert) {
  await sql`INSERT INTO crm_leads (nom, email, telephone, ville, notes, source, type, statut, temperature)
    VALUES (${l.nom}, ${l.email || null}, ${l.telephone || null}, ${l.ville || null}, ${l.notes}, ${l.source}, ${l.type}, 'nouveau', 'tiede')`;
  inserted++;
}

console.log(`Inserted: ${inserted}`);

const res = await sql`SELECT type, COUNT(*) as count FROM crm_leads GROUP BY type`;
console.log('\nAll leads by type:');
for (const r of res) console.log(`  ${r.type}: ${r.count}`);

const total = await sql`SELECT COUNT(*) as count FROM crm_leads`;
console.log(`\nTotal CRM: ${total[0].count}`);
