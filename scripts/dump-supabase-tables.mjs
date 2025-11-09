#!/usr/bin/env node
// Dump Supabase table metadata to a local JSON file using meta endpoints.
// Requires env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
import fs from 'fs';

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !key) {
  console.error('Manjkajo okoljski ključi SUPABASE_URL ali SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

async function fetchMeta(path) {
  const res = await fetch(`${url}/pg/meta/${path}`, {
    headers: {
      apiKey: key,
      Authorization: `Bearer ${key}`,
    },
  });
  if (!res.ok) throw new Error(`Napaka pri meta fetch ${path}: ${res.status}`);
  return res.json();
}

(async () => {
  try {
    const [tables, columns] = await Promise.all([
      fetchMeta('tables'),
      fetchMeta('columns'),
    ]);

    const publicTables = tables.filter(t => t.schema === 'public');
    const publicColumns = columns.filter(c => c.schema === 'public');

    const enriched = publicTables.map(t => ({
      name: t.name,
      insertable: t.insertable,
      updatable: t.updatable,
      deletable: t.deletable,
      rls_enabled: t.rls_enabled,
      replica_identity: t.replica_identity,
      columns: publicColumns.filter(c => c.table === t.name).map(c => ({
        name: c.name,
        type: c.format,
        nullable: c.nullable,
        default_value: c.default_value,
        is_identity: c.is_identity,
        is_generated: c.is_generated,
      })),
    }));

    const outFile = 'supabase-tables.json';
    fs.writeFileSync(outFile, JSON.stringify({ generated_at: new Date().toISOString(), tables: enriched }, null, 2));
    console.log(`Shranjeno: ${outFile} (tabele: ${enriched.length})`);
  } catch (e) {
    console.error('Napaka:', e.message || e);
    process.exit(2);
  }
})();
