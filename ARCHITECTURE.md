# handmatch web app (version 1.1)

One web app at `/app` for everyone. Each person signs in with an emailed link and sees only the views their roles allow. The full product spec is `docs/PRD.docx`.

## Who uses it

| View | Who | What they do |
|---|---|---|
| **My home** (family) | Paying families | Track progress, meet applicants by phone, video or paid trial, pass or decline, hire after a clear background check, chat, open support requests, request replacements and refunds. |
| **My work** (applicant) | Cleaners, housekeepers, nannies | Profile and availability, accept requests, confirm meetings, check in/out of paid trials, chat, refer friends. |
| **Concierge** | handmatch Concierge (demand side, built-in customer service) | Call new families, share applicants (with match suggestions), schedule meetings, record outcomes, hires and replacements, support cases, chat. |
| **Recruiter** | handmatch Recruiter (supply side) | Pipeline (lead → contacted → screening → interviewed → ID & references → active), add or import leads, website applications, supply board and requests, referrals, templates, pause stale profiles. |
| **Finance** | Finance | Revenue, orders (CSV), refund queue with automatic policy check, Stripe or manual payout, referral bonuses. |
| **Compliance** | Compliance | Background check tickets, the check register (12-month reuse), territories and licence register with renewal warnings, audit log. |
| **Admin** | Admin | Everything above, plus team roles, blocking, setup status and the audit log. |

One person can hold several roles (Marvin holds all of them). A view switcher appears in the top bar.

## The placement journey

1. Family pays → Stripe webhook → family account + **placement** + Concierge chat. If the area has fewer than 3 active applicants of that type, a **supply request** goes to the Recruiters automatically.
2. Concierge calls the family (due within 1 business day), shares active applicants. Applicant accepts → a shared **family + applicant + Concierge chat** opens. Phone numbers and emails typed there are hidden until hire.
3. Family books a **phone call, video interview or paid trial** (trial: 2–8 hours, at or above the territory's minimum wage, an adult home, paid by the family directly). Concierge confirms the time (New York time); applicant confirms; trial check-in/out.
4. Family records **Pass** or **Not the right fit**. Pass opens a **Compliance ticket** (order within 1 business day).
5. Compliance confirms consent and identity, reuses a clear check from the last 12 months or orders a new one (only now, so the expensive check is never wasted). Needs review → individual review, pre-adverse notice, 5 business days, final decision (Fair Chance / FCRA).
6. Clear → family hires → contact details are shared both ways. Other applicants are told they weren't selected once all hires are used. A referral bonus is earned if the applicant was referred.
7. After the hire: **support cases** (safety 1 hour, high 4 hours, others 1 business day), up to **3 replacements within 90 days**, refunds per policy.

## Refund policy (automatic check)

100% before applicants are shared, or no suitable match within 14 days · 50% if shared but no hire within 30 days · 0% after a hire (replacements instead). Finance decides and can change the amount (a note is required above the policy).

## How it's built

- **Pages:** `login.html` and `app.html` (static). The app is plain JavaScript in `assets/app/` (`core.js`, `family.js`, `applicant.js`, `concierge.js`, `recruiter.js`, `ops.js`) with `assets/app.css`. No build step.
- **API:** `api/auth.js` (magic links, sessions), `api/app.js` (dashboards, conversations, ~55 actions), `api/territories.js` (public list for the ZIP check). Shared code: `_app.js` (roles, territories, chat, email, policy), `_dash.js` (one data builder per view), `_rules.js` (validation and the placement steps), `_act_people.js`, `_act_team.js`, `_act_ops.js`.
- **Database:** Supabase. `supabase/app-schema.sql` (run after `schema.sql`). Row Level Security is on with no public policies: only the server reads and writes.
- **Security:** sign-in links are one-time, hashed, 20-minute; sessions are signed HttpOnly cookies (30 days); every action checks the role server-side; cross-site POSTs are blocked; every change is in `audit_log` (without personal free text). Families never see an applicant's contact details before hire, and vice versa. Team notes in chat are never shown to families or applicants.

## Tables

`users` (roles[]), `login_tokens`, `territories`, `licenses`, `applicant_profiles` (profile, pipeline, vetting, team notes), `pipeline_events`, `placements`, `placement_applicants`, `placement_events`, `meetings`, `compliance_tickets`, `background_checks`, `cases`, `threads`, `thread_members`, `thread_messages`, `refunds`, `supply_requests`, `referrals`, `audit_log`. Orders gain `refunded_cents`.

## Switching it on (staging first)

1. Supabase: create a `handmatch-staging` project. SQL Editor → run `supabase/schema.sql`, then `supabase/app-schema.sql`.
2. Vercel → Settings → Environment Variables, scope **Preview**:

| Name | Value | Notes |
|---|---|---|
| `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | from the staging project | Never the production database. |
| `SESSION_SECRET` | 40+ random characters | Different for staging and production. |
| `ADMIN_EMAILS` | `perolmarvin@gmail.com,hello.handmatch@gmail.com` | Get every team role on first sign-in. |
| `DEFAULT_CONCIERGE_EMAIL` | `perolmarvin@gmail.com` | Optional. |
| `APP_ENABLED` | `1` | Payments open placements; checkout only in sellable territories. |
| `RESEND_API_KEY`, `FROM_EMAIL` | same as production | Staging emails are prefixed “[STAGING]”. |
| `SITE_URL` | `https://staging.handmatch.us` | So email links point to staging. |

3. Redeploy staging, open `staging.handmatch.us/login`, sign in with an admin email.

Production stays off until approved: leave `APP_ENABLED` unset there.

## Testing

Tested end to end against real Postgres + PostgREST (the same API Supabase uses): 82 API checks covering every role, the full journey, permissions and privacy, plus a 33-screen browser walkthrough on desktop and mobile.

## A/B test: "Meet first, pay when you hire" (staging)

- **A:** $349 upfront per hire (today's model). **B:** $49 deposit per hire, then the $300 balance when the family confirms a hire. Same $349 total; replacements stay free.
- Visitors are split 50/50 the first time they land (`assets/ab.js` → `api/ab.js`) and keep their variant. Preview a side with `?variant=A` or `?variant=B` (not counted in results).
- B families see "Pay $300 and hire" after a clear background check. It opens Stripe, or, where Stripe isn't connected, asks the team to send a link; Finance or the Concierge then uses **Mark balance paid**. Contact details are shared only after the balance is paid.
- B refunds: deposit fully refunded before applicants are shared or if there's no suitable match in 14 days; otherwise no refund, and nothing more to pay unless they hire.
- Results: **Finance → Overview → A/B test** (visitors, preferences, paid starts, balances, hires, revenue per 100 visitors). Call it after about 300 visitors per side, plus about 2 weeks for hires.
- **Staging shows B to everyone** (no split), so the team can review it. `?variant=A` still shows the old version. To run the real 50/50 test, set `AB_FORCE=split` (any value other than A or B) with `AB_TEST=1`. `AB_FORCE=A` or `AB_FORCE=B` shows one version to everyone.
- Switch on: run `supabase/ab-test.sql` first (required on staging). In production nothing changes unless `AB_TEST` or `AB_FORCE` is set. Optional: `DEPOSIT_CENTS` (default 4900), `BALANCE_CENTS` (default 30000). Without `AB_TEST`, everyone gets A and nothing changes.
