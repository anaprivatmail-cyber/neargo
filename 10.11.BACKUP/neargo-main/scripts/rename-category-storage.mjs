#!/usr/bin/env node
/**
 * Rename legacy category keys in Supabase Storage JSON submissions.
 * Old -> New:
 *   kulinarika          -> kulinarka
 *   kulinarika-catering -> kulinarka-catering
 *
 * Requirements:
 *   - SUPABASE_URL
 *   - SUPABASE_SERVICE_ROLE_KEY (or anon key with write perms to the bucket)
 *
 * Safe behavior:
 *   - Creates a backup copy before overwriting: submissions/_backup/YYYY-MM-DD/<filename>
 *   - Skips non-JSON files and malformed JSON
 *   - Dry run by default unless --write is provided
 */

import { createClient } from '@supabase/supabase-js';

const BUCKET = 'event-images';
const PREFIX = 'submissions/';
const BACKUP_PREFIX = 'submissions/_backup/';

const DRY = !process.argv.includes('--write');

function today(){
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

function renameCategory(value){
  const v = String(value || '').toLowerCase();
  if (v === 'kulinarika') return 'kulinarka';
  if (v === 'kulinarika-catering') return 'kulinarka-catering';
  return value;
}

async function main(){
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY){
    console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
    process.exit(2);
  }
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  const { data: files, error } = await supabase.storage.from(BUCKET).list(PREFIX, { limit: 2000 });
  if (error){ console.error('List error:', error.message); process.exit(1); }

  let scanned = 0, patched = 0, skipped = 0, backed = 0;
  for (const f of files || []){
    if (!f.name.endsWith('.json')) { skipped++; continue; }
    const path = PREFIX + f.name;
    const dl = await supabase.storage.from(BUCKET).download(path);
    if (dl.error || !dl.data){ skipped++; continue; }
    let obj;
    try{ obj = JSON.parse(await dl.data.text()); }catch{ skipped++; continue; }
    scanned++;

    const before = obj.category;
    const after  = renameCategory(before);
    if (before === after) continue;

    console.log(`[change] ${path}: ${before} -> ${after}`);
    obj.category = after;

    if (DRY) { patched++; continue; }

    // backup once
    const backupPath = `${BACKUP_PREFIX}${today()}/${f.name}`;
    const head = await supabase.storage.from(BUCKET).download(backupPath);
    if (!head.data){
      const enc = new TextEncoder();
      const payload = enc.encode(JSON.stringify(JSON.parse(JSON.stringify(obj, (k,v)=>k==='category'?before:v)), null, 2));
      const up = await supabase.storage.from(BUCKET).upload(backupPath, payload, {
        contentType: 'application/json',
        upsert: false
      });
      if (up.error){ console.warn('Backup failed:', backupPath, up.error.message); }
      else { backed++; }
    }

    const enc2 = new TextEncoder();
    const payload2 = enc2.encode(JSON.stringify(obj, null, 2));
    const up2 = await supabase.storage.from(BUCKET).upload(path, payload2, {
      contentType: 'application/json',
      upsert: true
    });
    if (up2.error){ console.error('Write failed:', path, up2.error.message); }
    else { patched++; }
  }

  console.log(`Done. scanned=${scanned} patched=${patched} skipped=${skipped} backups=${backed} dry=${DRY}`);
}

main().catch((e)=>{ console.error(e); process.exit(1); });
