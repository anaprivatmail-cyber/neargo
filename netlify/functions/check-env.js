// Small secure env probe: returns booleans only. Requires x-check-tables-token header.
export const handler = async (event) => {
  const expected = process.env.CHECK_TABLES_TOKEN || '';
  const got = event?.headers?.['x-check-tables-token'] || event?.headers?.['X-Check-Tables-Token'] || '';
  const diagFlag = String(process.env.DIAGNOSTICS_ENABLED || '').toLowerCase() === 'true';

  // Gate: if token is configured, require it; if not configured, allow only when diagnostics flag is on
  const allowed = expected ? (got === expected) : diagFlag;
  if (!allowed) return { statusCode: 404, body: '' };

  const b = (v)=> String(v||'').toLowerCase();
  return {
    statusCode: 200,
    headers: { 'content-type': 'application/json', 'cache-control':'no-store' },
    body: JSON.stringify({
      has_SUPABASE_URL: !!process.env.SUPABASE_URL,
      has_SUPABASE_SERVICE_ROLE_KEY: !!process.env.SUPABASE_SERVICE_ROLE_KEY,
      has_CHECK_TABLES_TOKEN: !!process.env.CHECK_TABLES_TOKEN,
      DIAGNOSTICS_ENABLED: b(process.env.DIAGNOSTICS_ENABLED),
      node: process.version
    })
  };
};
