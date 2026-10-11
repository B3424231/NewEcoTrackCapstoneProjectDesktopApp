# Node schedule time display and Apply validation

A newly registered cloud controller has NULL wake_time and sleep_time with a five-second report interval. The previous display function substituted 05:00 AM for missing values and for times it could not parse, while hidden inputs remained blank. Apply correctly rejected blank clocks but gave a combined error that also blamed the valid report interval.

Before correction, the production formatter was executed against null and 22:00:00; both displayed 05:00 AM.

## Corrections

- Missing times display Not set; malformed nonempty values display Invalid time.
- HH:mm and HH:mm:00 (including zero fractional seconds) normalize to the firmware's HH:mm contract. Nonzero seconds and invalid clocks are rejected rather than rounded.
- The time picker preserves valid stored times instead of replacing them with 5 AM.
- Apply identifies a missing/invalid wake or sleep field and focuses its time control. Interval errors use a separate specific message.
- A five-second interval is accepted with valid chosen times.
- Equal explicitly chosen wake and sleep times remain valid, matching the sketch's existing rule that scheduled sleeping is disabled. A row note explains this behavior.
- Times normalize in the queued request and local inputs only after the queue write succeeds. Queued does not imply Applied; the existing receipt check remains required.
- scheduler.js cache version is 19. Wake/sleep cells align at the top, so the equal-time note does not lower Wake Time. Live updates preserve typed schedule drafts until Apply.

## Observed verification

scripts/test_node_schedule_times.js: 10 grouped checks passed.
scripts/test_node_schedule_times_render.js: 18 checks passed across light/dark, including alignment with the equal-time explanation.
scripts/test_cloud_hardware_ui.js: 11 checks passed.
scripts/test_page_connections.js: 37 checks passed, including automatic remote OFF/ON, receipt refresh and paused draft preservation.
JavaScript syntax and task-added whitespace checks passed.

Native renderer evidence includes the actual production row and time-picker functions with mocked cloud requests and blocked HTTP(S). Screenshots: unset-times-light.png, unset-times-dark.png, equal-times-light.png and equal-times-dark.png.

No live database writes or hardware schedule requests were performed. The time-display change uses the existing hardware time contract. The separate automatic-state and command-retention follow-up is documented in reports/remote-power and reports/command-retention.

## Use

Restart EcoTrack from this project. Set the wake and sleep times explicitly, retain the desired report interval, and select Apply. Equal times disable scheduled sleeping. Delivery shows Queued until the real ESP32 acknowledges matching settings.

The preceding Bluetooth fix is also included: Reconnect reuses an existing session, retries safe discovery once, refreshes status and actual firmware after fresh replies, and keeps the separate Choose ESP32 again action. Its evidence is in reports/live-bluetooth.
