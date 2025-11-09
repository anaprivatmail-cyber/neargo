## Deploy & vedno zadnja verzija (autoupdate)

Ta projekt zagotavlja, da uporabniki (mobilni / desktop) vedno dobijo zadnjo verzijo brez ročnega "hard reload".

Mehanizmi:
1. Service Worker (`sw.js`)
	- `skipWaiting()` + `clients.claim()` → nova verzija prevzame kontrolo takoj.
	- Broadcast `{ type: 'SW_VERSION', version }` vsem odprtim zavihkom ob aktivaciji.
2. Klient helper (`/assets/sw-reload.js`)
	- Registrira SW na vseh straneh (kjer je uvožen) in posluša `controllerchange` + SW_VERSION.
	- Enkrat samodejno osveži stran, ko nova verzija prevzame nadzor (prepreči race conditions).
3. Asset verzioniranje
	- Skripta `scripts/version-assets.mjs` pregleda vse `.html` in referencam na `/assets/*.js|css` doda `?v=<sha1>` hash vsebine.
	- Sprememba datoteke → drugačen hash → brskalnik naloži svež resource.
4. Cache politika (Netlify)
	- `/assets/*` → `Cache-Control: public, max-age=31536000, immutable` (varna zaradi hash parametra).
	- `/*.html` → kratko cache (no-cache/_must-revalidate_) – HTML se hitro revalidira in potegne nove hash-e.

Workflow deploya (Netlify CI):
```
git add .
git commit -m "feat: ..."
git push origin main  # Netlify auto build
```
Build skripta (`npm run build`) zamenja hash parametre. Ko je `sw.js` posodobljen (VERSION), se po aktivaciji vsi odprti klienti osvežijo.

Ročni test po deployu:
1. Odpri stran na telefonu.
2. Opazuj enkratni samodejni reload (če je bila nova verzija) ali ročno zapri/odpri tab.
3. Preveri v DevTools (Application → Service Workers), da `sw.js` kaže zadnji `version:` komentar.

Če želiš potrditi prisilni update:
```
// Konzola
navigator.serviceWorker.getRegistrations().then(rs => rs.forEach(r => r.update()))
```
Stran se bo (če je nova verzija) v nekaj sekundah osvežila.

Naslednji možni upgrade (ni nujno): prehod iz query param hash-a (`?v=`) na fingerprintirana imena datotek (npr. `app.abc123.js`) + HTML replace. Trenutna rešitev je dovolj stabilna.

---

## Zgodnji dostop (Early access) – robusten tok

Za zanesljiv in skalabilen prikaz predčasnih ponudb (15 min pred `publish_at`) smo uvedli kombinacijo front-end oznake in strežniškega filtriranja:

1) Front-end
	- `index.html` filtrira zalogo (stock) in označi zgodnje ponudbe z značko 🔔 Zgodnji dostop (polje `e._earlyPreview`).
	- Če je uporabnik Premium in ima nastavljene podkategorije, se predener prikaz dopolni s strogo strežniško listo prek `/api/offers-early`.

2) Strežnik
	- `netlify/functions/provider-list.js` od straniščnega seznama odstrani razprodane (`stock <= 0`).
	- Opcijsko skrije še neobjavljene kupone: nastavi `PROVIDER_HIDE_PREPUB_COUPONS=1` v Netlify env (takrat so pre-publish kuponi nedostopni prek javnega seznama).
	- `netlify/functions/offers-early.js` je strogo zavarovan early endpoint: zahteva `email`, preveri Premium (tabela `premium_users` ali `tickets` tipa `premium`), prebere `notification_prefs`, filtrira po podkategorijah, radiju (≤50 km) in časovnem oknu (`publish_at - EARLY_NOTIFY_MINUTES <= now < publish_at`).

3) Konfiguracija
	- `EARLY_NOTIFY_MINUTES` (cron in early endpoint, privzeto 15).
	- `PROVIDER_HIDE_PREPUB_COUPONS` (opcijsko; skrije pre-publish kupon na javnih seznamih).

4) Testni scenariji
	- Ustvari kupon z `publish_at` čez ~10 min v ujemajoči se podkategoriji.
	- Premium uporabnik: vidi kartico z 🔔 in lahko odpre; non-premium ne dobi early ponudb.
	- Po `publish_at` značka izgine in kartica je javno vidna.
	- `stock` → 0: kartica izgine na klientu in jo server ne vrača več preko `provider-list`.

# neargo

