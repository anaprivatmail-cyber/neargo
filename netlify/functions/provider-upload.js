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

export const handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: CORS, body: '' };
  if (event.httpMethod !== 'POST') return json({ ok:false, error:'Method not allowed' }, 405);

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return json({ ok:false, error:'Manjkajo SUPABASE_URL in/ali SUPABASE_SERVICE_ROLE_KEY' }, 500);
  }

  try {
    // Parse multipart/form-data
    const bb = Busboy({ headers: event.headers });
    const fileChunks = [];
    let fileName = null;
    let mime = 'application/octet-stream';

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
      bb.end(Buffer.from(event.body, event.isBase64Encoded ? 'base64' : 'utf8'));
    });

    if (!fileChunks.length || !fileName) {
      return json({ ok:false, error:'Datoteka ni bila poslana' }, 400);
    }

    // Unique ime (ohranimo pripono)
    const ext = (fileName.split('.').pop() || 'bin').toLowerCase();
    const safeBase = fileName.replace(/\.[^/.]+$/, '').slice(0, 60).replace(/[^a-z0-9_-]+/gi, '-');
    const key = `public/${Date.now()}-${safeBase}.${ext}`;

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const { error: upErr } = await supabase
      .storage
      .from('event-images')
      .upload(key, Buffer.concat(fileChunks), { contentType: mime, upsert: false });

    if (upErr) return json({ ok:false, error: 'Napaka pri shranjevanju: ' + upErr.message }, 500);

    // Javni URL (bucket naj bo Public)
    const { data: pub } = supabase.storage.from('event-images').getPublicUrl(key);
    const imagePublicUrl = pub?.publicUrl || null;

    return json({ ok:true, path:key, imagePublicUrl });
  } catch (e) {
    return json({ ok:false, error:String(e?.message || e) }, 500);
  }
};
