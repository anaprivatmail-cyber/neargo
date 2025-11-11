// netlify/functions/provider-ratings-get.js
// Aggregates provider exposure/engagement as a proxy for rating until reviews exist.
// Returns counts of published submissions per provider_email and optional average rating (if table exists later).

import { createClient } from '@supabase/supabase-js';

const CORS = {
	'Access-Control-Allow-Origin': '*',
	'Access-Control-Allow-Headers': 'Content-Type',
	'Access-Control-Allow-Methods': 'GET,OPTIONS'
};
const json = (d, s = 200) => ({ statusCode: s, headers: { 'Content-Type': 'application/json; charset=utf-8', ...CORS }, body: JSON.stringify(d) });

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const BUCKET = 'event-images';
const SUBMISSIONS_DIR = 'submissions';

export const handler = async (event) => {
	if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: CORS, body: '' };
	if (event.httpMethod !== 'GET') return json({ ok:false, error:'Method not allowed' }, 405);
	if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return json({ ok:false, error:'Missing SUPABASE env' }, 500);
	try{
		const supa = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
		// Read submissions list
		const { data: files, error } = await supa.storage.from(BUCKET).list(SUBMISSIONS_DIR, { limit: 1000 });
		if (error) throw new Error(error.message);
		const counts = new Map();
		for (const f of files || []){
			if (!f.name?.toLowerCase().endsWith('.json')) continue;
			const path = `${SUBMISSIONS_DIR}/${f.name}`;
			const { data, error: dlErr } = await supa.storage.from(BUCKET).download(path);
			if (dlErr) continue;
			try{
				const txt = await data.text();
				const obj = JSON.parse(txt);
				const email = String(obj.organizerEmail||obj.providerEmail||obj.provider_email||obj.email||'').toLowerCase();
				if (!email) continue;
				// Count only non-expired events (basic filter)
				const endMs = obj.end ? Date.parse(obj.end) : (obj.start ? Date.parse(obj.start) + 2*3600*1000 : 0);
				if (!endMs || Number.isNaN(endMs) || endMs < Date.now()) continue;
				counts.set(email, (counts.get(email)||0) + 1);
			}catch{ /* skip */ }
		}

		// Optional average rating if table exists (future): provider_ratings(provider_email, avg)
		const items = [];
		// Try to fetch avg rating table but ignore errors if not exists
		const avgMap = new Map();
		try{
			const { data: avgs } = await supa.from('provider_ratings').select('provider_email,avg').limit(10000);
			(avgs||[]).forEach(r => { if(r.provider_email) avgMap.set(String(r.provider_email).toLowerCase(), Number(r.avg||0)); });
		}catch{ /* table optional */ }

		counts.forEach((count, email) => {
			items.push({ provider_email: email, count, avg: avgMap.get(email) || null });
		});

		return json({ ok:true, items });
	}catch(e){
		return json({ ok:false, error: String(e?.message||e) }, 500);
	}
};
