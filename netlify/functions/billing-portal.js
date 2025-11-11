// netlify/functions/billing-portal.js
// Returns a Stripe Customer Portal session URL for logged-in email.
// Requires STRIPE_SECRET_KEY and a valid Billing Portal configuration in Stripe.

import Stripe from 'stripe';
import { getStore } from '@netlify/blobs';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2024-06-20' });

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type'
};

export const handler = async (event) => {
  try {
    if (event.httpMethod === 'OPTIONS') return { statusCode:204, headers: CORS, body:'' };
    if (event.httpMethod !== 'POST') return { statusCode:405, headers:CORS, body:'Method Not Allowed' };
    const body = JSON.parse(event.body||'{}');
    const email = (body.email||'').trim().toLowerCase();
    if(!email) return { statusCode:400, headers:CORS, body: JSON.stringify({ ok:false, error:'missing_email' }) };

    const store = await getStore('stripe-customers');
    const custId = await store.get(`email:${email}`);
    if(!custId){
      return { statusCode:404, headers:CORS, body: JSON.stringify({ ok:false, error:'customer_not_found' }) };
    }

    const returnUrl = (process.env.PUBLIC_BASE_URL || process.env.URL || '').replace(/\/$/,'') + '/account/account.html#subscription';
    const session = await stripe.billingPortal.sessions.create({
      customer: custId,
      return_url: returnUrl
    });
    return { statusCode:200, headers:CORS, body: JSON.stringify({ ok:true, url: session.url }) };
  } catch(e){
    console.error('[billing-portal] error', e?.message||e);
    return { statusCode:500, headers:CORS, body: JSON.stringify({ ok:false, error:'server_error' }) };
  }
};
