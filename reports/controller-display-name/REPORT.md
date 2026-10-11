The Control Schedules AC Control Name column and Dynamic Aircon Control heading/selector now use the linked controller Display Name from nodes.name. Matrix previously came from the separate aircons.name/brand fields. The duplicate brand badge was removed from the active Control heading. Generated ESP32 default names use the AC Controller placeholder until an admin saves a custom display name.

The existing controller save/sync events refresh these labels. Controller identity, AC asset tags, profile names, manufacturer/protocol data, IR handling, scheduling and command targets remain intact. Custom names are rendered as text or escaped before the schedule template. The scheduler script cache version advanced to 24.

Observed validation:
- Six-page integration: 41 checks passed.
- Node schedule logic: 10 checks passed.
- Native production Control/dashboard: 8 scenario groups passed.
- Native schedule renderer: 22 checks passed across light/dark themes.
- Project npm test: 34 checks passed.
- Modified JavaScript syntax checks passed.

Native tests use local fixtures, including a controller name distinct from Matrix and a saved-name update. The screenshot is a fixture, not the connected user's hardware.
