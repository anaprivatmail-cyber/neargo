// providers/supabase-points.js
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

export async function getUserPoints(email) {
  const { data, error } = await supabase
    .from('user_points')
    .select('points')
    .eq('email', email)
    .single();
  if (error || !data) return 0;
  return data.points;
}

export async function addUserPoints(email, amount = 1) {
  // Najprej preveri, če uporabnik že obstaja
  const { data, error } = await supabase
    .from('user_points')
    .select('points')
    .eq('email', email)
    .single();
  if (error || !data) {
    // Če ne obstaja, ustvari novega
    const { error: insertErr } = await supabase
      .from('user_points')
      .insert({ email, points: amount, last_award: new Date().toISOString() });
    return insertErr ? false : true;
  } else {
    // Če obstaja, posodobi točke
    const newPoints = data.points + amount;
    const { error: updateErr } = await supabase
      .from('user_points')
      .update({ points: newPoints, last_award: new Date().toISOString() })
      .eq('email', email);
    return updateErr ? false : true;
  }
}

export async function redeemUserPoints(email, amount) {
  const { data, error } = await supabase
    .from('user_points')
    .select('points')
    .eq('email', email)
    .single();
  if (error || !data || data.points < amount) return false;
  const newPoints = data.points - amount;
  const { error: updateErr } = await supabase
    .from('user_points')
    .update({ points: newPoints })
    .eq('email', email);
  return updateErr ? false : true;
}
