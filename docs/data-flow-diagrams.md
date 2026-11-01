# EcoTrack data flow diagrams

Updated 30 October 2026. These diagrams use the supplied examples' single-process context view for **Level 0** and seven vertically arranged processes for **Level 1**. Arrow labels use short phrases, as requested.

**Role correction supplied by the user:** administrators use the desktop application; assigned staff use the mobile application. No administrator role is shown in mobile. The software boundary includes both applications, their cloud services, the desktop backend and local data storage. The ESP32 and its optical/IR peripherals are external hardware relative to this software boundary.

## Level 0 — context

![EcoTrack Level 0 DFD](diagrams/ecotrack-dfd-level-0.png)

[Editable SVG](diagrams/ecotrack-dfd-level-0.svg)

The administrator supplies credentials, device/location registrations, assignments, controls, schedules, rules, maintenance decisions and report requests. EcoTrack returns access status, inventory, RPM/status, alerts, schedules, maintenance results and reports. Mobile staff submit credentials, assigned-room device setup, assigned-device queries, maintenance work and notification actions; they receive only permitted devices, readings, alerts and tasks. Staff registration/provisioning stays within the server-assigned room and does not imply an administrator role in mobile.

The ESP32 receives Bluetooth provisioning settings, AC control intent, device reporting/wake/sleep configuration and measurement-upload acknowledgments. It returns its identity, rotation RPM, heartbeat, captured IR signals, command/provisioning results and applied configuration. Rules run within the software/cloud boundary; the diagram does not claim that arbitrary alert rules are downloaded to firmware.

## Level 1 — decomposition

![EcoTrack Level 1 DFD](diagrams/ecotrack-dfd-level-1.png)

[Editable SVG](diagrams/ecotrack-dfd-level-1.svg) · [Editable Mermaid sources](diagrams/ecotrack-dfd-source.md) · [Canonical source](diagrams/ecotrack-dfd.canonical.json)

The revised Level 1 diagram uses aligned connectors, dark lines and filled arrowheads. Each flow has a short, distinct label. Small bridges separate crossing lines; they are not junctions. The same seven processes and 44 source-to-destination connections are retained.

| Process | Responsibility | Data within the grouped store |
| --- | --- | --- |
| 1.0 | Authenticate users and enforce role/room access | Supabase Auth and profiles |
| 2.0 | Register devices and manage locations, bindings and assignments; serve assigned inventory | Supabase registry |
| 3.0 | Receive live data, archive observations and display permitted monitoring | Cloud live state/temporary telemetry and desktop SQLite history |
| 4.0 | Queue supported AC commands and apply AC/device schedules | Cloud commands, schedules and IR profiles |
| 5.0 | Evaluate rules and maintain permitted notification inboxes | Cloud rules, notifications, device readings and audit events |
| 6.0 | Assign maintenance, accept staff checklists/photos and record administrator review | Cloud maintenance records and image storage |
| 7.0 | Analyze retained observations and export desktop reports | SQLite recorded history and required cloud metadata |

The Level 1 layout follows the second supplied example: users and hardware on the left, numbered processes down the centre, and data storage on the right. D1 is a logical group of EcoTrack data stores, not a claim that cloud Supabase and local SQLite are one physical database. Storage remains physically separate: mobile uses permitted cloud records, and desktop historical reports use SQLite. The diagram simplifies related record flows; the table above identifies their actual destinations.

## Hardware and storage interpretation

- The maintained hardware uses an ESP32-S3, optical rotation input on GPIO40 with a 20-notch wheel, IR receiver on GPIO4, IR transmitter on GPIO5, Wi-Fi and Bluetooth.
- MCP9808, measured outlet temperature, pressure sensing and battery measurement are excluded from the current hardware diagram. GPIO47/48 are not initialized by the revised firmware.
- New cloud measurements keep `outlet_temperature_c: null`. AC target-temperature commands remain supported and must not be presented as measured temperature. Existing queued readings and historical temperature records keep their original contents.
- Rotation RPM and heartbeat connectivity do not prove AC power, compressor runtime or measured kWh. IR acknowledgment confirms the device's command handling, not the physical AC's reception.
- Durable measurement flow is **optical sensor → ESP32 buffer → Supabase temporary telemetry → verified desktop SQLite archive → monitoring/report APIs**. The backend acknowledges exact cloud readings only after archival; cloud rows are a delivery bridge rather than the permanent archive.
- Mobile uses permitted shared cloud records. The diagram does not add a direct mobile connection to desktop SQLite.
- Temperature-based sensor-energy estimates are unavailable for new readings without measured temperature. Control-history estimates retain their existing input/coverage requirements and remain estimates.

The current source was inspected in both application projects. Physical wiring and firmware installation are separate from these diagrams and source compilation.
