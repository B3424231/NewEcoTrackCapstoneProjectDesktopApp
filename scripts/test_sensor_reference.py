"""Timestamp clipping regressions retained after retiring laboratory AI models."""
from datetime import datetime, timezone
from pathlib import Path
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from backend.sensor_energy import selected_spans


class TimestampTests(unittest.TestCase):
    def setUp(self):
        self.start = datetime(2026, 10, 18, tzinfo=timezone.utc).timestamp()

    def test_selected_bounds_preserve_fractional_elapsed_seconds(self):
        t = self.start
        self.assertEqual(selected_spans(t, t+120, t+20.5, t+90.25), [(t+20.5, t+90.25)])

    def test_overnight_window_uses_singapore_clock_and_selected_dates(self):
        t = self.start
        self.assertEqual(selected_spans(t, t+86400, t, t+86400, ('23:00', '01:00')),
                         [(t+15*3600, t+16*3600), (t+16*3600, t+17*3600+60)])

    def test_disjoint_and_empty_intervals_have_no_energy_coverage(self):
        t = self.start
        self.assertEqual(selected_spans(t, t+60, t+120, t+180), [])
        self.assertEqual(selected_spans(t, t, t, t+60), [])


if __name__ == '__main__':
    unittest.main(verbosity=2)
