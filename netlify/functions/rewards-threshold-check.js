// netlify/functions/rewards-threshold-check.js
// Cron or manual trigger: scan wallets for users >=500 points who haven't received threshold email yet.
import { createClient } from '@supabase/supabase-js';
import * as Brevo from '@getbrevo/brevo';
import nodemailer from 'nodemailer';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supa = createClient(SUPABASE_URL, SERVICE_KEY, { auth:{ persistSession:false } });

const BREVO_API_KEY = process.env.BREVO_API_KEY || '';
const EMAIL_FROM = process.env.EMAIL_FROM || 'NearGo <info@getneargo.com>';
const SUPPORT_EMAIL = process.env.SUPPORT_EMAIL || 'info@getneargo.com';
const PUBLIC_BASE_URL = (process.env.PUBLIC_BASE_URL || process.env.SITE_URL || 'https://getneargo.com').replace(/\/$/,'');

const CORS={ 'Access-Control-Allow-Origin':'*','Access-Control-Allow-Methods':'GET,OPTIONS','Access-Control-Allow-Headers':'content-type' };
const ok = b=>({ statusCode:200, headers:{ 'content-type':'application/json', ...CORS }, body: JSON.stringify(b) });
const bad=(m,s=400)=>({ statusCode:s, headers:{ 'content-type':'application/json', ...CORS }, body: JSON.stringify({ ok:false, error:m }) });

const THRESHOLD = 500;

let brevoApi=null;
if(BREVO_API_KEY){ brevoApi = new Brevo.TransactionalEmailsApi(); brevoApi.setApiKey(Brevo.TransactionalEmailsApiApiKeys.apiKey, BREVO_API_KEY); }

export const handler = async (event) => {
  try{
    if(event.httpMethod==='OPTIONS') return { statusCode:204, headers:CORS, body:'' };
    if(event.httpMethod!=='GET') return bad('use_get',405);

    // Fetch wallet balances >= threshold
    const { data: wallets, error } = await supa.from('wallets').select('user_id,balance').gte('balance', THRESHOLD);
    if(error) return bad('db_error:'+error.message,500);

    const results=[];
    for(const w of wallets||[]){
      const uid = w.user_id; const bal = Number(w.balance||0);
      if(!uid) continue;
      // Already sent?
      const { data: sentRow } = await supa.from('rewards_threshold_emails').select('sent_at').eq('user_id', uid).eq('threshold', THRESHOLD).maybeSingle();
      if(sentRow) continue; // skip
      // Resolve email
      let email=null; try{ const u = await supa.auth.admin.getUserById(uid); email = u?.data?.user?.email || null; }catch{}
      if(!email) continue;
      // Compose mail
      const html = `<div style=
        "font-family:Arial,Helvetica,sans-serif;background:#f6fbfe;padding:0;margin:0">
        <div style="max-width:680px;margin:0 auto;border:1px solid #e3eef7;border-radius:14px;overflow:hidden;background:#fff">
          <div style="padding:14px 18px;display:flex;align-items:center;gap:10px;border-bottom:1px solid #e3eef7;background:#fff">
            <div><svg width='36' height='36' viewBox='0 0 32 32'><circle cx='16' cy='16' r='13' fill='none' stroke='#0b1b2b' stroke-width='2'/><circle cx='16' cy='16' r='8' fill='none' stroke='#0b1b2b' stroke-width='2' opacity='0.9'/><circle cx='16' cy='16' r='3.2' fill='#0b1b2b'/></svg></div>
            <div style='font-weight:900;font-size:20px;letter-spacing:.2px;color:#0b1b2b'>NearGo</div>
          </div>
          <div style='padding:20px 22px;color:#0b1b2b'>
            <h2 style='margin:0 0 12px 0;font-size:20px'>Dosegel si 500 točk!</h2>
            <p style='margin:0 0 14px'>Zdaj lahko unovčiš 1 mesec Premium ali brezplačni kupon iz kataloga nagrad.</p>
            <p style='margin:0 0 10px'><a href='${PUBLIC_BASE_URL}/account/rewards.html' style='display:inline-block;background:#0bbbd6;color:#fff;font-weight:900;padding:10px 18px;border-radius:999px;text-decoration:none'>Odpri Nagrade</a></p>
            <p style='opacity:.7;font-size:13px'>Če imaš vprašanja: <a href='mailto:${SUPPORT_EMAIL}' style='color:#0bbbd6;font-weight:700'>${SUPPORT_EMAIL}</a></p>
          </div>
        </div>
      </div>`;
      try{
        if(brevoApi){
          const mail = new Brevo.SendSmtpEmail();
          mail.sender={ email: EMAIL_FROM.replace(/.*<([^>]+)>.*/,'$1')||'info@getneargo.com', name: EMAIL_FROM.replace(/\s*<[^>]+>\s*$/,'')||'NearGo' };
          mail.to=[{ email }];
          mail.subject='Dosežen prag nagrad – 500 točk';
          mail.htmlContent=html;
          await brevoApi.sendTransacEmail(mail);
        }else{
          const host=process.env.SMTP_HOST, port=Number(process.env.SMTP_PORT||0), user=process.env.SMTP_USER, pass=process.env.SMTP_PASS;
          if(host && port && user && pass){
            const transporter=nodemailer.createTransport({ host, port, secure: port===465, auth:{ user, pass } });
            await transporter.sendMail({ from: EMAIL_FROM, to: email, subject:'Dosežen prag nagrad – 500 točk', html });
          }
        }
        await supa.from('rewards_threshold_emails').insert({ user_id: uid, threshold: THRESHOLD });
        results.push({ user_id: uid, email, sent:true });
      }catch(err){ console.warn('[threshold-email] send failed', err?.message||err); results.push({ user_id: uid, email, sent:false, error: err?.message||String(err) }); }
    }
    return ok({ ok:true, processed: results.length, results });
  }catch(e){ return bad(e?.message||e,500); }
};
