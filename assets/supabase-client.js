// assets/supabase-client.js
// Minimal, valid module that creates a Supabase client from global / env keys
import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm";

// Project defaults (fallback if not provided on page/env)
const DEFAULT_URL = "https://wqdfteajjcrzcniotvhh.supabase.co";
const DEFAULT_ANON = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6IndxZGZ0ZWFqamNyemNuaW90dmhoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTYzNTU3MDMsImV4cCI6MjA3MTkzMTcwM30.0EFgeCpHcsSxsYQ2wZIQerLKXcAlvJjVNuQ0nJB2VFc";

let SUPABASE_URL = (typeof window !== 'undefined')
  ? (window.SUPABASE_URL || localStorage.getItem('SUPABASE_URL'))
  : process.env.SUPABASE_URL;

let SUPABASE_ANON_KEY = (typeof window !== 'undefined')
  ? (window.SUPABASE_ANON_KEY || localStorage.getItem('SUPABASE_ANON_KEY'))
  : process.env.SUPABASE_ANON_KEY;

// Netlify sometimes injects into window.__env or process.env
if (typeof window !== 'undefined' && window.__env) {
  if (!SUPABASE_URL) SUPABASE_URL = window.__env.SUPABASE_URL;
  if (!SUPABASE_ANON_KEY) SUPABASE_ANON_KEY = window.__env.SUPABASE_ANON_KEY;
}

// Fallback to hardcoded project defaults when still missing
if (!SUPABASE_URL) SUPABASE_URL = DEFAULT_URL;
if (!SUPABASE_ANON_KEY) SUPABASE_ANON_KEY = DEFAULT_ANON;

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  setTimeout(() => {
    console.error('Supabase config error:', { SUPABASE_URL, SUPABASE_ANON_KEY });
    const el = typeof document !== 'undefined' && document.getElementById && document.getElementById('loginResult');
    if (el) el.textContent = 'Napaka: Supabase URL ali anon ključ NI nastavljen!';
  }, 500);
}

export async function testSignUpEmail(email, password, options = null) {
  try {
    const payload = { email, password };
    if (options && typeof options === 'object') {
      if (options.options) {
        payload.options = options.options;
      } else {
        payload.options = options;
      }
    }
    const { data, error } = await supabase.auth.signUp(payload);
    return { data, error };
  } catch (e) {
    return { error: e };
  }
}

export async function testSignInEmail(email, password) {
  try {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    return { data, error };
  } catch (e) {
    return { error: e };
  }
}

export async function testSignInGoogle() {
  try {
    const { data, error } = await supabase.auth.signInWithOAuth({ provider: 'google' });
    return { data, error };
  } catch (e) {
    return { error: e };
  }
}

if (typeof window !== 'undefined') {
  window.supabase = supabase;
  window.testSignUpEmail = testSignUpEmail;
  window.testSignInEmail = testSignInEmail;
  window.testSignInGoogle = testSignInGoogle;
}
