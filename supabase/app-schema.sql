-- handmatch web app tables (logins and dashboards)
-- Run once AFTER schema.sql, in the database the app should use
-- (staging first): SQL Editor → New query → paste this file → Run.
-- Same rule as the rest of the site: only the server reads and writes,
-- so Row Level Security is on with no public policies.

create extension if not exists pgcrypto;

create table if not exists public.users (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  email text not null unique,
  role text not null check (role in ('family', 'applicant', 'coordinator')),
  full_name text not null default '',
  phone text not null default '',
  photo_url text not null default '',
  disabled boolean not null default false,
  last_login_at timestamptz
);

create table if not exists public.login_tokens (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  user_id uuid not null references public.users(id) on delete cascade,
  token_hash text not null unique,
  expires_at timestamptz not null,
  used_at timestamptz
);

create table if not exists public.applicant_profiles (
  user_id uuid primary key references public.users(id) on delete cascade,
  updated_at timestamptz not null default now(),
  role_type text not null default 'housekeeper',   -- cleaner, housekeeper, nanny
  city text not null default '',
  zip text not null default '',
  rate numeric,
  years int,
  employment text not null default 'Part-time or full-time',
  languages text[] not null default '{}',
  skills text[] not null default '{}',
  bio text not null default '',
  days text[] not null default '{}',
  hours text not null default '',
  start_in_days int,
  status text not null default 'draft',              -- draft, submitted, active, paused
  check_interview boolean not null default false,
  check_id boolean not null default false,
  check_references boolean not null default false,
  check_background text not null default 'not_started', -- not_started, pending, clear
  coordinator_notes text not null default ''
);

create table if not exists public.cases (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  family_user_id uuid not null references public.users(id) on delete cascade,
  coordinator_user_id uuid references public.users(id) on delete set null,
  order_id uuid references public.orders(id) on delete set null,
  request_id uuid references public.requests(id) on delete set null,
  status text not null default 'new',                -- new, contacted, interviewing, hired, replacement, closed
  zip text not null default '',
  help_type text not null default '',
  notes text not null default ''
);

create table if not exists public.case_applicants (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  case_id uuid not null references public.cases(id) on delete cascade,
  applicant_user_id uuid not null references public.users(id) on delete cascade,
  status text not null default 'proposed',           -- proposed, accepted, declined, interview, hired, not_selected, removed
  interview_at timestamptz,
  unique (case_id, applicant_user_id)
);

create table if not exists public.case_events (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  case_id uuid not null references public.cases(id) on delete cascade,
  actor_user_id uuid references public.users(id) on delete set null,
  kind text not null default 'note',
  body text not null default '',
  visible_to_family boolean not null default true
);

alter table public.users              enable row level security;
alter table public.login_tokens       enable row level security;
alter table public.applicant_profiles enable row level security;
alter table public.cases              enable row level security;
alter table public.case_applicants    enable row level security;
alter table public.case_events        enable row level security;

create index if not exists cases_family_idx      on public.cases (family_user_id);
create index if not exists cases_created_idx     on public.cases (created_at desc);
create index if not exists case_apps_case_idx    on public.case_applicants (case_id);
create index if not exists case_apps_user_idx    on public.case_applicants (applicant_user_id);
create index if not exists case_events_case_idx  on public.case_events (case_id, created_at);
create index if not exists login_tokens_user_idx on public.login_tokens (user_id, created_at desc);
