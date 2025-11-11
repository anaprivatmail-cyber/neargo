// netlify/functions/calendar-slots.js (ESM)
// Manage NearGo provider calendars' slots and list public availability
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL  = process.env.SUPABASE_URL;
const SERVICE_KEY   = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supa = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession:false } });

const CORS = { 'Access-Control-Allow-Origin':'*', 'Access-Control-Allow-Methods':'GET,POST,PATCH,DELETE,OPTIONS', 'Access-Control-Allow-Headers':'content-type' };
const ok  = (b,s=200)=>({ statusCode:s, headers:{ 'content-type':'application/json', ...CORS }, body: JSON.stringify(b) });
const bad = (m,s=400)=>({ statusCode:s, headers:{ 'content-type':'application/json', ...CORS }, body: JSON.stringify({ ok:false, error:String(m) }) });

function parseIso(s){ const t = Date.parse(String(s||'')); return Number.isFinite(t)? new Date(t): null; }

async function requireCalendarByToken(token){
  if(!token) return null;
  const { data } = await supa.from('provider_calendars').select('id,provider_email,title,edit_token,token_expires_at').eq('edit_token', token).maybeSingle();
  if (!data) return null;
  if (data.token_expires_at && new Date(data.token_expires_at).getTime() < Date.now()) return null;
  return data;
}

export const handler = async (event) => {
  try{
    if (event.httpMethod === 'OPTIONS') return { statusCode:204, headers:CORS, body:'' };
    const method = event.httpMethod;
    const qs = event.queryStringParameters || {};

    if (method === 'GET'){
      const calendarId = qs.calendar_id || qs.calendarId || '';
      const token      = qs.token || '';
      const mode       = (qs.mode||'').toLowerCase();
      if (!calendarId) return bad('missing_calendar_id');

      // If provider token present, return all (including reserved/blocked). Otherwise, public free future only
      const isProvider = token ? !!(await requireCalendarByToken(token)) : false;
      if (mode === 'reservations'){
        if (!isProvider) return bad('unauthorized', 401);
        const { data, error } = await supa
          .from('provider_reservations')
          .select('id,slot_id,reserved_email,reserved_at,status,cancelled_at')
          .eq('calendar_id', calendarId)
          .order('reserved_at', { ascending:false });
        if (error) return bad('db_error: '+error.message, 500);
        return ok({ ok:true, reservations: data||[] });
      } else {
        let q = supa.from('provider_slots').select('id,start_time,end_time,status,reserved_email,reserved_at,coupon_token').eq('calendar_id', calendarId);
        if (!isProvider) q = q.eq('status','free').gte('start_time', new Date().toISOString());
        const { data, error } = await q.order('start_time', { ascending:true });
        if (error) return bad('db_error: '+error.message, 500);
        return ok({ ok:true, slots:data||[] });
      }
    }

    if (method === 'POST'){
      // Add multiple slots; requires provider edit token
      const body = JSON.parse(event.body||'{}');
      const token = body.token || '';
      const cal = await requireCalendarByToken(token);
      if (!cal) return bad('unauthorized', 401);
      const slots = Array.isArray(body.slots) ? body.slots : [];
      if (!slots.length) return bad('no_slots');
      const rows = [];
      for (const s of slots){
        const a = parseIso(s.start||s.start_time); const b = parseIso(s.end||s.end_time);
        if (!a || !b || b <= a) continue;
        // Overlap prevention: ensure no existing slot overlaps (start < existing.end AND end > existing.start)
        const { data: conflicts, error: confErr } = await supa
          .from('provider_slots')
          .select('id')
          .eq('calendar_id', cal.id)
          .or(`and(start_time.lt.${b.toISOString()},end_time.gt.${a.toISOString()})`);
        if (confErr) return bad('db_error_conflict: '+confErr.message, 500);
        if (conflicts && conflicts.length) continue; // skip conflicting slot silently
        rows.push({ calendar_id: cal.id, start_time: a.toISOString(), end_time: b.toISOString(), status:'free' });
      }
      if (!rows.length) return bad('invalid_slots');
      const { data, error } = await supa.from('provider_slots').insert(rows).select('id,start_time,end_time,status');
      if (error) return bad('db_error: '+error.message, 500);
      return ok({ ok:true, inserted: data });
    }

    if (method === 'PATCH'){
      // Update single slot status or times; requires token
      const body = JSON.parse(event.body||'{}');
      const token = body.token || '';
      const cal = await requireCalendarByToken(token);
      if (!cal) return bad('unauthorized', 401);
      const id = body.id || '';
      if (!id) return bad('missing_id');
      const patch = {};
      if (body.status && ['free','reserved','blocked'].includes(body.status)) patch.status = body.status;
      if (body.start || body.start_time){ const d = parseIso(body.start||body.start_time); if (d) patch.start_time = d.toISOString(); }
      if (body.end || body.end_time){ const d = parseIso(body.end||body.end_time); if (d) patch.end_time = d.toISOString(); }
      if (!Object.keys(patch).length) return bad('nothing_to_update');
      // If times are changing, validate no overlap with other slots
      if (patch.start_time || patch.end_time){
        const start = patch.start_time || (await supa.from('provider_slots').select('start_time').eq('id', id).maybeSingle()).data?.start_time;
        const end   = patch.end_time   || (await supa.from('provider_slots').select('end_time').eq('id', id).maybeSingle()).data?.end_time;
        if (!start || !end || new Date(end) <= new Date(start)) return bad('invalid_time_range');
        const { data: conflicts, error: confErr } = await supa
          .from('provider_slots')
          .select('id')
          .eq('calendar_id', cal.id)
          .neq('id', id)
          .or(`and(start_time.lt.${end},end_time.gt.${start})`);
        if (confErr) return bad('db_error_conflict: '+confErr.message, 500);
        if (conflicts && conflicts.length) return bad('overlap_conflict');
      }
      patch.updated_at = new Date().toISOString();
      const { data, error } = await supa.from('provider_slots').update(patch).eq('id', id).eq('calendar_id', cal.id).select('id,start_time,end_time,status');
      if (error) return bad('db_error: '+error.message, 500);
      return ok({ ok:true, updated: data?.[0] || null });
    }

    if (method === 'DELETE'){
      const body = JSON.parse(event.body||'{}');
      const token = body.token || '';
      const cal = await requireCalendarByToken(token);
      if (!cal) return bad('unauthorized', 401);
      const id = body.id || '';
      if (!id) return bad('missing_id');
      // only delete future and not reserved
      const { error } = await supa.from('provider_slots').delete().eq('id', id).eq('calendar_id', cal.id).in('status',['free','blocked']);
      if (error) return bad('db_error: '+error.message, 500);
      return ok({ ok:true, deleted:true });
    }

    return bad('method_not_allowed', 405);
  }catch(e){
    return bad(e?.message||e, 500);
  }
};
