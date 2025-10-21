exports.handler = async (event) => {
  const { eventId } = event.queryStringParameters||{};
  if (!eventId) return { statusCode:400, body:'missing eventId' };
  const { supa } = require('../../providers/supa');
  const { data, error } = await sBills(eventId);
  async function sBills(id){
    return await supa.from('service_slots').select('*').eq('event_id', id).order('start_ts');
  }
  if (error) return { statusCode:500, body:JSON.stringify({ok:false,error:error.message})};
  return { statusCode:200, body:JSON.stringify({ok:true, results:data})};
};
