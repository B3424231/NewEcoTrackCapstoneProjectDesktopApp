# AC Energy Report exports

This inventory describes the PDF and Excel downloads on the **AC Energy Forecast** page. It documents the existing contents; the filename update does not change calculations, readings, worksheets or report sections.

## Download names and dates

Both formats use the same report name and selected observation period:

| Selection | PDF filename | Excel filename |
| --- | --- | --- |
| Daily, 29 October 2026 | `EcoTrack_AC_Energy_Report_2026-10-29.pdf` | `EcoTrack_AC_Energy_Report_2026-10-29.xlsx` |
| Weekly, 26 October to 1 November 2026 | `EcoTrack_AC_Energy_Report_2026-10-26_to_2026-11-01.pdf` | `EcoTrack_AC_Energy_Report_2026-10-26_to_2026-11-01.xlsx` |
| Monthly, October 2026 | `EcoTrack_AC_Energy_Report_2026-10-01_to_2026-10-31.pdf` | `EcoTrack_AC_Energy_Report_2026-10-01_to_2026-10-31.xlsx` |

The date in the filename identifies the selected report period, including when an older period is exported today. Period boundaries and displayed timestamps use UTC+08:00. The PDF separately records its generation timestamp. Device and time-of-day filters apply to the exported contents; they do not appear in the filename. The save dialog allows another name to be entered.

## PDF components

| Component | Contents and context |
| --- | --- |
| Cover | EcoTrack AC Energy Forecast Report title, selected AC scope, observation dates and time filter, device/reading counts, tariff, utility provider and generation timestamp. |
| Report contents | Page guide for combined analysis, Rules Management, individual AC reports and the optional future-cost plan. |
| Combined AC Energy Report | Estimated energy (kWh), estimated electricity cost (PHP), confirmed AC operation (unit-hours), device comparison and totals, energy trend, reading count, average recorded target temperature, mean wheel RPM, unconfirmed power readings and previous-period energy availability. |
| AC Device Directory | AC name and device ID, building, floor, room, AC type, local registry date and latest selected recorded connectivity status. |
| Installation Audit Availability | States that linked installation events are unavailable in this forecasting snapshot. This is an availability statement, not an installation history. |
| Rules Management Results | Recorded rule/temperature violation counts, most violated temperature location/rule, history availability and source limitations. |
| Applicable Saved Rules | Current saved rule ID, type, condition/threshold, enabled status, duration and assigned location. These settings may differ from the conditions saved in older incidents. |
| Most Violated Temperature Locations | Top ten locations ranked by recorded temperature violation counts. |
| Recent Recorded Rule Violations | Up to ten available events: timestamp, AC attribution, location, recorded condition, recorded temperature and saved message. Excel contains all available events in the selected snapshot. |
| Initial & Final AC Readings | First and last selected record per AC: timestamp, location, recorded target temperature, measured wheel RPM, battery voltage, RSSI and confirmed/unknown physical power state. |
| AC Measurement Aggregation | Per-device reading count, mean/minimum/maximum recorded target temperature, mean wheel RPM and counts of confirmed ON, confirmed OFF and unconfirmed power samples. |
| Energy Consumption Ranking | Building/floor/room ranking by available estimated kWh, PHP cost and allocation/coverage status. Missing estimates and changed locations are identified. |
| Energy and Cost by Interval | Summarized local hour/day intervals with energy, cost and coverage status. Full interval timestamps and values are in Excel. |
| AC Energy & Utility Cost Analytics | Estimated energy profile and estimated electricity-cost profile for the selected period. |
| Visual Analytics - AC Measurements | Recorded target-temperature trend and validated wheel-rotation trend in RPM, grouped by local hour/day. |
| Thermal and Airflow Indicator Analysis | Valid reading counts and minimum/mean/maximum recorded target temperature and wheel RPM. |
| Recorded Power and AC Availability | Confirmed ON/OFF and unconfirmed sample counts, plus counts of devices by their latest selected recorded connectivity status. |
| AC Predictive Analytics and Executive Summary | Model label and inputs, estimation basis, estimated energy/cost, modeled interval coverage, confirmed AC operation, selected reading/device count, previous-period availability and estimate limitations. |
| Individual AC Device Report | One report per selected device: identity, location, readings, estimated energy/cost, coverage, latest recorded connectivity, mean target temperature/RPM, ON/OFF/unknown counts and first/last readings. Includes up to five explicitly attributed violation events when available. |
| Future-cost plan (conditional) | Included when a future plan is selected. Contains plan dates, source/method, historical reference, scope, planned hours/operating days, tariff, estimated energy/cost and planned unit-hours; per-AC model inputs, rate and coverage; and daily energy/cost breakdown with totals. |

