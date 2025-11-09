#!/usr/bin/env node
// List tables via a direct Postgres connection (no RLS/permissions issues)
// Requires env: SUPABASE_DB_URL (or DATABASE_URL)
import { Client } from 'pg';

const conn = process.env.SUPABASE_DB_URL || process.env.DATABASE_URL;
if (!conn) {
  console.error('Manjka SUPABASE_DB_URL ali DATABASE_URL v okolju. Poglej .env.example');
  process.exit(1);
}

const client = new Client({ connectionString: conn, ssl: { rejectUnauthorized: false } });

(async () => {
  try {
    await client.connect();

    const tables = await client.query(`
      select table_schema, table_name, table_type
      from information_schema.tables
      where table_schema not in ('pg_catalog','information_schema')
      order by 1,2
    `);

    const columns = await client.query(`
      select table_schema, table_name, column_name, data_type, is_nullable
      from information_schema.columns
      where table_schema not in ('pg_catalog','information_schema')
      order by 1,2,3
    `);

    const byTable = {};
    for (const t of tables.rows) {
      const key = `${t.table_schema}.${t.table_name}`;
      byTable[key] = { schema: t.table_schema, name: t.table_name, type: t.table_type, columns: [] };
    }
    for (const c of columns.rows) {
      const key = `${c.table_schema}.${c.table_name}`;
      if (!byTable[key]) byTable[key] = { schema: c.table_schema, name: c.table_name, type: 'BASE TABLE', columns: [] };
      byTable[key].columns.push({ name: c.column_name, type: c.data_type, nullable: c.is_nullable === 'YES' });
    }

    const list = Object.values(byTable);
    console.log(`Najdenih tabel: ${list.length}`);
    for (const t of list) {
      console.log(`- ${t.schema}.${t.name} (${t.columns.length} stolpcev)`);
    }
  } catch (e) {
    console.error('Napaka:', e.message || e);
    process.exit(2);
  } finally {
    await client.end().catch(()=>{});
  }
})();
