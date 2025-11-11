-- sql/master_migration.sql
-- Namen: zaporedni zagon ključnih migracij iz psql (lokalno ali CI).
-- OPOMBA: Meta-ukazi \i delujejo samo v psql odjemalcu, NE v Supabase spletni SQL editorju.
-- Uporaba (PowerShell):
--   psql "host=<HOST> port=5432 dbname=<DB> user=<USER> password=<PASS>" -f sql/master_migration.sql
-- Datoteke naj bodo v isti mapi (sql/), da relativne poti delujejo.

-- Premium tabela / logika (zaženite najprej, če še ni)
\i migrate_premium.sql

-- In-app nakupi (IAP receipts) – shrani preverjene Apple/Google račune
\i migrate_iap.sql

-- DODAJ (po potrebi) ostale migracije v želenem vrstnem redu:
-- \i migrate_provider_plans.sql
-- \i migrate_provider_calendar.sql
-- \i migrate_calendar_security.sql
-- \i migrate_rewards_referrals.sql
-- \i migrate_offers_geo.sql
-- \i add_points.sql

-- Če katera datoteka manjka ali je že bila izvedena, psql nadaljuje (\i ne prekine ob CREATE IF NOT EXISTS)
-- Za ponovno izvajanje je priporočljivo imeti CREATE IF NOT EXISTS in idempotentne skripte.
