# AC Energy Forecast replacement research

Investigated 29 October 2026. Scope: a new local model for conditional energy estimates from recorded target temperature, blower fan command and operating mode; actual timestamps determine elapsed intervals and gaps. RPM remains a monitoring measurement. This note records research and a temporary benchmark, not a deployed replacement.

## Recommendation

Use **ExtraTreesRegressor** as the new settings-estimate candidate, subject to the implementation checks below. It is a different algorithm from the existing Random Forest, Histogram Gradient Boosting and XGBoost packages, fits the current tabular controls contract, and is already supplied by the installed scikit-learn dependency. The documented estimator averages randomized decision trees; constrain training resources and explicitly encode categorical fan/mode values. Its suitability here is an engineering inference supported by the benchmark, not a claim that ExtraTrees is generally the best energy forecasting algorithm. [Official estimator documentation](https://scikit-learn.org/stable/modules/generated/sklearn.ensemble.ExtraTreesRegressor.html).

**The labels remain research-generated estimates.** The available broad-control training table contains no metered energy labels. A new algorithm does not turn those targets into measured consumption. Display an estimated-energy basis and retain `physical_accuracy_validated: false` and null measured-energy/confirmed-runtime fields.

Do not add hour/day features to this training table: it has no corresponding temporal observations from which to learn their effect. Use recorded timestamps for chronology, interval duration, one-minute readiness, cadence limits, clipping and gap handling. Learned next-hour prediction requires a separate measured future-energy target and matching field inputs. Time-based evaluation matters for actual temporal datasets; shuffled splits can overstate performance. [Official time-series evaluation example](https://scikit-learn.org/stable/auto_examples/applications/plot_time_series_lagged_features.html).

## Existing-model findings

| Existing package | Inspected finding | Consequence |
| --- | --- | --- |
| `backend/ml/hemstoec_random_forest` | Selected by `backend/monitoring.py`; contemporaneous W, not future kWh. Training supports only target 21°C and explicit manufacturer fan 80%. Train has 85 ON observations; untouched test has 15 ON observations. Overall test R² .96978, but ON-only R² -.25285. | Overall scores are dominated by OFF examples. Switching algorithms cannot learn temperature/fan effects that never vary. Low/medium/high/auto fan commands cannot be converted to manufacturer percentages without evidence. |
| `backend/ml/control_only_hist_gradient_boosting` | Selected separately by `backend/app.py`; nine control features, one-hour kWh estimate; generated targets, zero measured validation hours. | Suitable input shape for the authorized settings estimate, but preserve its nonmeasurement limits when replacing it. |
| `backend/ml/control_only_random_forest`, `backend/ml/research_random_forest` | Preserved earlier generated-label models; latter additionally expects assumed environmental scenarios. | Obsolete once all active prediction callers use the replacement. |
| `backend/ml/sensor_nrel_reference` | Three saved comparison algorithms using six measured outlet-temperature lags; horizon zero. | This is a separate laboratory power-estimation task; its temperature measurements must not be replaced with AC target setpoints. |
| `models/ac_energy` and `models/ac_energy/v2` | Earlier XGBoost artifacts use room/outdoor temperature and humidity; V2 leave-one-AC-out overall R² is -.1663. | Not a substitute for the recorded-control input contract; inspect all references before retirement. |

These findings are from the current source and manifests, not new field validation. The HEMStoEC source is a residential energy-management dataset; its existing derivative documents an inferred circuit/control mapping and source interpolation. [Publisher dataset](https://zenodo.org/records/8096648). The other local measured source is an NLR/NREL HVAC laboratory dataset, not the user's installation. [Publisher dataset](https://data.nlr.gov/submissions/246).

## Verified training data and provenance

The full controls-only table exists at:

`C:/Users/reygay/Desktop/EcoTrackAppMobileNew-master-control/artifacts/control-only-prediction/benchmark/research_controls/dataset.csv`

- SHA-256: `ed3a9dd2a2eec5e78fa66d7ffbed7d34adc77d31134a13bc2fddfd62a225b3f4`.
- 18,496 original rows: train 12,320; validation 2,464; test 3,712. Existing fixed partitions hold out 20/26°C for validation and 21/24/27°C for test.
- Every row has `is_measured=False`; every `measured_energy_kwh` is blank. The target is original `estimated_energy_kwh`, not an old model's prediction.
- Features: `setpoint_c`, `fan_command`, `operating_mode`, `eco`, `turbo`, `swing`, `quiet`, `horizontal_swing`, `display`.
- Supported temperature grid: 16–30°C in whole degrees. Fan categories: auto, low, medium, high, quiet. Modes: auto, cool, heat, dry, fan. Retain the saved combination support rather than assuming every combination is valid.
- The same controls can have different labels because original scenarios include unobserved environmental variation. Do not average the targets before evaluation to make results appear more accurate.

Original archive verified present:

`C:/Users/reygay/Documents/Codex/2026-10-10/referenced-chatgpt-conversation-this-is-an/outputs/AC_Research_Estimates.zip`

Its SHA-256 `ff6dd1a862058e02f84a75a59735ea27808bd3b3be280bc9fb35c19c2aaf8d54` matches the old trained package manifest. It contains the original estimated training CSV, generator, assumptions, model card, coverage policy and source attribution. Existing runtime `assumptions.json` and `supported_inputs.json.gz` under `backend/ml/control_only_hist_gradient_boosting` describe the controls-only contract and may be retained for the replacement after verifying checksums.

The source package cites manufacturer documentation, an SGS report copy, and a fan-affinity explanation; the labels include modeled assumptions. Preserve `sources/estimator_sources.json` and source-document hashes. No verified blanket open license was established for those report/manual copies or the generated package; do not claim the separate HEMStoEC dataset's license applies to them. Keep source links and existing provenance rather than publishing copied manuals. Primary manufacturer reference linked by the package: [Haier equipment catalog](https://haierhvac.eu/sites/haierhvac-eu/files/2024-05/20240425_PF_RES_Expert-ENG_0.pdf).

## Temporary benchmark executed

Ran in the desktop project's existing Python virtual environment with scikit-learn 1.9.0. OneHotEncoder fits only on training data for fan/mode; other controls pass through numerically. Both candidates use 128 trees, `max_features=1.0`, `random_state=20261029`, `n_jobs=2`, squared-error criterion and no depth limit. All reported errors compare with generated one-hour kWh labels.

| Candidate | Validation MAE (kWh) | Validation RMSE | Test MAE | Test RMSE | Test R² | Fit seconds | Compressed pipeline bytes |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| ExtraTrees, leaf 1 — validation winner | .333223676 | .400914089 | .346450982 | .424755640 | .420888205 | 1.397 | 12,711,286 |
| ExtraTrees, leaf 2 | .333226849 | .400894703 | .346322058 | .424760045 | .420876194 | 1.172 | 12,709,013 |
| Existing fixed HGB baseline | .334073366 | .406328616 | .348168791 | .432385991 | .399894881 | Not refit | 389,359 bundle |

Select leaf 1 by validation MAE; leaf 2's slightly lower test MAE is not a selection reason. The improvement is small, while the artifact is roughly 33 times larger than the old HGB bundle. This evidence supports a new usable candidate, not a substantial physical-accuracy gain. The source splits and old baseline have already been used in earlier comparisons; they are not newly untouched field evidence.

Temporary outputs, outside production:

`C:/Users/reygay/AppData/Local/Temp/ecotrack-extratrees-candidate-tsyyqrm5/`

- `extra_trees_pipeline.joblib`: deterministic validation winner, SHA-256 `e0f25fd48bff389c7653c214a3c69d7271e70a3a11140408c734130f2409368e`.
- `benchmark.json`: parameters, package versions, baseline/candidate scores, dataset hashes and paths.
- `held_out_predictions.csv`: 3,712 test rows, exact original controls/targets and new predictions.
- `provenance.json`, `manifest.json`, `assumptions.json`, `estimator_sources.json`: original source and assumptions retained for packaging.

**Alternative considered:** CatBoostRegressor directly accepts categorical column names and supports validation/early-stopping workflows. It is a reasonable later candidate, but adds an uninstalled runtime dependency; no benchmark here establishes an advantage over ExtraTrees. [Official CatBoost API](https://catboost.ai/docs/en/concepts/python-reference_catboostregressor).

## Replacement and retirement boundary

1. Package the verified ExtraTrees pipeline with exact feature order, dependency versions, artifact/source hashes, supported combinations and original label provenance. Add a reproducible trainer using original targets. Reload the saved pipeline and reproduce test predictions.
2. Update the single `EnergyPredictor` contract, controller prediction callers and future-cost labels to the new model ID; reject old IDs clearly. Route monitoring energy through `ControlHistoryEstimator` using the new package. Preserve units, interval math, missing settings, gap/reboot/calibration and duplicate-AC safeguards.
3. Retain the shared `recorded_settings`, `target_temperature`, `epoch` and `selected_spans` utilities. In particular `control_energy.py` imports `selected_spans` from `sensor_energy.py`; deleting all of `sensor_energy.py` would break the replacement even after its old trained estimator is retired.
4. Replace affected model tests with meaningful new-model loading, checksum, version, feature-contract, recorded-settings, interval and API tests. Several existing tests import old artifact paths, and the package-manifest test explicitly names the HEMStoEC manifest. Update them before removing the old packages.
5. Only after replacement verification, remove obsolete trained artifacts under the five old nonempty `backend/ml` model directories and unused legacy `models/ac_energy` artifacts, plus empty obsolete model directories if desired. Confirm every resolved deletion path is within the project and recheck active references first. This is an inventory, not an unconditional deletion command.
6. Preserve raw datasets, real SQLite records, archived reports, source attribution and user work. Removing previous trained models does not require deleting collected history or historical benchmark evidence.

Research checks completed: source inspection; full controls CSV/provenance/hash audit; original archive presence/hash verification; two actual ExtraTrees fits; real old-baseline inference; exact winner test-prediction export. No production model, live data, dependency or deployment was changed by this research task. Field accuracy, future measured-energy validation and production replacement remain separate implementation work.