Important setup steps for rewards & Supabase

	- Run the SQL in `sql/add_points.sql` in your Supabase project (SQL editor or psql). This creates `event_views`, `rewards_ledger`, `wallets`, RPCs (`add_points`, `redeem_points`, `convert_points`, `query_event_views_7d`) and other helper tables.
	
	- Make sure the `pgcrypto` extension is available in your DB. The SQL file attempts to create it.
	
	- Set Netlify environment variables:
		- `SUPABASE_URL` (your Supabase API URL)
		- `SUPABASE_ANON_KEY` (public anon key for frontend)
		- `SUPABASE_SERVICE_ROLE_KEY` (service role key for Netlify functions — keep secret)
		- SMTP credentials if you want monthly summary emails
	
	- After pushing to GitHub, Netlify will build and deploy. The frontend now:
		- Initializes a realtime rewards listener when a user is logged in (shows popup on new ledger rows)
		- Calls `/.netlify/functions/record-view` after a user stays >=5s on a details page (deduped by localStorage)
	
	Notes & recommendations
	
	- I could not run the SQL on your Supabase from here — please run `sql/add_points.sql` yourself. Sample psql command:
	
	```bash
	psql "host=<DB_HOST> port=5432 dbname=<DB_NAME> user=<DB_USER> password=<DB_PASS>" -f sql/add_points.sql
	```
	
	- Netlify functions `netlify/functions/*.js` already included handle rewards history, redeem, convert and cron aggregation. For production safety, prefer using the Postgres RPCs for atomic debit/credit — the SQL file provides `redeem_points` and `convert_points` which Netlify functions can call via `supabase.rpc(...)` once you wire user IDs.
	
## Auth codes – Diagnostics and testing

When email/SMS code delivery is flaky during setup, you can diagnose and keep registration unblocked:

- Set in Netlify environment: `ALLOW_TEST_CODES=true` (only for staging/preview). With this flag, `/.netlify/functions/send-code` returns `{ ok:true, codeSent:true, code:"123456" }` on success or transient errors, so you can still proceed.
- Diagnostics functions (invoke via GET/POST):
  - `/.netlify/functions/smtp-diagnose` – tries 465 and 587 and reports which works.
  - `/.netlify/functions/twilio-diagnose` – send a test SMS to `{ to: "+386..." }` and report SID.
  - `/.netlify/functions/supabase-diagnose` – checks if `verif_codes` table is reachable with the service key.

Frontend behavior

- The auth modal tolerates short outages when verifying codes: if the network fails but the code looks valid (or matches returned `code` in dev), it proceeds and finishes registration.
- After successful login/registration, it closes the modal and continues the intended action (e.g. publish panel), avoiding page reloads.

Production reminder: turn `ALLOW_TEST_CODES` off (`false`) in production once providers are fully configured.

## Predhodna obvestila (Premium) – nastavitve

Stran `account/notifications.html` omogoča Premium uporabnikom nastavitev predhodnih obvestil (prejeti ~5 minut pred ostalimi):

- Hierarhija: tip (Dogodki / Storitve) → glavna kategorija → podkategorije.
- Uporabnik lahko aktivno izbere do 2 podkategoriji skupaj (kombinacija obeh tipov je dovoljena).
- Omejitev menjav: največ 5 menjav izbranih podkategorij na mesec (shrani se v `localStorage` ključ `ng_notify_quota`).
- Lokacijski filter: interaktivni Leaflet zemljevid z markerjem in krogom (polmer 3–50 km) + ročni vnos kraja.
- Shranjevanje: `/.netlify/functions/notifications-prefs-upsert` (polja: `email`, `categories[]`, `location`, `radius`).
- Branje: `/.netlify/functions/notifications-prefs-get`.
- Premium gating: če `window.IS_PREMIUM` ni resničen (ali `/api/my` vrne `premium: false`), je obrazec onemogočen in prikaže se CTA za nadgradnjo.

Frontend ključni `localStorage` ključi:
```
ng_notify_quota { month:"YYYY-MM", changes:<številka> }
ng_early_notify_categories { categories:[], location:"", radius: <km> }
```

Če bo backend podpiral granularno validacijo sprememb, lahko mesečno omejitev premaknemo na strežnik in ob upsertu zavrnemo 6.+ spremembo.

 Cron funkcija `early-notify.js` vsako minuto preveri okno točno 15 minut pred objavo (`publish_at`) in pošlje obvestila glede na `notification_prefs` (podkategorije + geo radij). Mesečna omejitev obvestil na uporabnika je zdaj 25 (env `EARLY_NOTIFY_CAP`, privzeto 25). Omejitev 5 se nanaša le na število sprememb kategorij/lokacije (UI quota v `localStorage`). Backend preveri tudi Premium status (tabela `premium_users` ali kupljena `premium` vstopnica) – če `EARLY_NOTIFY_REQUIRE_PREMIUM` ni `0`, prejmejo predčasna obvestila samo Premium uporabniki.

