// v /.netlify/functions/scan.js
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY, // ker pišemo v vnovcitve
  { auth: { persistSession: false } }
);

export async function handler(event) {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200 };
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method not allowed' };

  const { resourceType, resourceId, signature, providerId, deviceId } = JSON.parse(event.body || '{}');
  if (!resourceType || !resourceId || !signature) {
    return { statusCode: 400, body: JSON.stringify({ result: 'INVALID', reason: 'missing_fields' }) };
  }

  const { data, error } = await supabase.rpc('redeem_scan', {
    _resource_type: resourceType,
    _resource_id: Number(resourceId),    // BIGINT
    _signature: String(signature),
    _provider_id: providerId || null,
    _device_id: deviceId || null
  });

  if (error) return { statusCode: 500, body: JSON.stringify({ error: error.message }) };
  return { statusCode: 200, body: JSON.stringify(data) };
}
