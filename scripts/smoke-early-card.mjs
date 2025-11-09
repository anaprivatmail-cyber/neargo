// scripts/smoke-early-card.mjs
// Manual visual test helper for early notification card
// Usage in browser console (loaded page):
//   import('/scripts/smoke-early-card.mjs').then(m=>m.show())

export function show(){
  window.IS_PREMIUM = true;
  import('/assets/early-card.js').then(({ showEarlyOfferCard })=>{
    const now = new Date();
    const offer = {
      id: 'test-offer-'+Math.random().toString(36).slice(2,8),
      name: 'Testni dogodek – koncert',
      subcategory: 'koncerti-pop',
      publish_at: new Date(now.getTime()+15*60*1000).toISOString()
    };
    showEarlyOfferCard(offer);
  });
}
