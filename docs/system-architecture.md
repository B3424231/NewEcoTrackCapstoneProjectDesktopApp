# EcoTrack system architecture

![EcoTrack system architecture](diagrams/ecotrack-system-architecture.png)

This architecture follows the supplied white-background, icon-and-arrow example, using the actual EcoTrack logo and current implementation. Each input and output has a separate one-way arrow. The arrowhead points to the receiving component, and short labels identify the data being transferred.

- The administrator uses the Electron desktop GUI. It accesses Supabase for authentication, registry/configuration, rules, notifications and maintenance, and the local Flask APIs for retained history, analytics and exports.
- Assigned staff use the Expo/React Native mobile app and permitted Supabase records. Staff can provision/register devices within their assigned room. There is no administrator role shown in mobile and no direct mobile-to-SQLite connection.
- Bluetooth commissions the ESP32 from either application. Normal device exchanges use authenticated Wi-Fi HTTPS cloud requests, with measured RPM, heartbeats, captured IR observations, command results and applied configuration.
- Supabase stores shared application records and temporary telemetry. The desktop Flask backend imports verified telemetry into SQLite, then acknowledges exact cloud payloads after archival. Reporting uses recorded history rather than making up readings.
- The ESP32 sends IR commands to the AC and reads the passive optical rotation sensor. Rotation and command acknowledgment do not establish physically confirmed AC power or measured electricity consumption.

The main hardware flows are: cloud to ESP32 for commands and schedules; ESP32 to cloud for readings and results; ESP32 to AC for infrared commands; fan rotation to the optical sensor as a physical input; and optical sensor to ESP32 for RPM pulses. Mobile and desktop Bluetooth setup use independent dashed routes. Cloud archival and database history also have separate directional arrows.

The maintained firmware excludes MCP9808/measured-temperature input, pressure and battery sensing. LoRa, a separate IoT gateway and serial transport from the supplied historical example are not part of the current implementation.

[Editable SVG](diagrams/ecotrack-system-architecture.svg). The PNG is also prepared for conversion into an editable Canva design, as requested.
