// netlify/functions/provider-upload.js
// Upload slike (ali druge datoteke) v Supabase Storage (bucket: event-images/public/*)
// Vrne javni URL za uporabo v payloadu (npr. imagePublicUrl)

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
  // CORS preflight
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: CORS, body: '' };
  if (event.httpMethod !== 'POST') return json({ ok:false, error:'Method not allowed' }, 405);

  // === ENV check ===
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return json({ ok:false, error:'Manjkajo SUPABASE_URL in/ali SUPABASE_SERVICE_ROLE_KEY' }, 500);
  }

  // === Content-Type check (za Busboy) ===
  const h = event.headers || {};
  // Netlify lahko vrne različne “case” headerjev – uredimo varno branje:
  const ct = h['content-type'] || h['Content-Type'] || h['CONTENT-TYPE'] || '';
  if (!ct || !ct.includes('multipart/form-data')) {
    return json({ ok:false, error:'Content-Type mora biti multipart/form-data' }, 400);
  }

  try {
    // === Decode body (Netlify Functions pogosto pošilja base64) ===
    const raw = event.isBase64Encoded
      ? Buffer.from(event.body || '', 'base64')
      : Buffer.from(event.body || '', 'utf8');

    // === Busboy parsing ===
    const bb = Busboy({ headers: { 'content-type': ct } });
    const fileChunks = [];
    let fileName = null;
    let mime = 'application/octet-stream';

    // (opcijsko) če bi pošiljala še dodatna polja (npr. folder),
    // jih lahko pobereš tukaj:
    // let folder = 'public';
    // bb.on('field', (name, val) => {
    //   if (name === 'folder' && val) folder = val.replace(/[^a-z0-9/_-]/gi,'').slice(0,100) || 'public';
    // });

    await new Promise((resolve, reject) => {
      bb.on('file', (_name, file, info) => {
        fileName = info.filename;
        mime = info.mimeType || mime;
        file.on('data', (d) => fileChunks.push(d));
        file.on('limit', () => reject(new Error('File too large')));
        file.on('end', () => {});
      });
      bb.on('error', reject);
      bb.on('finish', resolve);

      bb.end(raw);
    });

    if (!fileChunks.length || !fileName) {
      return json({ ok:false, error:'Datoteka ni bila poslana' }, 400);
    }

    // === Sestavi varno ime + pot ===
    const ext = (fileName.split('.').pop() || 'bin').toLowerCase();
    const base = fileName.replace(/\.[^/.]+$/, '');
    const safeBase = base
      .toLowerCase()
      .replace(/[^a-z0-9_-]+/gi, '-')
      .replace(/(^-|-$)/g, '')
      .slice(0, 60) || 'file';
    // privzeto shranimo v public/ da je URL javen
    const key = `public/${Date.now()}-${safeBase}.${ext}`;

    // === Upload v Supabase Storage ===
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const { error: upErr } = await supabase
      .storage
      .from('event-images')
      .upload(key, Buffer.concat(fileChunks), { contentType: mime, upsert: false });

    if (upErr) return json({ ok:false, error: 'Napaka pri shranjevanju: ' + upErr.message }, 500);

    // === Javni URL (bucket mora biti "Public") ===
    const { data: pub } = supabase.storage.from('event-images').getPublicUrl(key);
    const imagePublicUrl = pub?.publicUrl || null;

    return json({ ok:true, path:key, imagePublicUrl });
  } catch (e) {
    return json({ ok:false, error:String(e?.message || e) }, 500);
  }
};
