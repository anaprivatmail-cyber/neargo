-- Create table for early-notify user preferences (if not exists)
-- Stores up to two subcategories, user location, and radius (km)

create table if not exists public.notification_prefs (
  email text primary key,
  categories text[] not null default '{}',
  location text,
  radius double precision not null default 30,
  lat double precision,
  lon double precision,
  phone text,
  updated_at timestamptz not null default now()
);

-- Helpful indexes
create unique index if not exists notification_prefs_email_key on public.notification_prefs(email);
create index if not exists notification_prefs_updated_idx on public.notification_prefs(updated_at desc);
create index if not exists notification_prefs_categories_idx on public.notification_prefs using gin(categories);

-- Ensure phone column exists if table was created previously without it
alter table if exists public.notification_prefs
  add column if not exists phone text;

-- Clamp bad radius values server-side as a safety (optional trigger)
-- Note: keep simple – you can remove if you prefer application-level validation only.
create or replace function public.notification_prefs_radius_guard()
returns trigger language plpgsql as $$
begin
  if new.radius is null then new.radius := 30; end if;
  if new.radius < 3 then new.radius := 3; end if;
  if new.radius > 50 then new.radius := 50; end if;
  return new;
end; $$;

drop trigger if exists notification_prefs_radius_guard_trg on public.notification_prefs;
create trigger notification_prefs_radius_guard_trg
before insert or update on public.notification_prefs
for each row execute function public.notification_prefs_radius_guard();

-- (Optional) If PostGIS is enabled, add a geography column and index for fast geo queries
-- Note: uncomment when extension is present: create extension if not exists postgis;
-- alter table public.notification_prefs
--   add column if not exists geom geography(Point,4326);
-- update public.notification_prefs set geom = ST_SetSRID(ST_MakePoint(lon, lat),4326)
--   where lat is not null and lon is not null;
-- create index if not exists notification_prefs_geom_gix on public.notification_prefs using gist(geom);
