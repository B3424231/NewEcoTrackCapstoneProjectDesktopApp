# Public administrator registration

The desktop Register as an Administrator form accepts a username, email address, password
and confirmation without requiring an existing administrator to sign in first.
The user explicitly approved public signup. The Supabase registration URL is
accessible independently of the desktop UI.

The renderer validates the form and invokes the existing `auth-register-admin`
IPC channel. Electron retains its trusted local-page check and calls
`provision-admin` using a publishable key. Browser fixtures can call the same
function directly. No approval credentials or sign-in session are needed.

The hosted function source is in
`supabase/functions/provision-admin/index.ts` and `handler.mjs`. Deploy both files
to the configured Supabase project with JWT verification disabled, as on the
previous deployment. The hosted environment supplies `SUPABASE_URL` and
`SUPABASE_SERVICE_ROLE_KEY`; never put the service credential in renderer code.

The function validates the profile, rate-limits attempts through the existing
service-only `ecotrack_auth_attempt` counter, inserts a new administrator profile,
and creates its Supabase Auth user. Only server-generated `app_metadata` links
that new user to that new profile. The existing Auth trigger performs the link;
database access policies and other management endpoints remain unchanged.

Limits are 10 attempts per 15-minute counter window for the forwarded IP address
and normalized email address. Counter keys are hashes in a separate namespace
from sign-in attempts. A denied or unavailable counter stops registration before
any new account is created. IP-based limiting depends on the hosting gateway's
forwarded headers; email limits and database uniqueness also apply.

The existing email/password credential contract is retained: server-created
accounts can sign in with email and password immediately. Registration does not
send a confirmation or recovery email, does not automatically sign in the new
account, and does not replace a current session. A definite Auth rejection
removes only the just-created, still-unlinked profile. An uncertain transport
result retains potentially committed data and asks the user to check/sign in
before retrying.

Focused checks use synthetic fixtures and do not create real accounts:

```powershell
node --test scripts/test_admin_registration.js scripts/test_public_admin_handler.js
node scripts/test_admin_registration_browser.js
node scripts/verify_current_ui_assets.js
npm test
```

Browser output can be redirected with `ECOTRACK_ADMIN_TEST_OUTPUT`. Set
`ECOTRACK_PLAYWRIGHT` and `ECOTRACK_CHROME` if those tools are not installed in the
project. Restart the desktop application after changing the Electron registration
handler so the main process loads the updated helper.
