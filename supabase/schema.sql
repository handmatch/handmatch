-- handmatch database tables
-- Run once in Supabase: SQL Editor → New query → paste this file → Run.
-- The website writes with the service role key (server-side only), so Row Level
-- Security is switched on with no public policies: nobody can read these tables
-- from a browser.

create extension if not exists pgcrypto;

-- Step 1: family preferences
create table if not exists public.requests (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  help_type text,
  services text[] default '{}',
  days text[] default '{}',
  frequency text,
  budget_per_hour numeric,
  location text,
  home_size text,
  pets boolean default false,
  supplies boolean default false,
  notes text,
  status text not null default 'new'
);

-- Step 3: orders and payments
create table if not exists public.orders (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  order_ref text unique,
  request_id uuid references public.requests(id) on delete set null,
  full_name text not null,
  phone text not null,
  email text not null,
  hires int not null default 1 check (hires between 1 and 5),
  amount_cents int not null,
  status text not null default 'pending',  -- pending, paid, refunded
  stripe_session_id text unique,
  amount_paid_cents int,
  paid_at timestamptz,
  notes text
);

-- Join handmatch: cleaners, housekeepers and nannies
create table if not exists public.helpers (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  full_name text not null,
  email text not null,
  phone text,
  city text,
  roles text[] default '{}',
  services text[] default '{}',
  days text[] default '{}',
  rate text,
  experience text,
  bio text,
  background_check_consent boolean not null default false,
  status text not null default 'new'   -- new, screening, approved, declined
);

-- Contact page
create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  name text,
  email text,
  topic text,
  message text,
  status text not null default 'new'
);

-- "Outside the US?" waitlist
create table if not exists public.waitlist (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  country text,
  email text not null
);

alter table public.requests enable row level security;
alter table public.orders   enable row level security;
alter table public.helpers  enable row level security;
alter table public.messages enable row level security;
alter table public.waitlist enable row level security;

create index if not exists orders_created_idx   on public.orders (created_at desc);
create index if not exists requests_created_idx on public.requests (created_at desc);
create index if not exists helpers_created_idx  on public.helpers (created_at desc);
