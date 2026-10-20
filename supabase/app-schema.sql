-- handmatch web app tables, version 1.1 (see docs/PRD.docx)
-- Run once AFTER schema.sql, in the database the app should use
-- (staging first): SQL Editor → New query → paste this file → Run.
-- Safe to re-run: everything is "if not exists".
-- Same rule as the rest of the site: only the server reads and writes,
-- so Row Level Security is on with no public policies.

create extension if not exists pgcrypto;

-- Upgrading from the 1.0 staging build? Its tables (cases with coordinators,
-- case_applicants, case_events) are replaced by placements. If you ran the 1.0
-- file, drop those three tables and the old users.role column first:
--   drop table if exists public.case_events, public.case_applicants;
--   drop table if exists public.cases cascade;
--   alter table public.users drop column if exists role;

-- Orders: track partial refunds
alter table public.orders add column if not exists refunded_cents int not null default 0;

-- ------------------------------------------------------------------ people
-- One account per email. A person can hold several roles:
-- family, applicant, concierge, recruiter, finance, compliance, admin.
create table if not exists public.users (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  email text not null unique,
  roles text[] not null default '{}',
  full_name text not null default '',
  phone text not null default '',
  photo_url text not null default '',
  title text not null default '',
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

-- ------------------------------------------------------------- territories
-- Where handmatch can sell. Compliance keeps the licence register up to date.
create table if not exists public.territories (
  code text primary key,                      -- NY, CA, FL
  name text not null,
  zip_ranges text not null default '',        -- first 3 ZIP digits, e.g. "100-149"
  sellable boolean not null default false,
  min_wage numeric not null default 0,        -- used for paid trials
  notes text not null default '',
  updated_at timestamptz not null default now()
);

create table if not exists public.licenses (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  territory_code text not null references public.territories(code) on delete cascade,
  kind text not null default '',              -- e.g. Employment agency licence
  number text not null default '',
  issuer text not null default '',
  issued_on date,
  expires_on date,
  status text not null default 'pending',     -- pending, active, expired, not_required
  document_url text not null default '',
  notes text not null default ''
);

insert into public.territories (code, name, zip_ranges, sellable, min_wage) values
  ('NY', 'New York', '100-149', true, 17.00),
  ('CA', 'California', '900-961', true, 16.90),
  ('FL', 'Florida', '320-349', true, 15.00)
on conflict (code) do nothing;

-- -------------------------------------------------------------- applicants
create table if not exists public.applicant_profiles (
  user_id uuid primary key references public.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  role_type text not null default 'housekeeper',      -- cleaner, housekeeper, nanny
  city text not null default '',
  zip text not null default '',
  territory_code text not null default '',
  rate numeric,
  years int,
  employment text not null default 'Part-time or full-time',
  languages text[] not null default '{}',
  skills text[] not null default '{}',
  bio text not null default '',
  days text[] not null default '{}',
  hours text not null default '',
  start_in_days int,
  availability_updated_at timestamptz not null default now(),
  status text not null default 'draft',               -- draft, submitted, active, paused
  -- recruiting pipeline (supply side)
  pipeline_stage text not null default 'lead',        -- lead, contacted, screening, interviewed, checks, active, paused, rejected
  source text not null default '',                    -- website, referral, facebook, indeed, craigslist, walk_in, agency, other
  recruiter_user_id uuid references public.users(id) on delete set null,
  referred_by_user_id uuid references public.users(id) on delete set null,
  screening_at timestamptz,
  next_step text not null default '',
  last_contacted_at timestamptz,
  -- vetting
  background_consent boolean not null default false,
  check_interview boolean not null default false,
  check_id boolean not null default false,
  check_references boolean not null default false,
  check_background text not null default 'not_started', -- not_started, pending, clear, review, not_cleared
  team_notes text not null default ''                    -- never shown to applicants or families
);

create table if not exists public.pipeline_events (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  applicant_user_id uuid not null references public.users(id) on delete cascade,
  actor_user_id uuid references public.users(id) on delete set null,
  kind text not null default 'note',
  body text not null default ''
);

-- -------------------------------------------------------------- placements
-- A placement is one family's search for one kind of help, from payment to hire.
create table if not exists public.placements (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  family_user_id uuid not null references public.users(id) on delete cascade,
  concierge_user_id uuid references public.users(id) on delete set null,
  order_id uuid references public.orders(id) on delete set null,
  request_id uuid references public.requests(id) on delete set null,
  status text not null default 'new',   -- new, contacted, matching, meeting, checks, hired, replacement, closed
  zip text not null default '',
  territory_code text not null default '',
  help_type text not null default '',
  notes text not null default '',
  hires_allowed int not null default 1,
  replacements_used int not null default 0,
  first_contact_at timestamptz,
  hired_at timestamptz,
  closed_at timestamptz
);

create table if not exists public.placement_applicants (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  placement_id uuid not null references public.placements(id) on delete cascade,
  applicant_user_id uuid not null references public.users(id) on delete cascade,
  -- waiting, accepted, declined, meeting, passed, check, cleared, hired, ended, not_fit, not_selected, removed
  status text not null default 'waiting',
  family_note text not null default '',
  hired_at timestamptz,
  unique (placement_id, applicant_user_id)
);

create table if not exists public.placement_events (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  placement_id uuid not null references public.placements(id) on delete cascade,
  actor_user_id uuid references public.users(id) on delete set null,
  kind text not null default 'note',
  body text not null default '',
  visible_to_family boolean not null default true
);

-- Phone call, video interview or paid trial between a family and an applicant.
create table if not exists public.meetings (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  placement_id uuid not null references public.placements(id) on delete cascade,
  placement_applicant_id uuid not null references public.placement_applicants(id) on delete cascade,
  kind text not null default 'phone',          -- phone, video, trial
  status text not null default 'requested',    -- requested, confirmed, completed, cancelled, no_show
  start_at timestamptz,
  preferred_times text not null default '',
  duration_min int not null default 30,
  join_info text not null default '',          -- call number, video link or address notes
  trial_rate numeric,
  trial_hours numeric,
  family_note text not null default '',
  requested_by uuid references public.users(id) on delete set null,
  applicant_confirmed boolean not null default false,
  checked_in_at timestamptz,
  checked_out_at timestamptz,
  outcome text,                                -- pass, not_fit
  outcome_note text not null default '',
  outcome_at timestamptz
);

-- --------------------------------------------------------------- compliance
-- Opened automatically when a family passes an applicant. The paid third-party
-- background check is ordered only from here.
create table if not exists public.compliance_tickets (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  placement_id uuid not null references public.placements(id) on delete cascade,
  placement_applicant_id uuid not null references public.placement_applicants(id) on delete cascade,
  applicant_user_id uuid not null references public.users(id) on delete cascade,
  -- ready_review, ordered, in_progress, needs_review, clear, not_cleared, cancelled
  status text not null default 'ready_review',
  checklist jsonb not null default '{}',
  due_at timestamptz,
  assignee_user_id uuid references public.users(id) on delete set null,
  background_check_id uuid,
  adverse_notice_at timestamptz,
  notes text not null default '',
  closed_at timestamptz
);

create table if not exists public.background_checks (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  applicant_user_id uuid not null references public.users(id) on delete cascade,
  ticket_id uuid references public.compliance_tickets(id) on delete set null,
  provider text not null default '',
  package text not null default '',
  external_ref text not null default '',
  cost_cents int,
  status text not null default 'ordered',      -- ordered, in_progress, needs_review, clear, not_cleared, cancelled
  ordered_by uuid references public.users(id) on delete set null,
  ordered_at timestamptz,
  completed_at timestamptz,
  expires_at timestamptz                       -- a clear check is reused for 12 months
);

-- ------------------------------------------------------------ support cases
-- Issues raised by paying families (or hired applicants) after a hire.
create table if not exists public.cases (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  placement_id uuid references public.placements(id) on delete set null,
  family_user_id uuid references public.users(id) on delete set null,
  applicant_user_id uuid references public.users(id) on delete set null,
  opened_by uuid references public.users(id) on delete set null,
  type text not null default 'other',          -- safety, no_show, quality, schedule, payment, replacement, refund, other
  priority text not null default 'normal',     -- urgent, high, normal
  status text not null default 'open',         -- open, in_progress, waiting, resolved, closed
  subject text not null default '',
  description text not null default '',
  assignee_user_id uuid references public.users(id) on delete set null,
  due_at timestamptz,
  resolution text not null default '',
  resolved_at timestamptz
);

-- -------------------------------------------------------------------- chat
-- concierge: family + Concierge · meet: family + applicant + Concierge · case: support case
create table if not exists public.threads (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  kind text not null,
  placement_id uuid references public.placements(id) on delete cascade,
  placement_applicant_id uuid references public.placement_applicants(id) on delete cascade,
  case_id uuid references public.cases(id) on delete cascade,
  title text not null default '',
  last_message_at timestamptz
);

create table if not exists public.thread_members (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  thread_id uuid not null references public.threads(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  last_read_at timestamptz,
  unique (thread_id, user_id)
);

create table if not exists public.thread_messages (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  thread_id uuid not null references public.threads(id) on delete cascade,
  user_id uuid references public.users(id) on delete set null,
  body text not null default '',
  internal boolean not null default false,     -- team-only note
  system boolean not null default false
);

-- ------------------------------------------------------------------ finance
create table if not exists public.refunds (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  order_id uuid references public.orders(id) on delete set null,
  placement_id uuid references public.placements(id) on delete set null,
  family_user_id uuid references public.users(id) on delete set null,
  requested_by uuid references public.users(id) on delete set null,
  reason text not null default '',
  percent int not null default 0,
  amount_cents int not null default 0,
  status text not null default 'requested',    -- requested, approved, denied, refunded
  eligibility jsonb not null default '{}',
  decided_by uuid references public.users(id) on delete set null,
  decided_at timestamptz,
  decision_note text not null default '',
  stripe_refund_id text not null default '',
  refunded_at timestamptz
);

-- ------------------------------------------------------------------- supply
create table if not exists public.supply_requests (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  placement_id uuid references public.placements(id) on delete set null,
  territory_code text not null default '',
  zip text not null default '',
  role_type text not null default 'housekeeper',
  needed int not null default 3,
  rate_max numeric,
  details text not null default '',
  due_at timestamptz,
  status text not null default 'open',         -- open, in_progress, filled, cancelled
  created_by uuid references public.users(id) on delete set null,
  assignee_user_id uuid references public.users(id) on delete set null
);

create table if not exists public.referrals (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  referrer_user_id uuid references public.users(id) on delete set null,
  name text not null default '',
  email text not null default '',
  phone text not null default '',
  role_type text not null default '',
  status text not null default 'new',          -- new, contacted, joined, hired, bonus_paid, not_eligible
  lead_user_id uuid references public.users(id) on delete set null,
  bonus_cents int not null default 0,
  paid_at timestamptz,
  notes text not null default ''
);

-- -------------------------------------------------------------------- audit
create table if not exists public.audit_log (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  actor_user_id uuid references public.users(id) on delete set null,
  action text not null,
  entity text not null default '',
  entity_id text not null default '',
  detail jsonb not null default '{}'
);

-- ---------------------------------------------------------------- security
alter table public.users                enable row level security;
alter table public.login_tokens         enable row level security;
alter table public.territories          enable row level security;
alter table public.licenses             enable row level security;
alter table public.applicant_profiles   enable row level security;
alter table public.pipeline_events      enable row level security;
alter table public.placements           enable row level security;
alter table public.placement_applicants enable row level security;
alter table public.placement_events     enable row level security;
alter table public.meetings             enable row level security;
alter table public.compliance_tickets   enable row level security;
alter table public.background_checks    enable row level security;
alter table public.cases                enable row level security;
alter table public.threads              enable row level security;
alter table public.thread_members       enable row level security;
alter table public.thread_messages      enable row level security;
alter table public.refunds              enable row level security;
alter table public.supply_requests      enable row level security;
alter table public.referrals            enable row level security;
alter table public.audit_log            enable row level security;

-- ------------------------------------------------------------------ indexes
create index if not exists users_roles_idx           on public.users using gin (roles);
create index if not exists login_tokens_user_idx     on public.login_tokens (user_id, created_at desc);
create index if not exists licenses_territory_idx    on public.licenses (territory_code);
create index if not exists profiles_stage_idx        on public.applicant_profiles (pipeline_stage);
create index if not exists pipeline_events_app_idx   on public.pipeline_events (applicant_user_id, created_at);
create index if not exists placements_family_idx     on public.placements (family_user_id);
create index if not exists placements_created_idx    on public.placements (created_at desc);
create index if not exists pl_apps_placement_idx     on public.placement_applicants (placement_id);
create index if not exists pl_apps_user_idx          on public.placement_applicants (applicant_user_id);
create index if not exists pl_events_placement_idx   on public.placement_events (placement_id, created_at);
create index if not exists meetings_placement_idx    on public.meetings (placement_id);
create index if not exists meetings_link_idx         on public.meetings (placement_applicant_id);
create index if not exists tickets_status_idx        on public.compliance_tickets (status, created_at);
create index if not exists checks_applicant_idx      on public.background_checks (applicant_user_id, created_at desc);
create index if not exists cases_status_idx          on public.cases (status, created_at desc);
create index if not exists cases_family_idx          on public.cases (family_user_id);
create index if not exists threads_placement_idx     on public.threads (placement_id);
create index if not exists threads_link_idx          on public.threads (placement_applicant_id);
create index if not exists threads_case_idx          on public.threads (case_id);
create index if not exists members_user_idx          on public.thread_members (user_id);
create index if not exists messages_thread_idx       on public.thread_messages (thread_id, created_at);
create index if not exists refunds_status_idx        on public.refunds (status, created_at desc);
create index if not exists supply_status_idx         on public.supply_requests (status, created_at desc);
create index if not exists referrals_status_idx      on public.referrals (status, created_at desc);
create index if not exists audit_created_idx         on public.audit_log (created_at desc);
