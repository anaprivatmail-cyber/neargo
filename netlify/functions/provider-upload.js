// netlify/functions/provider-upload.js
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

const BUCKET = 'event-images';

function slug(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9_-]+/gi, '-').replace(/^-+|-+$/g, '');
}

export const handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: CORS, body: '' };
  if (event.httpMethod !== 'POST')   return json({ ok:false, error:'Method not allowed' }, 405);

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return json({ ok:false, error:'Manjkajo SUPABASE_URL in/ali SUPABASE_SERVICE_ROLE_KEY' }, 500);
  }

  // Busboy rabi točen content-type z boundary
  const contentType = event.headers['content-type'] || event.headers['Content-Type'] || '';
  if (!contentType.startsWith('multipart/form-data')) {
    return json({ ok:false, error:'Pričakovan multipart/form-data' }, 400);
  }

  try {
    const bb = Busboy({ headers: { 'content-type': contentType } });
    const fileChunks = [];
    let fileName = null;
    let mime = 'application/octet-stream';
    const fields = {};

    await new Promise((resolve, reject) => {
      bb.on('field', (name, val) => { fields[name] = val; });
      bb.on('file', (_name, file, info) => {
        fileName = info.filename;
        mime = info.mimeType || mime;
        file.on('data', (d) => fileChunks.push(d));
        file.on('limit', () => reject(new Error('File too large')));
        file.on('end', () => {});
      });
      bb.on('error', reject);
      bb.on('finish', resolve);
      bb.end(Buffer.from(event.body, event.isBase64Encoded ? 'base64' : 'utf8'));
    });

    if (!fileChunks.length || !fileName) {
      return json({ ok:false, error:'Datoteka ni bila poslana' }, 400);
    }

    // Unikatna pot (ohrani pripono)
    const ext = (fileName.split('.').pop() || 'bin').toLowerCase();
    const base = `${Date.now()}-${slug(fields.eventName || '')}-${slug(fileName.replace(/\.[^.]+$/, ''))}`;
    const key  = `public/${base}.${ext}`;

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const { error: upErr } = await supabase
      .storage
      .from(BUCKET)
      .upload(key, Buffer.concat(fileChunks), { contentType: mime, upsert: false });

    if (upErr) return json({ ok:false, error: 'Napaka pri shranjevanju: ' + upErr.message }, 500);

    // Najprej poizkusi javni URL; če bucket ni public, ustvari signed URL (1 leto)
    let publicUrl = null;
    const { data: pub } = supabase.storage.from(BUCKET).getPublicUrl(key);
    publicUrl = pub?.publicUrl || null;

    if (!publicUrl) {
      const { data: signed, error: sErr } = await supabase
        .storage
        .from(BUCKET)
        .createSignedUrl(key, 60 * 60 * 24 * 365); // 1 leto
      if (sErr) return json({ ok:false, error:'Napaka pri generiranju URL: ' + sErr.message }, 500);
      publicUrl = signed.signedUrl;
    }

    // ⚠️ vrnemo ime polja, ki ga frontend pričakuje: `publicUrl`
    return json({ ok:true, path:key, publicUrl, name:fileName, mime, fields });

  } catch (e) {
    return json({ ok:false, error:String(e?.message || e) }, 500);
  }
};
