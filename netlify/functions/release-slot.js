exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return { statusCode:405, body:'POST only' };
  const { holdId } = JSON.parse(event.body||'{}');
  if (!holdId) return { statusCode:400, body:'missing holdId' };
  const { supa } = require('../../providers/supa');
  const { error } = await supa.from('slot_holds').update({ status:'released' })
                             .eq('id', holdId).eq('status','held');
  if (error) return { statusCode:500, body:JSON.stringify({ ok:false, error:error.message })};
  return { statusCode:200, body:JSON.stringify({ ok:true })};
};
