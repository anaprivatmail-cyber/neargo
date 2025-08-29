// netlify/functions/provider-upload.js
// Upload v Supabase Storage (bucket: event-images/public/*) in vrne public URL.

import { createClient } from '@supabase/supabase-js';
import Busboy from 'busboy';

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

export const handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: CORS, body: '' };
  if (event.httpMethod !== 'POST') return json({ ok:false, error:'Method not allowed' }, 405);

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return json({ ok:false, error:'Manjkajo SUPABASE_URL in/ali SUPABASE_SERVICE_ROLE_KEY' }, 500);
  }

  const headers = event.headers || {};
  const ct = headers['content-type'] || headers['Content-Type'] || headers['CONTENT-TYPE'] || '';
  if (!ct.includes('multipart/form-data')) {
    return json({ ok:false, error:'Content-Type mora biti multipart/form-data' }, 400);
  }

  try {
    const raw = event.isBase64Encoded
      ? Buffer.from(event.body || '', 'base64')
      : Buffer.from(event.body || '', 'utf8');

    const bb = Busboy({ headers: { 'content-type': ct } });
    const chunks = [];
    let filename = null;
    let mime = 'application/octet-stream';

    await new Promise((resolve, reject) => {
      bb.on('file', (_name, file, info) => {
        filename = info.filename;
        mime = info.mimeType || mime;
        file.on('data', d => chunks.push(d));
        file.on('error', reject);
        file.on('end', () => {});
      });
      bb.on('error', reject);
      bb.on('finish', resolve);
      bb.end(raw);
    });

    if (!filename || !chunks.length) return json({ ok:false, error:'Datoteka ni bila poslana' }, 400);

    const ext = (filename.split('.').pop() || 'bin').toLowerCase();
    const base = filename.replace(/\.[^/.]+$/, '');
    const safe = (base.toLowerCase().replace(/[^a-z0-9_-]+/gi, '-').replace(/(^-|-$)/g,'').slice(0,60)) || 'file';
    const key = `public/${Date.now()}-${safe}.${ext}`;

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const { error: upErr } = await supabase
      .storage
      .from('event-images')
      .upload(key, Buffer.concat(chunks), { contentType: mime, upsert: false });

    if (upErr) return json({ ok:false, error:'Napaka pri shranjevanju: ' + upErr.message }, 500);

    const { data: pub } = supabase.storage.from('event-images').getPublicUrl(key);
    return json({ ok:true, path:key, imagePublicUrl: pub?.publicUrl || null });
  } catch (e) {
    return json({ ok:false, error:String(e?.message || e) }, 500);
  }
};
