# Web app tests

Run against a local Postgres + PostgREST (the same REST API Supabase uses), never a real database.

1. Create a database and run `supabase/schema.sql` then `supabase/app-schema.sql`.
2. Start PostgREST on port 3001 (role with full access) and `node tests/proxy.js` (adds Supabase's `/rest/v1` prefix on port 54321).
3. Start the site with test settings, logging to `tests/dev.log`:
   `SUPABASE_URL=http://localhost:54321 SUPABASE_SERVICE_ROLE_KEY=<jwt> SESSION_SECRET=test-secret-0123456789abcdef ADMIN_EMAILS=marvin@test.com APP_ENABLED=1 SITE_URL=http://localhost:3010 STRIPE_WEBHOOK_SECRET=whsec_test PORT=3010 node scripts/dev.js > tests/dev.log`
4. `node tests/api-test.js` (82 checks: every role, the full journey, permissions and privacy).
5. On a fresh database: `node tests/ui-test.js` (browser walkthrough with Playwright; screenshots in `tests/shots/`).

Sign-in links are read from the dev log, because no email is sent without a Resend key.