The PDF uses landscape A4 pages, section headings and page numbers. Its footer identifies energy estimates as experimental and distinguishes confirmed operation from model output. Section tables and notes remain visible when records are unavailable; page counts depend on selected devices and data volume.

## Excel components

The workbook contains **five standard worksheets**, plus **Future Plan** when a future plan is selected. Each worksheet includes a title, selected observation period, AC scope, time filter and UTC+08:00 label. Tables include filters, frozen headings/identity columns and landscape print settings.

### AC Device Analysis — 15 columns

Per-AC analysis, with the tariff and utility provider above the table:

1. AC Device ID
2. AC unit
3. Recorded location
4. Readings
5. Energy (kWh)
6. Cost (PHP)
7. Model coverage (h)
8. Mean temperature (C)
9. Min temperature (C)
10. Max temperature (C)
11. Mean Airflow Indicator (RPM)
12. Confirmed ON samples
13. Confirmed OFF samples
14. Unconfirmed samples
15. Loaded temperature violations

Available cost cells use energy × tariff formulas. Violation counts use `COUNTIFS` against the loaded Rule Violations sheet. Coverage retains its underlying numeric precision even when the displayed value is rounded or shown as less than one hour.

### Energy Intervals — 5 columns

All returned model intervals in the selected report snapshot:

1. Timestamp (UTC+08:00)
2. Energy (kWh)
3. Cost (PHP)
4. Coverage (unit-hours)
5. Estimate status

Available costs link interval energy to the tariff in AC Device Analysis. Missing intervals remain unavailable.

### Rule Violations — 13 columns

All available recorded events matching the selected dates, time filter and AC scope:

1. Event timestamp (UTC+08:00)
2. Monitoring ID
3. AC unit / attribution
4. Recorded location
5. Rule ID
6. Rule type
7. Recorded condition
8. Recorded temperature
9. Unit
10. Saved event message
11. Inbox dismissed
12. Archived locally
13. Event ID

The sheet identifies incomplete/unavailable history. Events are loaded from saved Rules Management history; export does not run live rule evaluation.

### Rule Settings — 13 columns

Current applicable saved configuration:

1. Rule ID
2. Rule type
3. Comparator
4. Value
5. Unit
6. Enabled now
7. Duration (min)
8. Start date
9. End date
10. Start time
11. End time
12. Assigned location
13. Target monitoring IDs

### Future Plan — 8 columns, conditional

Planned use is separate from recorded telemetry. Each row represents one planned day and AC, with the selected future tariff above the table:

1. Planned date
2. AC reference ID
3. AC unit
4. Planned hours
5. Historical kWh per hour
6. Planned energy (kWh)
7. Planned cost (PHP)
8. Rate availability

Available planned energy uses hours × historical energy rate; planned cost uses planned energy × tariff. Missing historical rates remain unavailable.

### Sensor Telemetry Logs — 12 columns

All selected telemetry records, including records beyond the visible page:

1. Timestamp (UTC+08:00)
2. AC Device Name
3. Building
4. Floor
5. Room
6. Attached Aircon Type
7. AC State
8. Temperature (°C)
9. Blower Fan Speed
10. Battery (V)
11. RSSI (dBm)
12. Recorded Status

Temperature is the recorded AC target setpoint. Blower Fan Speed is the recorded control setting, such as AUTO/LOW/MEDIUM/HIGH and a TURBO annotation when applicable. This column is not wheel RPM. Mean wheel RPM is provided separately in AC Device Analysis and in the PDF measurement analysis.

## Interpretation and availability

- Energy and cost are model estimates over covered intervals, not utility-meter measurements. Cost uses the selected tariff.
- Wheel RPM describes the sensing wheel's rotation. It does not establish calibrated m/s, CFM or electrical energy.
- Confirmed ON/OFF sample counts are observation counts, not continuous runtime. Confirmed operation uses recorded power feedback.
- Missing values, missing previous-period energy and unavailable installation/rule history are shown as unavailable; they are not replaced with invented readings or zero consumption.
- Future projections require a selected plan and usable historical inputs. Their inclusion does not establish future measured consumption.

## Implementation references

- `public/js/sensor-workspace.js`: selected dates/filters, the 12 telemetry columns, report capture and download filename.
- `public/js/sensor-reports.js`: PDF sections, Excel worksheets, formulas, formatting and missing-data handling.
- `public/js/report-rules.js`: saved rule/event selection and attribution.
- `public/js/future-cost.js`: conditional plan calculation and PDF sections.
