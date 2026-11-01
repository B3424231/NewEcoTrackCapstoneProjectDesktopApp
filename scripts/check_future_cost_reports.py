"""Inspect isolated future-cost exports. Never reads live telemetry or configuration."""
import json
import os
import re
import shutil
import subprocess
import sys
from pathlib import Path

import pdfplumber
from openpyxl import load_workbook
from pypdf import PdfReader

folder = Path(os.environ.get("ECOTRACK_FUTURE_COST_REPORT_DIR") or
              Path(__file__).resolve().parents[1] / "reports" / "future-cost").resolve()
renderer = sys.argv[1] if len(sys.argv) > 1 else shutil.which("pdftoppm")
if renderer and not (Path(renderer).is_file() or shutil.which(renderer)):
    raise FileNotFoundError(f"PDF renderer was specified but is unavailable: {renderer}")
checks = []
for scenario in ("future", "empty-history-future"):
    filename = folder / f"sensor-{scenario}.pdf"
    reader = PdfReader(filename)
    texts = [page.extract_text() or "" for page in reader.pages]
    first = next(i for i, text in enumerate(texts) if "Future Cost Projection" in text)
    future = "\n".join(texts[first:])
    assert "Future Cost Projection - Sensor" in future
    assert "Future Cost - AC Inputs and Coverage" in future
    assert "Future Cost - Daily Breakdown" in future
    assert "Planned AC unit-hours" in future
    assert "XGBoost" in future
    assert "Histogram Gradient Boosting" not in future
    assert "Controller Fixture" not in future
    assert "future temperatures and consumption are not forecast" in future
    assert "NaN" not in future and "Infinity" not in future
    if scenario == "future":
        assert "2026-10-21 to 2026-10-27" in future
        assert "Planned AC unit-hours 56" in future
        assert "Predicted energy (kWh) 20.5036" in future
        assert "Estimated cost (PHP) 271.47" in future
        assert "TOTAL 20.5036 271.47" in future
        assert len(re.findall(r"^2026-10-\d{2} 8 2\.9291 38\.78$", future, re.M)) == 7
    else:
        assert "2026-11-01 to 2026-11-30" in future
        assert "Planned AC unit-hours 240" in future
        assert "Predicted energy (kWh) Unavailable" in future
        assert "Estimated cost (PHP) Unavailable" in future
        assert "TOTAL Unavailable Unavailable" in future
        assert "No eligible temperature-model coverage" in future
        assert len(re.findall(r"^2026-11-\d{2} 8 Unavailable Unavailable$", future, re.M)) == 30
    with pdfplumber.open(filename) as pdf:
        for page in pdf.pages[first:]:
            assert all(5 < char["x0"] < char["x1"] < page.width - 5
                       and 5 < char["top"] < char["bottom"] < page.height - 5
                       for char in page.chars if char["text"].strip()), filename
    rendered = []
    if renderer:
        for index in sorted({first, first+1, first+2, len(texts)-1}):
            output = folder / f"sensor-{scenario}-page-{index+1}"
            subprocess.run([renderer, "-f", str(index+1), "-l", str(index+1),
                            "-r", "100", "-png", "-singlefile", str(filename), str(output)],
                           check=True, capture_output=True)
            assert output.with_suffix(".png").is_file()
            rendered.append(index+1)
    (folder / f"sensor-{scenario}.txt").write_text("\n".join(texts), encoding="utf-8")
    checks.append({"file": filename.name, "status": "PASS", "pages": len(texts),
                   "future_starts_at": first+1, "text_bounds": "PASS",
                   "rendering": "PASS" if renderer else "NOT RUN: pdftoppm unavailable",
                   "rendered_pages": rendered})
workbook = load_workbook(folder / "sensor-history.xlsx", data_only=True)
cells = " ".join(str(cell.value) for sheet in workbook for row in sheet for cell in row)
assert workbook.sheetnames == ["AC Device Analysis", "Energy Intervals", "Rule Violations", "Rule Settings", "Future Plan", "Sensor Telemetry Logs"]
assert "Histogram Gradient Boosting" not in cells
assert "Controller Fixture" not in cells
assert "AC Inputs and History Coverage" not in cells
assert "Future Cost - Daily Breakdown" not in cells
plan = workbook["Future Plan"]
energy = sum(plan.cell(row,6).value for row in range(8,plan.max_row+1))
cost = sum(plan.cell(row,7).value for row in range(8,plan.max_row+1))
assert energy > 0 and abs(cost-energy*13.24) < 1e-8
logs = workbook["Sensor Telemetry Logs"]
assert logs.max_row == 28 and logs.max_column == 12
assert logs.freeze_panes == "C5"
assert all(logs.cell(row, 1).value.date().isoformat() == "2026-10-20" for row in range(5, 29))
assert all(logs.cell(row, 7).value == "Unknown" for row in range(5, 29))
assert all(logs.cell(row, 2).value == "Monitoring Fixture Node" for row in range(5, 29))
assert workbook["AC Device Analysis"]["E8"].value > 0
checks.append({"file": "sensor-history.xlsx", "status": "PASS",
               "contents": "24 unchanged historical AC readings plus separate AC analysis, intervals and the matching sensor future-cost plan; physical power unconfirmed"})
(folder / "pdf-excel-verification.json").write_text(json.dumps(checks, indent=2))
print("PASS two current AC PDFs: model/source, future periods, missing history, daily totals and text bounds; combined AC Excel export")
print("PASS projection PDF rendering" if renderer else "NOT RUN projection PDF rendering: pdftoppm unavailable")
