import { createClient } from '@supabase/supabase-js';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'POST,OPTIONS'
};
const json = (d, s = 200) => ({
  statusCode: s,
  headers: { 'Content-Type': 'application/json', ...CORS },
  body: JSON.stringify(d)
});

const RESEND_API_KEY = process.env.RESEND_API_KEY || '';
const FROM_EMAIL     = process.env.FROM_EMAIL     || 'no-reply@getneargo.com';
const ADMIN_EMAIL    = process.env.ADMIN_EMAIL    || 'info@getneargo.com';

const SUPABASE_URL              = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const BUCKET = 'event-images';
const SUBMISSIONS_PREFIX = 'submissions/';

function slugify(s){
  return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/(^-|-$)/g,'');
}

async function sendEmail(to, subject, html){
  if (!RESEND_API_KEY) return { ok:false, note:'RESEND_API_KEY ni nastavljen' };
  const r = await fetch('https://api.resend.com/emails',{
    method:'POST',
    headers:{ 'Content-Type':'application/json', 'Authorization':`Bearer ${RESEND_API_KEY}` },
    body: JSON.stringify({ from: FROM_EMAIL, to, subject, html })
  });
  const data = await r.json().catch(()=> ({}));
  return { ok: r.ok, data };
}

function requireFields(p){
  const missing = [];
  const need = [
    ['organizer','Ime organizatorja'],
    ['organizerEmail','E-pošta'],
    ['eventName','Naslov dogodka'],
    ['venue','Lokacija (prizorišče)'],
    ['country','Država'],
    ['start','Začetek'],
    ['end','Konec'],
    ['description','Opis'],
    ['category','Kategorija']
  ];
  if (!p.city && !p.city2) missing.push('Mesto/kraj');
  for (const [k,label] of need) if (!String(p[k
