// netlify/functions/my.js
import { createClient } from "@supabase/supabase-js";
const supa = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

export const handler = async (event) => {
  const email = event.queryStringParameters?.email || null;
  if (!email) return json({ ok:false, error:"missing_email" },400);

  const { data, error } = await supa.from("tickets")
    .select("id, type, event_id, display_benefit, issued_at, status, token")
    .eq("customer_email", email)
    .order("issued_at",{ ascending:false });

  if (error) return json({ ok:false, error:error.message },500);
  return json({ ok:true, items:data||[] });
};
function json(obj,status=200){return{statusCode:status,headers:{"content-type":"application/json"},body:JSON.stringify(obj)};}
