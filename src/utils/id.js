// src/utils/id.js
// Funkcije za generiranje ID-jev

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

// Uporabi globalno funkcijo če obstaja, sicer naša implementacija
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

// Globalno dostopnost za kompatibilnost
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

export function hashId(e) {
  return hashIdImpl(e);
}

export function generateUniqueId(prefix = 'id') {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

export function slugify(text) {
  return text
    .toString()
    .toLowerCase()
    .trim()
    .replace(/\s+/g, '-')
    .replace(/[^\w\-]+/g, '')
    .replace(/\-\-+/g, '-')
    .replace(/^-+/, '')
    .replace(/-+$/, '');
}