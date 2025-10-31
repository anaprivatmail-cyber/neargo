import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm";

// Nastavi svoj Supabase URL in anon ključ:
const SUPABASE_URL = "https://wqdfteaijjcrzcniotvhh.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6IndxZGZ0ZWFqamNyemNuaW90dmhoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTYzNTU3MDMsImV4cCI6MjA3MTkzMTcwM30.0EFgeCpHcsSxsYQ2wZIQerLKXcAlvJjVNuQ0nJB2VFc";

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// Prijava z e-mailom
export async function signInWithEmail(email) {
	return await supabase.auth.signInWithOtp({ email });
}

// Prijava z Google
export async function signInWithGoogle() {
	return await supabase.auth.signInWithOAuth({ provider: 'google' });
}
