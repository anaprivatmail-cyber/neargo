exports.handler = async (event, ctx) => {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'POST only' };
  const { eventId, slots=[] } = JSON.parse(event.body||'{}');
  if (!eventId) return { statusCode: 400, body: 'Missing eventId' };

  const { supa } = require('../../providers/supa'); // tvoje helperje
  const { data, error } = await supa.rpc('save_service_slots', { p_event_id: eventId, p_slots: slots });
  if (error) return { statusCode: 500, body: JSON.stringify({ ok:false, error:String(error.message||error) })};
  return { statusCode: 200, body: JSON.stringify({ ok:true })};
};
