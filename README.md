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
 - Ciljno filtriranje: z okoljsko spremenljivko `EARLY_NOTIFY_MIN_POINTS` lahko dodatno omejiš prejemnike na uporabnike, ki imajo vsaj X točk (pogled v tabeli `user_points`). Če ni nastavljena ali je 0, se ne uporablja.
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

## Calendar & Reservations

Internal NearGo calendar supports provider-defined slots and user reservations.

### Database

Tables (see `sql/migrate_provider_calendar.sql`):
- `provider_calendars` – provider calendar metadata
- `provider_slots` – timeslots per calendar
- `provider_reservations` – reservations per slot
- `view_calendar_upcoming_free` – helper view of future free slots

Security/analytics additions (see `sql/migrate_calendar_security.sql`):
- `provider_calendars.token_expires_at` – optional expiry for edit token
- `provider_reservation_events` – analytics stream (created/cancelled)
- Index for rate limiting: `provider_reservations_email_time_idx`

### Endpoints

- `/.netlify/functions/calendar-slots` – GET list slots (public free by default; with `token` returns full), POST add slots (provider), PATCH update slot (provider), DELETE remove slot (provider). Use `calendar_id` and optionally `token`. `mode=reservations` lists reservations (provider).
- `/.netlify/functions/calendar-reserve` – POST reserve a free slot (`slot_id`, `email`, optional `event_id`, `event_title`, `display_benefit`). Premium users receive a free coupon automatically.
- `/.netlify/functions/calendar-cancel` – POST cancel a reservation (`reservation_id` or `slot_id`) by `email` or provider `token`.

### Protections

- Overlap prevention: server skips conflicting new slots and rejects conflicting PATCH updates.
- Rate limiting: users limited to 3 active reservations per 24h (simple count query).
- Token expiry: if `token_expires_at` is past, provider actions are rejected.
- Atomic reservation: slot marked reserved only if status was `free`.

### Emails

- Reservation confirmation email (QR coupon auto-added for Premium).
- Cancellation email.
- Purchase emails enriched with event link, venue & time (see `index.html` buy buttons metadata and `netlify/functions/stripe-webhook.js`).

### SQL

Run in order:
1) `sql/migrate_provider_calendar.sql`
2) `sql/migrate_calendar_security.sql`

### Front-end

- Card shows “Rezerviraj termin” if `calendar_id` present (see `index.html`).
- Inline slot loader + reserve buttons (first 12 future free slots).
- Requires stored user email (`localStorage.user_email`).

### Notes

- Premium reservation flow auto-issues free coupon (ticket row) tied to the slot.
- Non-Premium users see CTA to buy a coupon (form posts payload to checkout).
- One-off Premium purchase now grants +1 month (subscription renewals handled in webhook invoice logic).

## Rewards system (points)
## Paketi ponudnika (Provider plans)

Skupne zmogljivosti in omejitve paketov so definirane v `assets/provider-plan.js` (global `window.NG_PLAN_FEATURES`). Strežnik potrjuje plan prek tabele `provider_plans` (glej `stripe-webhook.js` upsert) in ga uporablja v `netlify/functions/provider-submit.js` za uveljavitev pravil.

| Paket | Izpostavitve / mesec | NearGo koledar | QR skener | Analitika | Dostopi za ekipo |
|-------|----------------------|----------------|-----------|-----------|------------------|
| Free  | 0                    | Ne             | Ne        | Osnovna   | Ne               |
| Grow  | 1 (7 dni vsaka)      | Ne             | Da        | Real‑time | Ne               |
| Pro   | 3 (7 dni vsaka)      | Da             | Da        | Napredna  | Da               |

Server-side uveljavitev:
- Izpostavitve: `provider-submit.js` šteje mesečno uporabo (JSON oddaje v Storage); Free blokira (`featured_requires_plan`), Grow/Pro imata limite (`featured_limit_exceeded`). Na uspeh doda `featuredUntil` (+7 dni) in vrne `limits.featuredPerMonth`.
- NearGo koledar: notranji koledar (`provider_calendars`) se ustvari le za Pro (`calendar_requires_pro` pri kršitvi).

