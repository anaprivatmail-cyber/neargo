const CORS={ 'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'Content-Type, Authorization','Access-Control-Allow-Methods':'POST, OPTIONS' };
const MIN_PUBLISH_DELAY_MINUTES = parseInt(process.env.MIN_PUBLISH_DELAY_MINUTES || '15', 10);
exports.handler=async(event)=>{
  if(event.httpMethod==='OPTIONS')return{statusCode:204,headers:CORS};
  if(event.httpMethod!=='POST')return{statusCode:405,headers:CORS,body:'Method Not Allowed'};
  try{
    const data=JSON.parse(event.body||'{}');
    const req=['title','category','start','city','country','email'];
    for(const r of req){ if(!data[r]) return json({ok:false,error:`Manjka polje: ${r}`},400); }
    const item={
      id:`provider:${Date.now()}`, source:'provider', sourceId:null,
      name:String(data.title).trim(), description:String(data.description||'').trim(),
      url:data.ticketUrl||'', start:new Date(data.start).toISOString(), end:null, timezone:null,
      venue:{ name:data.venue||'', address:'', city:data.city||'', country:(data.country||'').toUpperCase(),
              lat: Number.isFinite(data.lat)?Number(data.lat):null, lon:Number.isFinite(data.lon)?Number(data.lon):null },
      performers:[], images: data.image?[data.image]:[], 
      price:(data.priceMin||data.priceMax)?{min:data.priceMin?Number(data.priceMin):null,max:data.priceMax?Number(data.priceMax):null,currency:data.currency||''}:null,
      categories:[String(data.category||'misc').toLowerCase()], contact:{email:data.email}, createdAt:new Date().toISOString()
    };
    const token=process.env.GITHUB_TOKEN, owner=process.env.GITHUB_OWNER, repo=process.env.GITHUB_REPO, path='data/providers.json';
    if(token&&owner&&repo){
      const api=`https://api.github.com/repos/${owner}/${repo}/contents/${path}`;
      let arr=[], sha=null;
      const get=await fetch(api,{headers:{Authorization:`Bearer ${token}`,'User-Agent':'NearGo'}});
      if(get.status===200){ const j=await get.json(); sha=j.sha; const content=Buffer.from(j.content,'base64').toString('utf8'); arr=JSON.parse(content||'[]'); }
      arr.push(item);
      const newContent=Buffer.from(JSON.stringify(arr,null,2)).toString('base64');
      const put=await fetch(api,{method:'PUT',headers:{Authorization:`Bearer ${token}`,'User-Agent':'NearGo'},
        body:JSON.stringify({message:`feat(provider): add ${item.name}`,content:newContent,sha})});
      if(!put.ok){ const t=await put.text().catch(()=>put.statusText); return json({ok:false,error:`GitHub write failed: ${t}`},500); }
    }else{
      console.log('Provider submission (no GitHub token):', item);
    }

    // === Supabase upsert v offers (minimalno, da geokodiranje in iskanje delujeta) ===
    try {
      const { createClient } = require('@supabase/supabase-js');
      const SUPABASE_URL = process.env.SUPABASE_URL;
      const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
      if(SUPABASE_URL && SERVICE_KEY){
        const supa = createClient(SUPABASE_URL, SERVICE_KEY, { auth:{persistSession:false} });
        const offerRow = {
          id: item.id,
          name: item.name,
          description: item.description||null,
          url: item.url||null,
          start: item.start||null,
          end: item.end||null,
            timezone: item.timezone||null,
          venue_address: item.venue.address||null,
          venue_city: item.venue.city||null,
          venue_country: item.venue.country||null,
          venue_lat: item.venue.lat||null,
          venue_lon: item.venue.lon||null,
          categories: item.categories||null,
          subcategory: (item.categories&&item.categories[0])?String(item.categories[0]).toLowerCase():null,
          images: item.images||null,
          price: item.price||null,
          contact: item.contact||null,
          source: item.source||null,
          source_id: item.sourceId||null,
          publish_at: item.start||null
        };
        const { error: upErr } = await supa.from('offers').upsert(offerRow, { onConflict: 'id' });
        if(upErr){ console.error('[provider-submit] offers upsert error', upErr.message); }
      } else {
        console.warn('[provider-submit] Supabase env vars missing, skip offers upsert');
      }
    } catch(e){
      console.error('[provider-submit] Supabase upsert failed', e.message||e);
    }
    const now = new Date();
    const minPublishAt = new Date(now.getTime() + MIN_PUBLISH_DELAY_MINUTES * 60 * 1000);
    item.publish_at = new Date(Math.max(new Date(item.start).getTime(), minPublishAt.getTime())).toISOString();

    // Trigger early-notify-offer immediately after submission
    try {
      const notifyUrl = `${process.env.NETLIFY_FUNCTIONS_URL}/early-notify-offer?id=${item.id}`;
      await fetch(notifyUrl, { method: 'POST' });
    } catch (e) {
      console.warn('[provider-submit] Failed to trigger early-notify-offer:', e.message);
    }

    return json({ok:true,result:item});
  }catch(err){ return json({ok:false,error:String(err?.message||err)},500); }
  function json(body,status=200){ return {statusCode:status,headers:CORS,body:JSON.stringify(body)}; }
};
