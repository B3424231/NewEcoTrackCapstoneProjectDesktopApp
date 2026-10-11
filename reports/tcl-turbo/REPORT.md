# Receiver-driven Turbo controls

Implemented on 2026-10-10 in the desktop workspace.

The received IR protocol and its capability manifest now take priority over manually selected brands and old cached capabilities. A valid TCL112AC capture enables the Turbo control under Special Functions. High is a normal fan speed; Turbo is an independent decoded flag. The dashboard and Control Schedules show the same distinction. Received state updates automatically through the existing Supabase events and five-second fallback.

The separate Arduino copy-paste sketch is now `cloud-ir-controller-1.6-rxtx`. It uploads decoded Turbo, Swing, Eco and Sleep flags in `latest_ir.state`. TCL112AC captures also publish `latest_ir.ac_capabilities`: supported modes, fan speeds, temperature limits and special functions. Controls not implemented by the TCL sender are excluded. Other recognized protocols continue to use the catalog for the received protocol unless a capture supplies a manifest. A manufacturer name alone does not enable TCL Turbo.

Compatibility with version 1.5: complete, checksummed TCL normal packet hex can recover the independent Turbo/Swing/Eco bits. Truncated, corrupt, auxiliary and undecoded packets never invent a Turbo state. The old `fan:"turbo"` value is normalized to High for TCL112AC. Missing feature values stay unknown. Noise retains the last complete observation and capability information.

Manual protocol overrides that contradict a valid receiver observation are rejected before creating a cloud command. Unknown flags are omitted from outgoing requests; the updated sketch preserves previously decoded special settings when an optional flag is absent. Supabase command requests remain distinct from remote observations and transmission receipts.

The decoder implements High and Turbo separately, as shown in the primary [IRremoteESP8266 TCL decoder](https://github.com/crankyoldgit/IRremoteESP8266/blob/master/src/ir_Tcl.cpp). The transmitted TCL feature set follows [IRac::tcl112](https://github.com/crankyoldgit/IRremoteESP8266/blob/master/src/IRac.cpp).

## Verification

| Check | Result |
| --- | --- |
| Receiver capability/state and command regressions | 17 passed across six independent page engines |
| Six-page integration | 39 passed |
| Native Chromium production controls/dashboard | 9 passed, light and dark |
| Shared control engine | 38 passed |
| Cloud/BLE client | 40 passed |
| Hardware UI/IPC | 11 passed |
| Hardware command transport regression | Passed |
| Mock-data integrity | 34 passed |
| JavaScript syntax | Passed |
| Heltec Wireless Stick Lite V3 compile | Passed |

The native test waits for the received Turbo flag and Remote ON label independently of the requested preview. Its observed update took 4,984 ms with real-time events absent. Received OFF clears Turbo automatically. Changing the receiver manifest hides unsupported Turbo. The screenshots use an isolated fixture with production rendering logic, mocked cloud reads and commands, and blocked external network requests.

Sketch compile: 1,546,824 / 3,342,336 bytes of program storage (46%); 57,348 / 327,680 bytes of static RAM (17%). Delivered text and compiled scratch source have the same SHA256:
`1fa728389021611d654a868da2beb9dc4fbc33bed52931d272e9190b8eff7f85`.

No live database writes or migrations were performed. No ESP32 upload, physical IR transmission or physical AC execution was tested. The firmware directory was not edited.

## Apply and check on hardware

1. Copy `reports/cloud-hardware/EcoTrackCloudReceiver.ino.txt` into Arduino IDE and upload version 1.6 to your board.
2. Restart EcoTrack once to load the updated desktop assets.
3. Point the physical remote at the receiver and enable Turbo. Serial should show a separate `turbo on` field. Control should activate Turbo, and the dashboard should show `HIGH · TURBO`.
4. Disable Turbo on the physical remote. Serial should show `turbo off`; the interface should update automatically without a page reload.

The tests and screenshots are in `reports/tcl-turbo`. Targeted before copies and diffs are retained there for review.