### SMS in natančno 15-min okno

- Nova kolona v `notification_prefs`: `phone` (text) za SMS. V UI (`account/notifications.html`) je dodano polje za telefonsko številko.
- `/.netlify/functions/early-notify` teče vsako minuto (cron v `netlify.toml`) in najde ponudbe, katerih `publish_at` je v oknu `[now+15min, now+16min)`.
- Ob oddaji ponudbe (`/.netlify/functions/provider-submit`) se zapiše minimalni `offers` zapis (če manjka) z `publish_at ≥ now+15min` in takoj se sproži `/.netlify/functions/early-notify-offer?id=<offerId>` za pošiljanje v oknu.
- Če SMS podatki okolja (Twilio) niso nastavljeni, sistem obvestilo zabeleži (log), da ne pade.

Env spremenljivke:

- `EARLY_NOTIFY_MINUTES` – minute pred objavo (privzeto `15`).
- `EARLY_NOTIFY_CAP` – max pošiljanj na uporabnika/mesec (privzeto `25`).
- `EARLY_NOTIFY_REQUIRE_PREMIUM` – če ni `0`, pošilja samo Premium uporabnikom (privzeto vklopljeno).
- `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM` – (opcijsko) SMS pošiljanje.

API bližnjice (redirecti):

- `/api/early-notify` → cron funkcija (1×/min).
- `/api/early-notify-offer?id=<offerId>` → poslanje za eno ponudbo.

## Geokodiranje ponudb (Offers geo)

Za iskanje po radiju in predhodna obvestila je dodana migracija `sql/migrate_offers_geo.sql`:

Vključeno:
- Stolpci: `publish_at`, `venue_address`, `venue_city`, `venue_country`, `venue_lat`, `venue_lon`, `venue_point` (PostGIS), `subcategory`.
- Indeksi: čas (publish_at), kategorija (subcategory), GIST za `venue_point`, opcijski GIN full‑text (name+description).
- Funkcije/triggerji: `offers_point_sync()` za sinhronizacijo lat/lon ↔ point, `offers_enqueue_geocode()` za dodaj v vrsto, `offers_subcategory_autofill()`.
- Tabele: `geocode_cache` (addr_norm → lat/lon/point), `geo_queue` (pending naslovi).
- Haversine funkcija `near_km(...)` za fallback brez PostGIS geometrije.

Delovni tok:
1. Uporabnik vnese naslov ali samo kraj (city). Če lat/lon manjkata → trigger doda vrstico v `geo_queue`.
2. Funkcija `geo-worker.js` (Netlify) periodično obdeluje `pending` vrstice:
	 - Najprej preveri cache → če zadetek, preskoči klic zunanje storitve.
	 - Kliče Nominatim (OSM) z User-Agent e‑pošto (nastavi `GEOCODE_EMAIL` env).
	 - Posodobi `offers.venue_lat/lon` → trigger napolni `venue_point`.
	 - Vstavi/posodobi `geocode_cache` in označi vrsto `done` ali `failed`.

Klic geo workerja ročno (primer):
```
curl -s https://<tvoja-domena>/.netlify/functions/geo-worker?limit=5
```
Suhi tek (dry‑run, ne piše v bazo):
```
curl -s https://<tvoja-domena>/.netlify/functions/geo-worker?limit=3&dry=1
```

Iskanje po radiju (PostGIS):
```
SELECT id, name
FROM public.offers
WHERE venue_point IS NOT NULL
	AND ST_DWithin(venue_point, ST_SetSRID(ST_MakePoint(:lon,:lat),4326)::geography, :km * 1000);
```
Fallback brez PostGIS geometrije (Haversine):
```
SELECT id, name
FROM public.offers
WHERE venue_lat IS NOT NULL AND venue_lon IS NOT NULL
	AND public.near_km(:lat,:lon, venue_lat, venue_lon) <= :km;
```

Okoljski ključi (Netlify):
- `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` (že uporabljeno).
- `GEOCODE_EMAIL` (priporočeno – kontakt e‑pošta za Nominatim).

Omejitve in etika:
- Ne kliči Nominatim prehitro (worker počaka ~900ms med zahtevki).
- Cache zmanjša število zunanjih klicev, normalizira naslov.
- Če kakovost geokodiranja ni dovolj, kasneje lahko zamenjaš API (npr. Google Geocoding) in samo zamenjaš funkcijo `resolveLatLon`.

````
