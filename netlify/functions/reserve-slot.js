exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return { statusCode:405, body:'POST only' };
  const { eventId, slotId, qty=1, email } = JSON.parse(event.body||'{}');
  const { supa } = require('../../providers/supa');

  // preberi stanje slota + aktivne holde
  const { data: slotArr, error: e1 } = await supa.from('service_slots').select('*').eq('id', slotId).single();
  if (e1 || !slotArr) return { statusCode:404, body:JSON.stringify({ ok:false, error:'slot not found' })};

  const now = new Date();
  const { data: holds } = await supa.from('slot_holds')
      .select('qty').eq('slot_id', slotId).eq('status','held').gte('expires_at', now.toISOString());

  const held = (holds||[]).reduce((s,h)=>s+(h.qty||0),0);
  const free = Math.max(0, (slotArr.capacity||0) - (slotArr.reserved||0) - held);
  if (qty > free) return { statusCode:409, body:JSON.stringify({ ok:false, error:'no_capacity', free })};

  const exp = new Date(Date.now()+10*60*1000); // 10 min hold
  const { data: ins, error:e2 } = await supa.from('slot_holds').insert({
    event_id: eventId, slot_id: slotId, qty, email, expires_at: exp.toISOString()
  }).select().single();
  if (e2) return { statusCode:500, body:JSON.stringify({ ok:false, error:e2.message })};
  return { statusCode:200, body:JSON.stringify({ ok:true, holdId:ins.id, expiresAt:ins.expires_at })};
};
