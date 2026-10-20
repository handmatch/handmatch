# handmatch

The right hands for your home. Direct-hire cleaners, housekeepers and nannies, handpicked by people.

This is the live website: plain HTML pages plus a few small serverless functions on Vercel. There are no packages to install and no build step.

## What's in here

| Path | What it is |
|---|---|
| `index.html` | Landing page |
| `preferences.html` | Step 1: family preferences, saved to the `requests` table |
| `matches.html` | Step 2: your matches, $349 × number of hires, then "Pay now" |
| `pay.html` | Step 3: name, mobile and email, then Stripe's secure card page |
| `thank-you.html`, `next-steps.html` | After payment |
| `contact.html` | Contact form, saved to `messages` |
| `join.html` | Helper applications, saved to `helpers` (not linked from the site yet: share the link directly) |
| `terms.html` | Key terms and refund policy (full terms to be added) |
| `login.html`, `app.html`, `assets/app/`, `assets/app.css` | Web app: one sign-in for families, applicants and the team (Concierge, Recruiter, Finance, Compliance, Admin). See `ARCHITECTURE.md` and `docs/PRD.docx` |
| `api/` | Serverless functions: `requests`, `checkout`, `stripe-webhook`, `order`, `contact`, `helpers`, `waitlist`, `auth`, `app`, `territories` |
| `supabase/schema.sql` | Creates the database tables |
| `supabase/app-schema.sql` | Adds the web app tables (run after schema.sql) |
| `assets/` | Images and the small page runtime (`hm-runtime.js`) |

## Where sign-ups go

Every form saves a row in **Supabase** and emails the team (via **Resend**) at `TEAM_EMAIL`.

| Form | Supabase table |
|---|---|
| Preferences | `requests` |
| Pay one-time fee | `orders` (status becomes `paid` when Stripe confirms) |
| Join as a helper | `helpers` |
| Contact | `messages` |
| Outside the US waitlist | `waitlist` |

View them in Supabase → **Table Editor**. You can filter, sort and export to CSV.

## Setup

1. **Vercel**: Add New → Project → import `handmatch/handmatch` → Deploy. The site works right away, but the forms show a "not connected yet" message until steps 2–4 are done.
2. **Supabase**: create a project, open **SQL Editor**, paste `supabase/schema.sql` and run it. Then copy the Project URL and the `service_role` key from **Project Settings → API**.
3. **Stripe**: copy the secret key from **Developers → API keys** (start with the test key `sk_test_…`). Add a webhook at **Developers → Webhooks** pointing to `https://YOUR-DOMAIN/api/stripe-webhook` with the event `checkout.session.completed`, and copy its signing secret.
4. **Resend**: create an API key. To email customers from your own address, verify your domain in Resend and set `FROM_EMAIL`.
5. In **Vercel → Project → Settings → Environment Variables**, add the keys listed in `.env.example`, then redeploy.

Test a full payment with Stripe's test card `4242 4242 4242 4242` (any future date, any CVC). When it works, switch to your live Stripe keys.

## Preview locally (optional)

```bash
node scripts/dev.js   # http://localhost:3000
```

Put your keys in `.env.local` (never commit it).