Endpoint za pregled porabe:
- `/.netlify/functions/provider-featured-usage?email=<organizerEmail>` → `{ ok, plan, used, allowed, month }` (trenuten mesec, UTC).
	- Uporaba: obrazec `organizers-submit.html` prikaže "Izpostavitve ta mesec: used/allowed" in onemogoči kljukico, če je doseženo.

Client-side opozorila (`organizers-submit.html`):
- Dinamičen tekst na podlagi `NG_PLAN_FEATURES` (število izpostavitev).
- Klik na izpostavitev pri Free sproži redirect na pakete (shranjen osnutek obrazca).
- Poskus izbire NearGo koledarja na Grow/Free sproži confirm dialog in redirect.

Email potrditve (`provider-submit.js`):
- Prilagodi besedilo glede na tip (dogodek / storitev).
- Vključi datum do katerega je izpostavljeno (`Izpostavljeno do:`) če je bilo označeno.

Širitev / naslednje ideje:
- Dodaj števec porabe izpostavitev v `/api/my` (trenutno klient sklepa po odzivih pri oddaji).
- Premik štetja izpostavitev v namensko tabelo (hitrejše kot branje vseh JSON) + indeks po mesecu.
- Dodaj "preostale izpostavitve" badge na obrazcu.

Hitri dostop do plana:
## Premium cikel – prikaz

Stran `account/notifications.html` prikazuje Premium cikel kot datumovni razpon (start–end). Trenutno se start oceni kot 1 mesec pred `premium_until` (če ni eksplicitnega `premium_start`). Ko bo na voljo natančen `premium_start`, posodobi `updatePremiumCycle()` v `notifications.js`.

```js
const plan = window.NG_PLAN_FEATURES[currentPlan];
if (plan.featuredPerMonth > 0) { /* pokaži izpostavitveni UI */ }
```

## In‑App Purchase (IAP) – preverjanje (TEST način)

Endpoint: `POST /api/iap-verify` → `netlify/functions/iap-verify.js`

Stanje: skeleton za testiranje; v produkciji vrne 501 dokler ne dodaš prave verifikacije.

Okoljske spremenljivke:
- `IAP_VERIFY_TEST` = `1` omogoči sprejem katerekoli ne-prazne vrednosti `receipt` / `token` in dodeli +1 mesec Premium.
- (Produkcija) `APPLE_SHARED_SECRET`, `GOOGLE_SERVICE_ACCOUNT_JSON` (JSON vsebina service accounta) – še ne uporabljeno v skeletonu.

Request (TEST):
```json
{
	"platform": "apple",
	"email": "user@example.com",
	"receipt": "sandbox-receipt",
	"expires_at": "2025-12-11T00:00:00Z" // neobvezno, če želiš simulirati datum
}
```

Odziv (TEST):
```json
{
	"ok": true,
	"premium_until": "2025-12-11T00:00:00.000Z",
	"test": true
}
```

Logika skeletona:
- Če `premium_until` že v prihodnosti → podaljša za +1 mesec (stacking).
- Vstavi vrstico v `iap_receipts` (transaction_id = `TEST-<timestamp>`).
- Ni prave validacije kvitance (receipt/token) – namenjeno samo mobilnemu MVP testu.

SQL migracija:
- Za IAP tabelo zaženi `sql/migrate_iap.sql` (ustvari `iap_receipts` + indekse).

Produkcijski koraki (po aktivaciji native app):
1. Apple: pošlji `receipt-data` na Apple endpoint (production/sandbox), preveri `status===0`, vzemi najnovejši `expires_date_ms`.
2. Google: uporabi AndroidPublisher API (`purchases.subscriptions` ali `purchases.products`) z `purchaseToken`, validiraj stanje in `expiryTimeMillis`.
3. Normaliziraj v UTC ISO, zapiši v `iap_receipts.raw` celoten odziv, nastavi `premium_until` iz verodostojnega vira.
4. Obnovitve (renewals) obravnavaj v istem endpointu ali ločeni cron verificiranju (pre-check pred iztekom).
5. Dodaj zaščito proti ponovni uporabi istega `original_transaction_id` / `purchaseToken` (unikaten indeks + zavrnitev).

