export const $ = s => document.querySelector(s);
export const el = (t,c) => { const x=document.createElement(t); if(c) x.className=c; return x; };
export const qs = o => new URLSearchParams(o).toString();
export const euro = v => Number.isFinite(+v)?new Intl.NumberFormat('sl-SI',{style:'currency',currency:'EUR'}).format(+v):'';
export const debounce=(fn,ms=350)=>{ let t; return(...a)=>{ clearTimeout(t); t=setTimeout(()=>fn(...a),ms);} };
export const isExternalAPI = e => (e?.url||'').toLowerCase().includes('ticketmaster') || (e?.url||'').toLowerCase().includes('eventbrite');

const makeHashId = (entry) => {
  if (!entry) return 'ev-unknown';
  if (entry.id !== undefined && entry.id !== null) {
    return `ev-${String(entry.id).replace(/[^a-z0-9]/gi, '')}`;
  }
  const name = String(entry.name || entry.title || 'item')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
  const start = String(entry.start || entry.start_time || '')
    .replace(/[^0-9]/g, '')
    .slice(0, 16);
  const base = name || 'item';
  return `ev-${base}${start ? `-${start}` : ''}`.replace(/-+/g, '-');
};

const hashIdImpl = (() => {
  try {
    if (typeof window !== 'undefined' && typeof window.hashId === 'function') {
      return window.hashId;
    }
  } catch (err) {
    /* no-op */
  }
  return makeHashId;
})();

if (typeof window !== 'undefined') {
  try {
    if (typeof window.hashId !== 'function') {
      window.hashId = hashIdImpl;
    }
    window.NearGoHelpers = window.NearGoHelpers || {};
    window.NearGoHelpers.hashId = window.hashId;
  } catch (err) {
    /* swallow */
  }
}

export function hashId(e){
  return hashIdImpl(e);
}

export function formatDateRange(start,end){
  if(!start) return ""; const s=new Date(start); if(Number.isNaN(s)) return "";
  const hasEnd=!!end&&!Number.isNaN(new Date(end));
  const dFmt=new Intl.DateTimeFormat("sl-SI",{day:"2-digit",month:"2-digit",year:"numeric"});
  const tFmt=new Intl.DateTimeFormat("sl-SI",{hour:"2-digit",minute:"2-digit"});
  if(hasEnd){ const e=new Date(end); const same=s.toDateString()===e.toDateString();
    return same?`${dFmt.format(s)} ${tFmt.format(s)}–${tFmt.format(e)}`:`${dFmt.format(s)} ${tFmt.format(s)} — ${dFmt.format(e)} ${tFmt.format(e)}`; }
  return `${dFmt.format(s)} ${tFmt.format(s)}`;
}
