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

## Try it — Testing authentication locally and on Netlify Preview

### Local testing

1. **Install dependencies:**
   ```bash
   npm install
   ```

2. **Set up environment variables:**
   Create a `.env` file in the root directory with your Supabase credentials:
   ```
   SUPABASE_URL=https://your-project.supabase.co
   SUPABASE_ANON_KEY=your-anon-key
   SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
   ```

3. **Start local development server:**
   ```bash
   npm start
   ```
   This runs `netlify dev` which starts a local server (typically at `http://localhost:8888`)

4. **Test the auth modal:**
   - Navigate to `http://localhost:8888/organizers.html`
   - Click "Objavi dogodek ali storitev" button
   - The auth modal should appear
   - Try logging in or registering:
     - **Demo mode** (no Supabase): Use `demo@neargo.com` / `demo123`
     - **With Supabase**: Use real credentials or create a new account
   - After successful auth, the modal should close and the publish form should appear

5. **Test registration with code verification:**
   - In the auth modal, click "Registracija" button
   - Fill in registration details
   - Click "Preveri s SMS kodo" or "Preveri z email kodo"
   - If the send-code function fails (network issues), you can still enter a code manually
   - The app will accept the code if it looks valid (4+ alphanumeric characters)

### Netlify Preview testing

1. **Push your branch to GitHub:**
   ```bash
   git push origin your-branch-name
   ```

2. **Open a Pull Request** on GitHub

3. **Wait for Netlify Deploy Preview:**
   - Netlify will automatically build and deploy a preview
   - Check the PR for the deploy preview URL (e.g., `https://deploy-preview-123--neargo.netlify.app`)

4. **Test on the preview:**
   - Navigate to `/organizers.html` on the preview URL
   - Test the same auth flows as local testing
   - Verify that code verification works (requires proper SMTP/Twilio env vars in Netlify)

### Key features to verify

- ✅ No "Pozabljeno geslo?" link appears in the auth modal
- ✅ "Še niste registrirani?" link remains visible
- ✅ After successful login/registration, modal closes and intended action continues (e.g., publish form opens)
- ✅ Registration continues even if code verification temporarily fails (resilient to network issues)
- ✅ No JavaScript errors in browser console
- ✅ Auth state persists (check localStorage for user data)
