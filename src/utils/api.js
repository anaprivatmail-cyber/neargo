// src/utils/api.js
// API pomožne funkcije

export const qs = o => new URLSearchParams(o).toString();

export function cacheBust() {
  return window.__BUILD_TS__ || String(Date.now());
}

export const isExternalAPI = e => 
  (e?.url || '').toLowerCase().includes('ticketmaster') || 
  (e?.url || '').toLowerCase().includes('eventbrite');

export async function fetchWithRetry(url, options = {}, maxRetries = 3) {
  for (let i = 0; i < maxRetries; i++) {
    try {
      const response = await fetch(url, options);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      return response;
    } catch (error) {
      if (i === maxRetries - 1) throw error;
      await new Promise(resolve => setTimeout(resolve, 1000 * Math.pow(2, i)));
    }
  }
}

export async function loadPart(id, url) {
  const host = document.querySelector(`#${id}`);
  if (!host) return;
  
  if (id === 'topbar') host.innerHTML = ''; // čist header
  
  const sep = url.includes('?') ? '&' : '?';
  const html = await fetch(`${url}${sep}v=${encodeURIComponent(cacheBust())}`, {
    cache: 'no-cache'
  }).then(r => r.text());
  
  host.insertAdjacentHTML('beforeend', html);
}

export class APIError extends Error {
  constructor(message, status, response) {
    super(message);
    this.name = 'APIError';
    this.status = status;
    this.response = response;
  }
}