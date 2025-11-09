// assets/supabase-client.js
// Tanki sloj nad src/services/supabase.js za popolno kompatibilnost
// (obstoječe strani še naprej dinamično uvažajo to datoteko)

export { 
  supabase, 
  testSignUpEmail, 
  testSignInEmail, 
  testSignInGoogle 
} from '/src/services/supabase.js';

// Varnostna mreža: poskrbimo, da so globali prisotni, če je nekdo neposredno uvozil to datoteko
import { supabase as _s, testSignUpEmail as _su, testSignInEmail as _se, testSignInGoogle as _sg } from '/src/services/supabase.js';
if (typeof window !== 'undefined') {
  try{
    window.supabase = window.supabase || _s;
    window.testSignUpEmail = window.testSignUpEmail || _su;
    window.testSignInEmail = window.testSignInEmail || _se;
    window.testSignInGoogle = window.testSignInGoogle || _sg;
  }catch{}
}
