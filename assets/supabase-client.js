// Testna funkcija za registracijo z emailom
export async function testSignUpEmail(email, password) {
	console.log('Poskus registracije z email:', email);
	let result = {};
	try {
		const { data, error } = await supabase.auth.signUp({ email, password });
		result = { data, error };
		if (error) {
			console.error('Napaka pri registraciji:', error.message, error);
			result.diagnostic = {
				message: error.message,
				status: error.status,
				details: error,
				supabaseUrl: supabase?.url,
				anonKey: !!supabase?.key,
			};
		} else {
			console.log('Registracija uspešna:', data);
			result.diagnostic = {
				message: 'Registracija uspešna',
				emailSent: !!data?.user,
				supabaseUrl: supabase?.url,
				anonKey: !!supabase?.key,
			};
		}
	} catch (e) {
		console.error('Exception pri registraciji:', e);
		result = { error: e, diagnostic: { message: e.message, details: e } };
	}
	return result;
}
// assets/supabase-client.js
// Browser/PWA: statični import iz CDN
// Native/bundler: dynamic import iz npm
let createClient;
// Browser/PWA: import iz CDN
import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm";

// Če boš uporabljal native/bundler (Node.js, React Native, ...), zamenjaj zgornji import z:
// const { createClient } = require('@supabase/supabase-js');

// Poskusi pridobiti iz window, localStorage ali iz Netlify globalnih spremenljivk
let SUPABASE_URL = typeof window !== 'undefined' ? (window.SUPABASE_URL || localStorage.getItem('SUPABASE_URL')) : process.env.SUPABASE_URL;
let SUPABASE_ANON_KEY = typeof window !== 'undefined' ? (window.SUPABASE_ANON_KEY || localStorage.getItem('SUPABASE_ANON_KEY')) : process.env.SUPABASE_ANON_KEY;
// Netlify včasih doda spremenljivke v globalni objekt __env ali process.env
if (window.__env) {
	SUPABASE_URL = SUPABASE_URL || window.__env.SUPABASE_URL;
	SUPABASE_ANON_KEY = SUPABASE_ANON_KEY || window.__env.SUPABASE_ANON_KEY;
}
if (typeof process !== 'undefined' && process.env) {
	SUPABASE_URL = SUPABASE_URL || process.env.SUPABASE_URL;
	SUPABASE_ANON_KEY = SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;
}
export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// Če ni nastavljenih ključev, izpiši napako v UI
if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
	setTimeout(() => {
		let el = document.getElementById('loginResult');
		if (el) {
			el.textContent = 'Napaka: Supabase URL ali anon ključ NI nastavljen! Preveri okolje v Netlify in vstavitev v JS.' +
				'\nSUPABASE_URL: ' + (SUPABASE_URL || '[NI]') +
				'\nSUPABASE_ANON_KEY: ' + (SUPABASE_ANON_KEY ? '[OK]' : '[NI]');
			el.style.color = '#d64c4c';
		}
		console.error('Supabase config error:', { SUPABASE_URL, SUPABASE_ANON_KEY });
	}, 500);
}

// Testna funkcija za vpis z emailom
export async function testSignInEmail(email, password) {
	console.log('Poskus vpisa z email:', email);
	let result = {};
	try {
		const { data, error } = await supabase.auth.signInWithPassword({ email, password });
		result = { data, error };
		if (error) {
			console.error('Napaka pri prijavi:', error.message, error);
			result.diagnostic = {
				message: error.message,
				status: error.status,
				details: error,
				supabaseUrl: supabase?.url,
				anonKey: !!supabase?.key,
			};
		} else {
			console.log('Prijava uspešna:', data);
			result.diagnostic = {
				message: 'Prijava uspešna',
				user: !!data?.user,
				supabaseUrl: supabase?.url,
				anonKey: !!supabase?.key,
			};
		}
	} catch (e) {
		console.error('Exception pri prijavi:', e);
		result = { error: e, diagnostic: { message: e.message, details: e } };
	}
	return result;
}

// Testna funkcija za vpis z Google
export async function testSignInGoogle() {
	console.log('Poskus vpisa z Google');
	const { data, error } = await supabase.auth.signInWithOAuth({ provider: 'google' });
	console.log('Rezultat Google signIn:', { data, error });
	return { data, error };
}
