# Device setup UI and admin permissions

Verified administrators now display **Full Access**. The login flow stores the role as `Administrator`, while the profile previously recognized only the exact string `admin`. The profile now checks the existing authenticated `ecotrack_is_admin` RPC on every load, including cached profile loads, and uses consistent role presentation. A denied check shows Limited Access; an unavailable check shows Access unverified. Backend authorization was preserved.

**Read Device IP** now displays a reading state and spinner, prevents repeated requests, and gives inline confirmation with the actual IP only after the selected ESP32 replies over Bluetooth. Missing Wi-Fi, invalid addresses, mismatched hardware, errors, and a 12-second timeout remain visible. Selecting another controller, reopening setup, or closing setup invalidates late replies. Reading an IP does not mark Supabase registration verified.

The native Bluetooth picker is centered, adapts to narrow screens, follows the light/dark theme, and has readable device choices, a separate Cancel button, a close button, accessible labels, and initial keyboard focus. Escape closes the picker without closing the registration wizard beneath it. Normal pairing and legacy PIN validation are preserved.

Changed application files:
- `public/js/profile.js`
- `public/profile.html`
- `public/nodes.html`
- `public/js/hardware-cloud.js`
- `public/styles.css`

Observed checks:
- `node scripts/test_device_setup_feedback.js`: 11 checks passed.
- `node scripts/test_cloud_hardware_ui.js`: 11 checks passed.
- `node scripts/test_registration_progress.js`: 17 checks passed.
- `node scripts/test_cloud_hardware_client.js`: 17 checks passed.
- `node scripts/test_page_connections.js`: 23 checks passed.
- `node scripts/test_aircon_system.js`: 38 checks passed.
- `electron scripts/test_device_setup_render.js`: four isolated production-component views passed. Tested light/dark themes on desktop and narrow viewports, readable text contrast, centering, selection, cancellation, and Escape. PNG evidence and measurements are in this folder.
- JavaScript syntax checks passed for the changed standalone scripts; the existing UI test parsed the page inline scripts.

Live app automation was unavailable because the computer-use runtime failed initialization with `helper_unknown_error: setup refresh had errors`. Rendering used a hidden Electron window with the actual production component code and stylesheet, synthetic device choices, a separate session, and blocked network access. This does not verify a live ESP32 connection or the current signed-in account's Supabase permissions.

No live database writes, device commands, or firmware changes were made. The receiver sketch SHA-256 remains `8e50dc7e7e7e5049bb4e7e03f693ec1d92e728b4c85702e0583b7002461768c1`.

Reload EcoTrack to load the updated UI. Backups and a scoped diff are retained in this folder.
