// assets/supabase-client.js
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = window.SUPABASE_URL || localStorage.getItem('SUPABASE_URL');
const SUPABASE_ANON_KEY = window.SUPABASE_ANON_KEY || localStorage.getItem('SUPABASE_ANON_KEY');
export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// Testna funkcija za vpis z emailom
export async function testSignInEmail(email, password) {
	console.log('Poskus vpisa z email:', email);
	const { data, error } = await supabase.auth.signInWithPassword({ email, password });
	console.log('Rezultat email signIn:', { data, error });
	return { data, error };
}

// Testna funkcija za vpis z Google
export async function testSignInGoogle() {
	console.log('Poskus vpisa z Google');
	const { data, error } = await supabase.auth.signInWithOAuth({ provider: 'google' });
	console.log('Rezultat Google signIn:', { data, error });
	return { data, error };
}
