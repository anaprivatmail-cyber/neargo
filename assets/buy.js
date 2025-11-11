function addToCalendar({title,start,end,loc}){
  const s=new Date(start), e=end?new Date(end):new Date(new Date(start).getTime()+2*60*60*1000);
  const toGCalTime = d => d.toISOString().replace(/[-:]/g,'').replace(/\.\d{3}Z$/,'Z');
  const gcal=`https://calendar.google.com/calendar/render?action=TEMPLATE&text=${encodeURIComponent(title)}&dates=${toGCalTime(s)}/${toGCalTime(e)}&location=${encodeURIComponent(loc||'')}&details=${encodeURIComponent('Dodano prek NearGo')}`;
  try{ window.open(gcal,'_blank','noopener'); }catch{}
  const pad=x=>String(x).padStart(2,'0');
  const icsStamp = d => `${d.getUTCFullYear()}${pad(d.getUTCMonth()+1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}00Z`;
  const ics=[
    "BEGIN:VCALENDAR","VERSION:2.0","PRODID:-//NearGo//EN","CALSCALE:GREGORIAN","METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `DTSTAMP:${icsStamp(new Date())}`,
    `DTSTART:${icsStamp(s)}`,
    `DTEND:${icsStamp(e)}`,
    `SUMMARY:${title}`,
    loc?`LOCATION:${loc}`:"",
    "BEGIN:VALARM","TRIGGER:-PT24H","ACTION:DISPLAY","DESCRIPTION:Opomnik: dogodek čez 24 ur","END:VALARM",
    "BEGIN:VALARM","TRIGGER:-PT4H","ACTION:DISPLAY","DESCRIPTION:Opomnik: dogodek čez 4 ure","END:VALARM",
    "END:VEVENT","END:VCALENDAR"
  ].filter(Boolean).join("\r\n");
  const a=document.createElement("a");
  a.href=URL.createObjectURL(new Blob([ics],{type:"text/calendar"})); a.download="dogodek.ics"; a.click();
  setTimeout(()=>URL.revokeObjectURL(a.href),500);
}

export function initBuy(){
  document.addEventListener('click', async (ev) => {
    const btn=ev.target.closest('[data-act]'); if(!btn) return;
    const act=btn.dataset.act;

    if (act === 'more') {
      const card=btn.closest('.meta, .spot, .card'); 
      const box=card?.querySelector('.more-text');
      if(box){ box.style.display=(box.style.display==="block") ? "none" : "block"; }
      return;
    }
    if (act === 'share') {
      const title=decodeURIComponent(btn.dataset.title||"Dogodek");
      const url=decodeURIComponent(btn.dataset.url||location.href);
      try{
        if(navigator.share){ await navigator.share({title,url}); }
        else { await navigator.clipboard.writeText(url); window._toast?.("Povezava skopirana 👍",true); }
      }catch{}
      return;
    }
    if (act === 'ics') {
      const title=decodeURIComponent(btn.dataset.title||"Dogodek");
      const start=btn.dataset.start||"", end=btn.dataset.end||"", loc=decodeURIComponent(btn.dataset.loc||"");
      addToCalendar({title, start, end, loc});
      return;
    }
    if (act === 'buy') {
      btn.disabled=true;
      try{
        const kind=btn.dataset.kind||"ticket"; 
        let payload;
        if(kind==="coupon"){
          // podpora za FREE kupon preko data-free="1"
          if (btn.dataset.free === '1') {
            const email = (localStorage.getItem('user_email')||'').trim();
            if (!email){
              alert('Za brezplačni kupon je potrebna prijava (Premium).');
              try{ location.href = '/login.html?return=' + encodeURIComponent(location.pathname); }catch{}
              return;
            }
            const freeBody = {
              email,
              event_id: btn.dataset.eid || '',
              event_title: decodeURIComponent(btn.dataset.name||'Dogodek'),
              display_benefit: decodeURIComponent(btn.dataset.benefit||'Brezplačno')
            };
            const fr = await fetch('/api/free-coupon', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(freeBody) })
                       .then(r=>r.json()).catch(()=>({}));
            if(fr && fr.ok){ window._toast?.('Kupon izdan ✅', true); location.href = '/my.html#success'; }
            else if(fr && fr.error === 'premium_required'){ alert('Brezplačni kupon je na voljo le za Premium člane.'); }
            else if(fr && fr.error === 'rate_limit'){ alert('Dosežena dnevna omejitev brezplačnih kuponov. Poizkusite jutri.'); }
            else { alert('Napaka pri izdaji brezplačnega kupona'); }
            return; // skip stripe
          }
          payload={
            type:"coupon",
            metadata:{type:"coupon",event_title:decodeURIComponent(btn.dataset.name||"Dogodek"),
            display_benefit:decodeURIComponent(btn.dataset.benefit||"")},
            successUrl:`${location.origin}/#success`,
            cancelUrl:`${location.origin}/#cancel`
          };
        }else{
          payload={
            lineItems:[{
              name:decodeURIComponent(btn.dataset.name||"Dogodek"),
              description:kind,
              amount:Number(btn.dataset.price||0),
              currency:"eur", quantity:1
            }],
            metadata:{ image_url:btn.dataset.img||"", event_id:btn.dataset.eid||"" },
            successUrl:`${location.origin}/#success`,
            cancelUrl:`${location.origin}/#cancel`
          };
        }
        const r=await fetch("/api/checkout",{method:"POST",headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)})
                  .then(x=>x.json()).catch(()=>({}));
        if(r && r.ok && r.url){ location.href=r.url; } 
        else { alert("Plačilnega okna ni bilo mogoče odpreti."); }
      }catch{ alert("Napaka pri plačilu."); } 
      finally{ btn.disabled=false; }
      return;
    }
  }, {passive:true});
}
