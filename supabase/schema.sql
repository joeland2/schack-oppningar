-- Chess Trainer usage events. Run once in Supabase: SQL Editor -> New query -> paste -> Run.
-- The site may only ADD events (with the public key); nobody can read them with that key.
-- Reading happens only in the admin-stats Edge Function, after it has checked the Lichess login.

create table if not exists public.events (
  id         bigint generated always as identity primary key,
  at         timestamptz not null default now(),
  kind       text not null check (char_length(kind) <= 20),      -- view, profile, compare, analyse, practise, card, login
  page       text check (char_length(page) <= 40),               -- profile.html, index.html, ...
  target     text check (char_length(target) <= 80),             -- the player looked up, the opening practised, ...
  visitor    text not null check (char_length(visitor) <= 40),   -- a random id kept in the visitor's browser
  user_name  text check (char_length(user_name) <= 30)           -- the Lichess name, only when logged in
);
create index if not exists events_at on public.events (at desc);

alter table public.events enable row level security;
grant insert on public.events to anon; -- newer projects no longer grant this by default

drop policy if exists "anyone can add an event" on public.events;
create policy "anyone can add an event" on public.events
  for insert to anon with check (
    kind in ('view', 'profile', 'compare', 'analyse', 'practise', 'card', 'login')
  );
-- No select, update or delete policy: with the public key the table can be written to, never read.

-- Added 2026-10-29: where visitors come from. Events now go through the track Edge Function, which
-- stores the IP address with its last part zeroed (83.250.12.0), never the whole address, and the country.
alter table public.events add column if not exists ip text check (char_length(ip) <= 45);
alter table public.events add column if not exists country text check (char_length(country) <= 2);

-- Added 2026-10-29: the device (system and browser), the city, and where the visit came from.
alter table public.events add column if not exists device text check (char_length(device) <= 40);
alter table public.events add column if not exists city text check (char_length(city) <= 60);
alter table public.events add column if not exists source text check (char_length(source) <= 80);
