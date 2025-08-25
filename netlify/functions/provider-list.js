const CORS={
  'Access-Control-Allow-Origin':'*',
  'Access-Control-Allow-Headers':'Content-Type, Authorization',
  'Access-Control-Allow-Methods':'GET, OPTIONS'
};

exports.handler=async(event)=>{
  if(event.httpMethod==='OPTIONS') return {statusCode:204,headers:CORS};
  if(event.httpMethod!=='GET') return {statusCode:405,headers:CORS,body:'Method Not Allowed'};

  try{
    const token=process.env.GITHUB_TOKEN, owner=process.env.GITHUB_OWNER, repo=process.env.GITHUB_REPO, path='data/providers.json';
    if(!(token&&owner&&repo)) return json({ok:true,results:[]}); // frontend ima localStorage fallback

    const api=`https://api.github.com/repos/${owner}/${repo}/contents/${path}`;
    const res=await fetch(api,{headers:{Authorization:`Bearer ${token}`,'User-Agent':'NearGo'}});
    if(res.status===404) return json({ok:true,results:[]});
    if(!res.ok){ const t=await res.text().catch(()=>res.statusText); return json({ok:false,error:`GitHub read failed: ${t}`},500); }

    const j=await res.json();
    const content=Buffer.from(j.content,'base64').toString('utf8');
    const arr=JSON.parse(content||'[]');

    const results=arr.map(x=>({
      id:x.id || `provider:${x.name}:${x.start}`,
      source:'provider',
      name:x.name || x.title || '',
      description:x.description || '',
      url:x.url || x.ticketUrl || '',
      start:x.start || null, end:x.end || null,
      venue:x.venue || {name:'',city:x.city||'',country:x.country||'',lat:x.lat||null,lon:x.lon||null},
      images:x.images || (x.image?[x.image]:[]),
      price:x.price || ((x.priceMin||x.priceMax)?{min:x.priceMin||null,max:x.priceMax||null,currency:x.currency||''}:null),
      categories:x.categories || (x.category?[x.category]:[]),
      featured: !!x.featured
    }));

    return json({ok:true,results});
  }catch(err){
    return json({ok:false,error:String(err?.message||err)},500);
  }

  function json(body,status=200){ return {statusCode:status,headers:CORS,body:JSON.stringify(body)}; }
};
