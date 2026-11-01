# Extra Trees AC settings estimator

This package estimates conditional one-hour energy from AC target temperature, blower fan command, operating mode and optional recorded function flags. It uses `ExtraTreesRegressor` from the existing scikit-learn installation. Run `venv\Scripts\python.exe scripts/train_extra_trees_energy.py` from the project root to reproduce training, validation selection, held-out predictions and checksums.

The 18,496-row training table is `datasets/control_energy_reference/research_controls.csv`, copied unchanged from the original controls-only research benchmark. Source SHA-256: `ed3a9dd2a2eec5e78fa66d7ffbed7d34adc77d31134a13bc2fddfd62a225b3f4`. The upstream `AC_Research_Estimates.zip` archive SHA-256 is `ff6dd1a862058e02f84a75a59735ea27808bd3b3be280bc9fb35c19c2aaf8d54`. Attribution and source-document hashes are retained in `datasets/control_energy_reference/estimator_sources.json`.

**These targets are research-generated estimates, not measured electricity.** Model error measures agreement with those estimates. Physical accuracy and equipment-specific electricity consumption are unvalidated. Temperature means the recorded AC target setpoint. Recorded timestamps determine elapsed coverage, cadence, filters and gaps; the model has no learned hour-of-day or weekday effects. RPM is not a model feature. Power commands and modeled intervals do not establish confirmed runtime.

The supported temperature grid is 16–30°C in whole degrees; fans are Auto, Low, Medium, High and Quiet; modes are Auto, Cool, Heat, Dry and Fan. Only combinations in the saved support are accepted. Missing core settings stay unavailable; missing optional flags are averaged over supported variants. Unsupported AC features and other equipment/capacity scaling require new evidence.

Source limitations and model comparison are documented in `docs/research/2026-10-29-ac-energy-model.md`. No blanket open license was verified for the original research estimate package or its cited manual/report copies; the separate retired HEMStoEC dataset license does not apply to this package.
