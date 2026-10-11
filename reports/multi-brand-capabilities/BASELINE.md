# Baseline and audit

Observed before implementation: receiver capabilities 17 checks, immediate IR events 14, cloud/Bluetooth client 47, registration progress 27, all passed.

Physical remote -> capture queues -> IRremoteESP8266 decodeToState -> immediate ecotrack_device_observe -> device_state.latest_ir -> private Broadcast/Postgres Changes -> shared hardware overlay -> page handlers.

UI -> CommandManager -> ecotrack_cloud_request -> persisted per-device queue -> authenticated device_exchange -> IRac transmitter -> transmitted acknowledgement. This acknowledgement does not confirm physical AC operation.

Audit findings: brand substring resolution loses exact variants; receiver manifest is TCL-only; firmware/SQL limits are universal 16..32; legacy UI capability fallback invents Midea controls; remote model is omitted; receiver metadata can override higher-confidence manual profiles; capability provenance is absent. Existing TCL auxiliary/full-frame OFF protection must remain intact.

The installed library is IRremoteESP8266 2.9.0. No physically verified model profiles were supplied; verified_models starts empty. Audited library models are not labeled physically verified. No credentials were inspected or changed.