Varnostni predlogi:
- Ne zanašaj se na client-side `expires_at` (sprejmi jo le v TEST načinu).
- Rate limit: max X zahtevkov / minuto / email (Netlify function wrapper ali dodatne check tabele).
- Audit: vedno hrani surov JSON v `iap_receipts.raw` za kasnejše dispute analize.


We added a lightweight but safe rewards system to drive engagement and referrals.

### Database

Run `sql/add_points.sql` to create core tables and RPCs, then `sql/migrate_rewards_referrals.sql` to add `referral_codes`:

- `event_views` – track unique views for engagement rewards
- `rewards_ledger` – append-only audit of all point activity
- `wallets` – current user balances keyed by `user_id`
- `user_points` – legacy email-keyed balance (kept in sync when possible)
- `referrals`, `referral_codes` – referral program
- RPCs: `add_points(p_user_id,p_points,p_reason,p_metadata json)`, `redeem_points(p_user_id,p_points,p_reward_code text)`, `convert_points(p_user_id,p_points,p_rate numeric)`, `query_event_views_7d()`

### Endpoints

- `/.netlify/functions/rewards-history?email=` – recent ledger for the user
- `/.netlify/functions/rewards-redeem` – generic redeem (legacy) or RPC-backed when user ID is known
- `/.netlify/functions/rewards-convert` – convert points to € (simple rate), RPC-backed
- `/.netlify/functions/rewards-auto-grant` – grant points for various actions with cooldowns/monthly caps
- `/.netlify/functions/rewards-referral-link?email=` – returns or creates a referral code and share link
- `/.netlify/functions/rewards-referral-register` – claim a referral code on signup
- `/.netlify/functions/rewards-premium-redeem` – spend 500 points to grant +1 month of Premium (atomic)

`/api/my` now includes:

```json
{
	"premium": true,
	"premium_until": "...",
	"provider_plan": { "plan":"grow", "interval":"monthly", "active_until":"..." },
	"points_balance": 1234
}
```

### Safeguards and anti-abuse

- Monthly cap: default 300 points per user (see `rewards-auto-grant.js`)
- Per-action cooldowns and daily limits (e.g., share: 1x/day; favorite/want: 1x per item per 7 days)
- Duplicate prevention: important flows use metadata keys (e.g., `invoice_id`, `session_id`, `item_id`)
- Referral: first-time registration and first premium purchase bonuses only once per referred user
 - Revenue-based rewards are UNCAPPED: all `revenue_*` reasons (Stripe nakupi/računi) uporabljajo razmerje 500 točk = 5 € (100 točk/€) preko RPC `award_revenue_points(..., p_rate:=1)`.

### Redeeming Premium with points

- Call `/.netlify/functions/rewards-premium-redeem` with `{ email }` to spend 500 points and extend Premium by 1 month.
- Implementation uses `redeem_points` RPC for atomic deduction, then extends `premium_users.premium_until` (from current future value or now).
- On success returns `{ ok:true, granted_until, spent:500, remaining }`.
 - Reaching 500 points triggers one-time email (cron `rewards-threshold-check`).

### Stripe webhook integration

- Purchase emails include event URL/venue/time when available.
- Premium renewal invoices generate a PDF and award monthly renewal points (30), duplicate-protected by `invoice_id`.
- First-time premium purchase by a referred user awards referrer a bonus (100), duplicate-protected.

### Minimal setup

1) Run `sql/add_points.sql` in Supabase, then `sql/migrate_rewards_referrals.sql`.
2) Configure env vars: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, Stripe keys (optional), SMTP/Brevo (optional).
3) Deploy to Netlify; endpoints listed above will be available under `/.netlify/functions/*`.
