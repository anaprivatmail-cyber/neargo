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
````
