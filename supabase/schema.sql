create extension if not exists pgcrypto;

create table if not exists public.parsed_quotes (
  id uuid primary key default gen_random_uuid(),
  source_name text not null,
  source_type text not null,
  total_quote numeric,
  guestroom_total numeric,
  meeting_room_total numeric,
  food_and_beverage_total numeric,
  evidence jsonb not null default '{}'::jsonb,
  raw_preview text,
  created_at timestamptz not null default timezone('utc', now())
);

create index if not exists parsed_quotes_created_at_idx
  on public.parsed_quotes (created_at desc);

alter table public.parsed_quotes enable row level security;

-- Demo policies for takehome use with anon key.
drop policy if exists "Allow anon insert parsed quotes" on public.parsed_quotes;
create policy "Allow anon insert parsed quotes"
  on public.parsed_quotes
  for insert
  to anon
  with check (true);

drop policy if exists "Allow anon read parsed quotes" on public.parsed_quotes;
create policy "Allow anon read parsed quotes"
  on public.parsed_quotes
  for select
  to anon
  using (true);
