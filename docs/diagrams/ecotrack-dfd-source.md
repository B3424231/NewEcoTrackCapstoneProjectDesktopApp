# EcoTrack data flow diagrams

Concise logical DFDs with desktop-only administrator and mobile staff; D1 groups related cloud and local records.

## Level 0 - context

<!-- mermaid:id=level_0 -->
```mermaid
flowchart LR
  Admin["Admin - desktop"]
  Staff["Staff - mobile"]
  Device["ESP32-S3 - RPM and IR"]
  P0("0. EcoTrack")
  Admin -->|"Credentials; device details; AC commands; schedules; rules; tasks; report requests"| P0
  P0 -->|"Login status; device list; logs/reports; alerts/status"| Admin
  Staff -->|"Credentials; device setup; device query; task updates; inbox actions"| P0
  P0 -->|"Login status; assigned devices; RPM/status; alerts/tasks; task status"| Staff
  P0 -->|"Setup data; AC commands; device schedule; upload ACKs"| Device
  Device -->|"RPM readings; device status; IR/results"| P0
```

## Level 1 - decomposition

<!-- mermaid:id=level_1 -->
```mermaid
flowchart LR
  Admin["Admin - desktop"]
  Staff["Staff - mobile"]
  Device["ESP32-S3 - RPM and IR"]
  D1[("D1 EcoTrack data - Supabase cloud and SQLite history")]
  P1("1.0 Authenticate users")
  P2("2.0 Register devices")
  P3("3.0 Monitor RPM")
  P4("4.0 Control AC and schedules")
  P5("5.0 Rules and notifications")
  P6("6.0 Manage maintenance")
  P7("7.0 Analyze and export logs")
  Admin -->|"Credentials"| P1
  P1 -->|"Login result"| Admin
  Admin -->|"Device details"| P2
  P2 -->|"Device list"| Admin
  Admin -->|"Node selection"| P3
  P3 -->|"RPM readings"| Admin
  Admin -->|"Control settings"| P4
  P4 -->|"Command status"| Admin
  Admin -->|"Rule settings"| P5
  P5 -->|"Alerts"| Admin
  Admin -->|"Task assignment"| P6
  P6 -->|"Work status"| Admin
  Admin -->|"Report request"| P7
  P7 -->|"Reports"| Admin
  Staff -->|"Sign-in data"| P1
  P1 -->|"Session access"| Staff
  Staff -->|"Room setup"| P2
  P2 -->|"Assigned nodes"| Staff
  Staff -->|"Status request"| P3
  P3 -->|"Live status"| Staff
  Staff -->|"Inbox actions"| P5
  P5 -->|"Notices"| Staff
  Staff -->|"Checklist / photos"| P6
  P6 -->|"Assigned tasks"| Staff
  Device -->|"Device ID"| P2
  P2 -->|"Setup config"| Device
  Device -->|"Telemetry"| P3
  P3 -->|"Upload ACK"| Device
  Device -->|"IR results"| P4
  P4 -->|"Commands / schedules"| Device
  P1 -->|"Account query"| D1
  D1 -->|"User profile"| P1
  P2 -->|"Registry changes"| D1
  D1 -->|"Saved devices"| P2
  P3 -->|"RPM logs"| D1
  D1 -->|"Latest samples"| P3
  P4 -->|"Control records"| D1
  D1 -->|"Control context"| P4
  P5 -->|"Rules / messages"| D1
  D1 -->|"Alert context"| P5
  P6 -->|"Work updates"| D1
  D1 -->|"Maintenance records"| P6
  P7 -->|"History query"| D1
  D1 -->|"Archived logs"| P7
```
