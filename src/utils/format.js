// src/utils/format.js
// Funkcije za formatiranje podatkov

export const euro = v => 
  Number.isFinite(+v) 
    ? new Intl.NumberFormat('sl-SI', { style: 'currency', currency: 'EUR' }).format(+v)
    : '';

export function formatDateRange(start, end) {
  if (!start) return "";
  const s = new Date(start);
  if (Number.isNaN(s)) return "";
  
  const hasEnd = !!end && !Number.isNaN(new Date(end));
  const dFmt = new Intl.DateTimeFormat("sl-SI", { 
    day: "2-digit", 
    month: "2-digit", 
    year: "numeric" 
  });
  const tFmt = new Intl.DateTimeFormat("sl-SI", { 
    hour: "2-digit", 
    minute: "2-digit" 
  });
  
  if (hasEnd) { 
    const e = new Date(end); 
    const same = s.toDateString() === e.toDateString();
    return same 
      ? `${dFmt.format(s)} ${tFmt.format(s)}–${tFmt.format(e)}`
      : `${dFmt.format(s)} ${tFmt.format(s)} — ${dFmt.format(e)} ${tFmt.format(e)}`;
  }
  
  return `${dFmt.format(s)} ${tFmt.format(s)}`;
}

export function formatPhoneNumber(phone) {
  if (!phone) return '';
  const cleaned = phone.replace(/\D/g, '');
  if (cleaned.length === 8) {
    return cleaned.replace(/(\d{2})(\d{3})(\d{3})/, '$1 $2 $3');
  }
  if (cleaned.length === 9 && cleaned.startsWith('0')) {
    return cleaned.replace(/(\d{3})(\d{3})(\d{3})/, '$1 $2 $3');
  }
  return phone;
}

export function truncateText(text, maxLength = 100) {
  if (!text || text.length <= maxLength) return text;
  return text.substring(0, maxLength) + '...';
}