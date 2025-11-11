// scripts/test-early-logic.mjs
// Minimal self-test for early access filtering

function parseDateAny(v){
  if(!v) return NaN; if(v instanceof Date) return +v;
  const t=Date.parse(v); if(!isNaN(t)) return t;
  const s=String(v).trim();
  const m=s.match(/^(\d{1,2})[.\-/ ](\d{1,2})[.\-/ ](\d{2,4})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/);
  if(m){ const d=m[1], mo=m[2], y=m[3], h=m[4]||'00', mi=m[5]||'00', se=m[6]||'00'; const yy=y.length===2?('20'+y):y; return +new Date(+yy,+mo-1,+d,+h,+mi,+se); }
  return NaN;
}

function filterEarlyAndStock(items, { IS_PREMIUM, EARLY_MINUTES, EARLY_PREF_CATS }){
  const now=Date.now();
  const earlyMs=EARLY_MINUTES*60*1000;
  return items.filter(e=>{
    try{
      const kind=String(e.offerType||'').toLowerCase();
      if((kind==='coupon'||kind==='ticket') && Number(e.stock||0) <= 0) return false;
      if(kind==='coupon'){
        const t=parseDateAny(e.publish_at || e.start || e.starts_at || null);
        if(!isFinite(t)) return true;
        if(now < (t - earlyMs)) { e._earlyPreview=false; return false; }
        if(now >= t) { e._earlyPreview=false; return true; }
        if(!IS_PREMIUM) { e._earlyPreview=false; return false; }
        const sub=String(e.subcategory||e.subCategory||e.subcategoryKey||'').toLowerCase();
        const allow = EARLY_PREF_CATS.has(sub);
        e._earlyPreview = !!allow; return allow;
      }
      return true;
    }catch{ return true; }
  });
}

// Build test cases
const now = new Date();
const fmt = d => new Date(d).toISOString();
const minus = m => new Date(Date.now() - m*60*1000);
const plus  = m => new Date(Date.now() + m*60*1000);

const base = (overrides)=>({
  name: 'Test', offerType:'coupon', stock: 5, subcategory:'food-street', publish_at: fmt(plus(10)), ...overrides
});

const cases = [
  { id:'prewindow-nonpremium', it: base({}), IS_PREMIUM:false, expect:false },
  { id:'prewindow-premium-badsub', it: base({}), IS_PREMIUM:true, prefs:new Set(['other']), expect:false },
  { id:'prewindow-premium-goodsub', it: base({}), IS_PREMIUM:true, prefs:new Set(['food-street']), expect:true, early:true },
  { id:'after-publish', it: base({ publish_at: fmt(minus(1)) }), IS_PREMIUM:false, expect:true },
  { id:'before-early', it: base({ publish_at: fmt(plus(20)) }), IS_PREMIUM:true, prefs:new Set(['food-street']), expect:false },
  { id:'stock-zero', it: base({ stock:0 }), IS_PREMIUM:true, prefs:new Set(['food-street']), expect:false },
  { id:'non-coupon-ignore', it: { name:'Ticket', offerType:'ticket', stock:1, start: fmt(plus(1)) }, IS_PREMIUM:false, expect:true }
];

let passed=0;
for (const c of cases){
  const env = { IS_PREMIUM: !!c.IS_PREMIUM, EARLY_MINUTES:15, EARLY_PREF_CATS: c.prefs || new Set() };
  const out = filterEarlyAndStock([c.it], env);
  const ok = (out.length===1) === c.expect && (!!(out[0]&&out[0]._earlyPreview) === !!c.early || !c.early);
  console.log(`${ok?'PASS':'FAIL'}: ${c.id}`);
  if (ok) passed++;
}
console.log(`\n${passed}/${cases.length} tests passed`);
