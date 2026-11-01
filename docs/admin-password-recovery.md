# Desktop administrator password recovery

The desktop sign-in form accepts an email address and password. Recovery follows
the mobile app's email-code flow: send a recovery email, verify the numeric code,
then set and confirm a new password. Administrator registration is publicly
available without a prior sign-in; recovery still verifies an active
administrator account. Profile display names are unchanged.

## Supabase email configuration

Desktop and mobile must point to the same intended Supabase project. In that
project's Authentication email templates, the **Reset password** template must
include the recovery token, rather than only a link. The mobile project already
contains a reference at `supabase/templates/recovery.html`:

```html
<h2>Reset your EcoTrack password</h2>
<p>Enter this recovery code in the EcoTrack app:</p>
<p><strong>{{ .Token }}</strong></p>
<p>If you did not request a password reset, ignore this email.</p>
```

Configure the project's email delivery/SMTP settings for the intended recipients.
Supabase applies its configured email and verification rate limits. The UI waits
60 seconds before allowing a successful send to be resent. Code expiration and
actual password policy remain controlled by Supabase. The desktop accepts the
6–10 digit code format used by the mobile app and requires at least eight
characters for a new password.

No hosted email settings were changed during this implementation. Mail delivery
and a real inbox/password change have not been tested. Deployment verification
should use a designated test administrator and confirm delivery, successful
recovery, and sign-in with the new password.

Official references:

- [Recovery email API](https://supabase.com/docs/reference/javascript/auth-resetpasswordforemail)
- [Recovery code verification](https://supabase.com/docs/reference/javascript/auth-verifyotp)
- [Email template variables](https://supabase.com/docs/guides/auth/auth-email-templates)

## Session and administrator checks

- Recovery creates a separate client with memory-only storage, a unique storage
  key, no persistent session, no automatic refresh, and no URL session capture.
- `verifyOtp` uses the `recovery` type. The server-verified user, local temporary
  session, `ecotrack_is_admin`, and `ecotrack_my_profile` must agree on an active
  administrator before password entry is authorized.
- Password submission revalidates the same identity and administrator profile.
  It never calls the main process session IPC or saves a dashboard login.
- Closing recovery clears its temporary session; late verification responses are
  cleared too. Success clears the code and password fields and returns to sign-in.
- Recovery operations have a 15-second deadline. A stalled sign-out cannot hold
  confirmed password success open. If a dispatched password update times out,
  the UI explains that its result is unconfirmed and suggests trying the new
  password or requesting another recovery code.
- Remember me stores only a valid email. A previously remembered email migrates;
  remembered usernames or phone numbers are discarded. Passwords are sent with
  their original case and are never saved by the recovery controller.

## Isolated verification

These scripts use disposable Auth/API fixtures and do not send mail, modify real
accounts, or write to the production database:

```powershell
node scripts/test_password_recovery.js
node scripts/test_password_recovery_sdk.js
node scripts/test_password_recovery_browser.js
node scripts/test_admin_registration.js
node scripts/test_admin_registration_browser.js
node scripts/verify_current_ui_assets.js
npm test
```

Browser scripts support `ECOTRACK_PLAYWRIGHT` and `ECOTRACK_CHROME` when those
tools are not installed in the project. Set `ECOTRACK_RECOVERY_REPORT_DIR` for
recovery screenshots/results and `ECOTRACK_ADMIN_TEST_OUTPUT` for administrator
registration screenshots/results to a separate artifact directory.
