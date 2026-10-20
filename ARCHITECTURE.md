# handmatch web app: architecture

One web app at **handmatch.us/app** for three kinds of people. Everyone logs in the same way and sees a dashboard for their role. No native apps; it works in any phone browser and can be added to the home screen.

| Role | Who | What they do |
|---|---|---|
| **Family** | Customers who paid the one-time fee | See their coordinator, their applicants, interview times and progress. Ask for a different applicant. |
| **Applicant** | Cleaners, housekeepers and nannies | Fill in their profile and availability. Accept or decline interview requests. See which checks are done. |
| **Coordinator** | handmatch team (Marvin, George, Laureen…) | See every family and applicant. Add applicants to a family, schedule interviews, update status, keep notes, verify checks. |

## How it fits together

```
 Browser (handmatch.us)                       Vercel serverless functions           Supabase (Postgres)
 ───────────────────────                      ───────────────────────────           ───────────────────
 /login  ── email ──────────────────────────▶ /api/auth?action=start ──────────────▶ users, login_tokens
         ◀─ magic link email (Resend) ───────┘
 /login?token=… ── Continue ────────────────▶ /api/auth?action=verify ─ sets signed session cookie
 /app    ── dashboard / actions ────────────▶ /api/app?action=… ─── role check ─────▶ cases, case_applicants,
                                                                                     case_events, applicant_profiles
 Stripe ── payment confirmed ───────────────▶ /api/stripe-webhook ── (APP_ENABLED=1) creates family + case
```

- **Pages:** `login.html` and `app.html`, plain HTML with the same small page runtime as the rest of the site.
- **API:** two new functions, `api/auth.js` and `api/app.js`. Shared code lives in `api/_session.js` and `api/_app.js`.
- **Database:** only the server talks to Supabase, with the service role key. Row Level Security stays on with no public policies, so the browser can never read tables directly. Every permission is checked in `api/app.js`.

## Login: email magic link

1. The person types their email on `/login`.
2. If the email belongs to someone we know, we email a one-time link (valid 20 minutes). We always show the same "check your email" message, so nobody can test which emails have accounts.
3. The link opens `/login?token=…` with a **Continue** button. The token is only used when the person taps it, so email security scanners that open links can't use it up.
4. The server checks the token (stored only as a SHA-256 hash), marks it used, and sets a signed, HttpOnly session cookie for 30 days.

**Who can log in, and as what:**
- **Coordinator:** emails listed in `COORDINATOR_EMAILS`, or invited by a coordinator.
- **Family:** anyone with a **paid** order. Their account and case are created automatically.
- **Applicant:** anyone who applied through `/join`, or was invited by a coordinator.
- Anyone else gets the "check your email" message but no link.

## Data model (supabase/app-schema.sql)

| Table | Purpose |
|---|---|
| `users` | One row per person: email, role (`family`, `applicant`, `coordinator`), name, phone, photo. |
| `login_tokens` | Hashed one-time login tokens with expiry. |
| `applicant_profiles` | Profile and availability, plus the checks a coordinator verifies (interview, ID, references, background check) and private coordinator notes. |
| `cases` | One per family hire: family, assigned coordinator, linked order and preferences, status, private notes. |
| `case_applicants` | Applicants proposed to a case, with status and interview time. |
| `case_events` | Timeline of what happened. Events marked visible show on the family's dashboard ("every step of the way"). |

**Case status:** new → contacted → interviewing → hired → (replacement) → closed.
**Applicant on a case:** proposed → accepted / declined → interview → hired / not selected.

## What each role can see

- **Family:** their own cases only; their coordinator's name, photo, email and phone; applicants' public profile (first name and last initial, role, area, rate, experience, skills, availability, which checks are done). Never an applicant's email, phone or documents. Coordinators arrange first contact.
- **Applicant:** their own profile; for each request, only the family's first name, ZIP and type of help, and the interview time.
- **Coordinator:** everything, plus private notes.

## Notifications

Email (Resend) when: an applicant gets a new request, an interview is scheduled, an applicant responds, or a family asks for a different applicant. SMS can be added later with a provider such as Twilio.

## Settings (Vercel environment variables)

| Key | Example | Notes |
|---|---|---|
| `SESSION_SECRET` | 40+ random characters | Signs session cookies. Different value per environment. |
| `COORDINATOR_EMAILS` | `hello.handmatch@gmail.com,perolmarvin@gmail.com` | Comma-separated. |
| `DEFAULT_COORDINATOR_EMAIL` | `perolmarvin@gmail.com` | Assigned to new cases. Optional. |
| `APP_ENABLED` | `1` | Lets the Stripe webhook create family accounts and cases. Leave unset in production until the app is approved. |

## Later

- SMS and web push notifications.
- Photo and document uploads (Supabase Storage).
- In-app messaging.
- Wrap the same app as iPhone/Android apps for applicants (Capacitor) if on-demand features are added.
