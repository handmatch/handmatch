-- A/B test: "Meet first, pay when you hire" (variant B: $49 deposit + $300 at hire)
-- Run once in the database where the test runs (staging first), after app-schema.sql.
-- The test is only active where the AB_TEST=1 environment variable is set.
-- Safe to re-run.

create table if not exists public.ab_visits (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  variant text not null,            -- A or B
  path text not null default '',
  from_ad boolean not null default false,
  forced boolean not null default false
);
alter table public.ab_visits enable row level security;
create index if not exists ab_visits_created_idx on public.ab_visits (created_at desc);

alter table public.requests add column if not exists variant text;
alter table public.orders add column if not exists variant text;
alter table public.orders add column if not exists fee_type text not null default 'full';   -- full, deposit, balance
alter table public.orders add column if not exists placement_id uuid references public.placements(id) on delete set null;
alter table public.orders add column if not exists placement_applicant_id uuid references public.placement_applicants(id) on delete set null;
alter table public.placements add column if not exists fee_model text not null default 'full';  -- full, deposit
alter table public.placements add column if not exists balances_paid int not null default 0;
