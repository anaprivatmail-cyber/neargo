# NearGo - Reorganizirana Struktura Projekta

## Nova organizacija datotek

### `/src/` - Glavna mapa za izvorno kodo
- **`/components/`** - UI komponente (dropdown meniji, gumbovi, modali)
- **`/utils/`** - Pomožne funkcije in orodja
- **`/services/`** - Storitve (Supabase, API klici, autentifikacija)
- **`/account/`** - Funkcionalnost za upravljanje računa
- **`/pages/`** - Specifična logika za strani
- **`/styles/`** - CSS datoteke

### `/server/` - Strežniška koda
- **`/functions/`** - Netlify funkcije
- **`/utils/`** - Deljene pomožne funkcije za strežnik

### `/config/` - Nastavitve in konfiguracije
- Konfiguracije, konstante, kategorije

### `/public/` - Javne datoteke
- **`/assets/`** - Slike, ikone, statične datoteke
- HTML datoteke ostanejo v root mapi

## Prednosti nove strukture

1. **Jasna ločitev** - Frontend, backend in konfiguracije so ločeni
2. **Modularna arhitektura** - Vsaka komponenta ima svojo mapo
3. **Skalabilnost** - Enostavno dodajanje novih funkcionalnosti
4. **Vzdrževanje** - Lažje iskanje in urejanje kode
5. **Testiranje** - Bolj organizirana struktura za teste

## Načrt reorganizacije

1. ✅ Ustvarjene nove mape
2. 🔄 Reorganizacija JavaScript datotek iz `/assets/`
3. ⏳ Povezovanje account funkcionalnosti
4. ⏳ Optimizacija Netlify funkcij
5. ⏳ Posodobitev povezav in importov

## Opombe

- Originalne datoteke ostanejo do dokončanja reorganizacije
- Nove datoteke bodo imele jasne module exports/imports
- Postopna migracija za zagotavljanje stabilnosti