# TCL power capture correction — 2026-10-09

The user confirmed that the physical AC turns off while the existing Serial output continues to report power ON. Those logs contain no packet bytes, so they do not establish the exact OFF message type or whether the OFF packet was decoded.

Source inspection found three capture/reporting problems:
- TCL toCommon(prev) retains previous power, temperature, mode and fan for an auxiliary message. The sketch published those inherited fields as a fresh state.
- The IRrecv instance uses save_buffer=true. decode() rearms the receiver itself; the additional resume() can clear the following frame.
- Capture consumption runs in the same main loop as blocking HTTPS requests, whose connection and response waits each allow five seconds.

The delivered separate sketch is now cloud-ir-controller-1.5-rxtx. A dedicated capture task copies actual receiver frames while HTTPS runs. Separate one-item queues retain the latest full AC packet and latest raw packet, so a trailing auxiliary/unknown packet cannot evict a decoded OFF. The task and main loop serialize receiver access, including transmitter pause and sleep. Queued frames drain before scheduled sleep. No extra resume() is used.

TCL Type 1 packets supply fresh power state; auxiliary TCL packets do not publish inherited power. A following TCL block in a combined capture is checked using public timing matchers, the 23 CB 26 prefix and the installed library checksum. The external library was not edited. Bluetooth gets fresh protocol metadata during a cloud wait; cloud state is serialized by the main loop.

Serial output now includes the full packet state, bit count, sequence, TCL message type, raw power bit and capture age. UNKNOWN captures also print their actual timings with IR_DEBUG_RAW=true. This switch can be turned off after diagnosis. Wi-Fi credentials and tokens are not printed.

The shared UI helper rejects auxiliary state fields and prefers the actual valid capture timestamp over a delayed server receipt, falling back when the device clock is implausibly in the future. Existing automatic updates remain active.

Observed verification:
- Final Heltec build passed: 1,545,312 / 3,342,336 program bytes; 57,348 / 327,680 static RAM bytes. Runtime queues/task also allocate heap. Delivered and compiled source SHA-256 match.
- Six-page fixture integration: 39 checks passed, including a full OFF followed by auxiliary old ON fields and delayed capture ordering.
- Native browser live updates: 5 checks passed; ON to OFF updated in 4,986 ms without real-time delivery or a reload.
- Core engine: 38 checks passed; hardware client: 40; hardware UI: 11; hardware-control regression passed.
- Embedded/standalone helpers match; added-line whitespace checks passed.

Physical verification is pending. No firmware-directory files, Arduino library files, live database rows, Windows pairing or physical hardware were changed. No firmware was uploaded by the agent.

Upload [the separate sketch](C:/Users/reygay/Desktop/EcoTrackDesktopDashboardNew-main-control/reports/cloud-hardware/EcoTrackCloudReceiver.ino.txt), then restart EcoTrack once. Press physical remote ON once and OFF once. For a recognized OFF, Serial should show Decoded remote state: power off and TCL frame: type 1 | raw power off. If it still says ON or UNKNOWN, provide the Captured IR line containing state 0x..., the TCL frame line, and IR raw timings for that OFF press. The exact packet is required to distinguish a remaining capture problem from an unsupported remote variant.

References:
- [Installed upstream TCL decoder semantics](https://github.com/crankyoldgit/IRremoteESP8266/blob/master/src/ir_Tcl.cpp)
- [Saved-buffer receiver behavior](https://github.com/crankyoldgit/IRremoteESP8266/blob/master/src/IRrecv.cpp)
- [Upstream normal OFF and auxiliary frame examples](https://github.com/crankyoldgit/IRremoteESP8266/blob/master/test/ir_Tcl_test.cpp)
