# EcoTrack capstone diagrams and data dictionary

Prepared from both application projects and read-only database metadata on 30 October 2026.

The administrator uses the desktop app; assigned staff use the mobile app. Shared application data is in Supabase. The desktop archives measurements into its own SQLite database; mobile does not connect directly to that file. The maintained hardware is ESP32-S3 with optical RPM and IR; MCP9808, pressure and battery measurement are excluded.

| Deliverable | Image | Editable source |
| --- | --- | --- |
| Level 0 DFD | [PNG](diagrams/ecotrack-dfd-level-0.png) | [SVG](diagrams/ecotrack-dfd-level-0.svg) |
| Level 1 DFD | [PNG](diagrams/ecotrack-dfd-level-1.png) | [SVG](diagrams/ecotrack-dfd-level-1.svg) |
| ERD: shared cloud core | [PNG](diagrams/erd-shared-cloud.png) | [SVG](diagrams/erd-shared-cloud.svg) |
| ERD: cloud operations | [PNG](diagrams/erd-cloud-operations.png) | [SVG](diagrams/erd-cloud-operations.svg) |
| ERD: desktop local database | [PNG](diagrams/erd-desktop-local.png) | [SVG](diagrams/erd-desktop-local.svg) |
| System architecture with EcoTrack logo | [PNG](diagrams/ecotrack-system-architecture.png) | [SVG](diagrams/ecotrack-system-architecture.svg) |
| Conceptual framework: Input–Process–Output | [PNG](diagrams/ecotrack-conceptual-framework.png) | [SVG](diagrams/ecotrack-conceptual-framework.svg) |
| UML use case diagram | [PNG](diagrams/ecotrack-use-case.png) | [SVG](diagrams/ecotrack-use-case.svg) |

The ERD distinguishes declared foreign keys from logical application references and shows key cardinalities. Selected fields appear in the figures; every captured application table and field is documented in the dictionary.

## Data dictionary

The user's capstone introduction and per-table field tables are included in the [full Markdown document](erd-and-data-dictionary.md). The dictionary records actual data types, primary/foreign/unique keys, nullability, defaults, checks, indexes and explanatory field descriptions.

| Storage | Application tables | Fields |
| --- | ---: | ---: |
| Supabase PostgreSQL, shared by both apps | 26 | 339 |
| Desktop SQLite | 16 | 118 |
| Total | 42 | 457 |

An external Supabase Auth reference documents two selected `auth.users` fields separately; they are excluded from these totals.

- [Standalone HTML with table navigation](../reports/erd-20261030/data-dictionary.html)
- [Complete field dictionary CSV](../reports/erd-20261030/data-dictionary.csv)
- [Table inventory CSV](../reports/erd-20261030/table-inventory.csv)
- [Full cloud Mermaid ERD](diagrams/erd-cloud-full.mmd)
- [Full local Mermaid ERD](diagrams/erd-local-full.mmd)

## Canva architecture

The system architecture is prepared with the actual local EcoTrack logo and the supplied icon-and-arrow arrangement. Canva tools became unavailable in this chat before a Canva design could be created; no Canva document or share link is claimed. The PNG and SVG source are ready for that step when Canva is enabled again.
