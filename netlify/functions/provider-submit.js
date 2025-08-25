const CORS={
  'Access-Control-Allow-Origin':'*',
  'Access-Control-Allow-Headers':'Content-Type, Authorization',
  'Access-Control-Allow-Methods':'POST, OPTIONS'
};

exports.handler=async(event)=>{
  if(event.httpMethod==='OPTIONS') return {statusCode:204,headers:CORS};
  if(event.httpMethod!=='POST') return {statusCode:405,headers:CORS,body:'Method Not Allowed'};

  try{
    const data=JSON.parse(event.body||'{}');
    const required=['title','category','start','city','country','email'];
    for(const r of required){ if(!data[r]) return json({ok:false,error:`Manjka polje: ${r}`},400); }

    const item={
      id:`provider:${Date.now()}`,
      source:'provider', sourceId:null,
      name:String(data.title).trim(),
      description:String(data.description||'').trim(),
      url:data.ticketUrl||'',
      start:new Date(data.start).toISOString(),
      end:null, timezone:null,
      venue:{ name:data.venue||'', address:'', city:data.city||'', country:(data.country||'').toUpperCase(),
              lat:Number.isFinite(data.lat)?Number(data.lat):null, lon:Number.isFinite(data.lon)?Number(data.lon):null },
      performers:[], images:data.image?[data.image]:[],
      price:(data.priceMin||data.priceMax)?{min:data.priceMin?Number(data.priceMin):null,max:data.priceMax?Number(data.priceMax):null,currency:data.currency||''}:null,
      categories:[String(data.category||'misc').toLowerCase()],
      featured: !!data.featured,
      contact:{email:data.email},
      createdAt:new Date().toISOString()
    };

    const token=process.env.GITHUB_TOKEN, owner=process.env.GITHUB_OWNER, repo=process.env.GITHUB_REPO, path='data/providers.json';
    if(token&&owner&&repo){
      const api=`https://api.github.com/repos/${owner}/${repo}/contents/${path}`;
      let arr=[], sha=null;
      const get=await fetch(api,{headers:{Authorization:`Bearer ${token}`,'User-Agent':'NearGo'}});
      if(get.status===200){ const j=await get.json(); sha=j.sha; const content=Buffer.from(j.content,'base64').toString('utf8'); arr=JSON.parse(content||'[]'); }
      arr.push(item);
      const newContent=Buffer.from(JSON.stringify(arr,null,2)).toString('base64');
      const put=await fetch(api,{method:'PUT',headers:{Authorization:`Bearer ${token}`,'User-Agent':'NearGo'},body:JSON.stringify({message:`feat(provider): add ${item.name}`,content:newContent,sha})});
      if(!put.ok){ const t=await put.text().catch(()=>put.statusText); return json({ok:false,error:`GitHub write failed: ${t}`},500); }
    } else {
      // Brez žetona — še vedno vrnemo OK, frontend shrani v localStorage
      console.log('Provider submission (no GitHub token):', item.name);
    }
    return json({ok:true,result:item});
  }catch(err){
    return json({ok:false,error:String(err?.message||err)},500);
  }

  function json(body,status=200){ return {statusCode:status,headers:CORS,body:JSON.stringify(body)}; }
};
