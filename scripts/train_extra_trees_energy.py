"""Train the AC settings estimator on original research estimates, never live records."""
import argparse
import gzip
import hashlib
import importlib.metadata
import json
import platform
from datetime import datetime, timezone
from pathlib import Path

import joblib
import numpy as np
import pandas as pd
from sklearn.compose import ColumnTransformer
from sklearn.ensemble import ExtraTreesRegressor
from sklearn.metrics import mean_absolute_error, mean_squared_error, r2_score
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import OneHotEncoder

ROOT = Path(__file__).resolve().parents[1]
FLAGS = ['eco', 'turbo', 'swing', 'quiet', 'horizontal_swing', 'display']
FEATURES = ['setpoint_c', 'fan_command', 'operating_mode', *FLAGS]
SEED = 20261029


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def write_json(path, value):
    path.write_text(json.dumps(value, indent=2) + '\n', encoding='utf-8')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--data', type=Path, default=ROOT/'datasets/control_energy_reference')
    parser.add_argument('--output', type=Path, default=ROOT/'backend/ml/control_extra_trees')
    parser.add_argument('--reports', type=Path, default=ROOT/'reports/extra-trees-energy/artifacts')
    args = parser.parse_args()
    metadata = json.loads((args.data/'source_metadata.json').read_text(encoding='utf-8'))
    source = args.data/'research_controls.csv'
    if digest(source) != metadata['source_dataset_sha256']:
        raise ValueError('Research dataset checksum mismatch; review the source before training.')
    frame = pd.read_csv(source)
    if (len(frame) != 18496 or frame.is_measured.any() or frame.measured_energy_kwh.notna().any()
            or not frame.duration_h.eq(1).all() or frame[FEATURES].isna().any().any()
            or not np.isfinite(frame.estimated_energy_kwh).all()):
        raise ValueError('Unexpected training source or target provenance.')
    train, validation, test = [frame.loc[frame.split.eq(part)].copy() for part in ['train', 'validation', 'test']]
    if [len(train), len(validation), len(test)] != [12320, 2464, 3712]:
        raise ValueError('The original held-out split must remain unchanged.')
    for name in ['setpoint_c', *FLAGS]:
        for split in [train, validation, test]:
            split[name] = split[name].astype(float)
    candidates = []
    for leaf in [1, 2]:
        preprocessing = ColumnTransformer([
            ('categories', OneHotEncoder(handle_unknown='error', sparse_output=False), ['fan_command', 'operating_mode']),
            ('numbers', 'passthrough', ['setpoint_c', *FLAGS])])
        pipeline = Pipeline([('preprocessor', preprocessing), ('regressor', ExtraTreesRegressor(
            n_estimators=128, min_samples_leaf=leaf, random_state=SEED, n_jobs=2))])
        pipeline.fit(train[FEATURES], train.estimated_energy_kwh)
        score = float(mean_absolute_error(validation.estimated_energy_kwh, pipeline.predict(validation[FEATURES])))
        candidates.append((score, leaf, pipeline))
    score, leaf, selected = min(candidates, key=lambda candidate: candidate[0])
    predicted = np.maximum(0, selected.predict(test[FEATURES]))
    target = test.estimated_energy_kwh.to_numpy()
    metrics = dict(mae=float(mean_absolute_error(target, predicted)), mse=float(mean_squared_error(target, predicted)),
                   rmse=float(np.sqrt(mean_squared_error(target, predicted))), r2=float(r2_score(target, predicted)))
    versions = {name: importlib.metadata.version(name) for name in ['scikit-learn', 'joblib', 'numpy', 'scipy', 'pandas']}
    args.output.mkdir(parents=True, exist_ok=True)
    args.reports.mkdir(parents=True, exist_ok=True)
    bundle = dict(model=selected, features=FEATURES, algorithm='ExtraTreesRegressor', input_scope='controls_only',
                  training_data_type='research_informed_estimates', physical_accuracy_validated=False, versions=versions)
    joblib.dump(bundle, args.output/'model.joblib', compress=3)
    support = sorted({tuple(float(row[name]) if name == 'setpoint_c' else int(row[name]) if name in FLAGS else row[name]
                            for name in FEATURES) for row in frame[FEATURES].to_dict('records')})
    with gzip.open(args.output/'supported_inputs.json.gz', 'wt', encoding='utf-8') as stream:
        json.dump(support, stream)
    assumptions = json.loads((args.data/'assumptions.json').read_text(encoding='utf-8'))
    assumptions['timestamp_role'] = 'Observed elapsed intervals, cadence, grouping and gaps; no learned time-of-day or weekday effect.'
    write_json(args.output/'assumptions.json', assumptions)
    predictions = test[['record_id', *FEATURES]].copy()
    predictions['generated_target_kwh'] = target
    predictions['extra_trees_estimated_kwh'] = predicted
    predictions.to_csv(args.reports/'held_out_predictions.csv', index=False, float_format='%.17g')
    test[['record_id', *FEATURES]].to_csv(args.reports/'control_test_inputs.csv', index=False)
    restored = joblib.load(args.output/'model.joblib')['model'].predict(test[FEATURES])
    if not np.allclose(restored, predicted, atol=1e-12, rtol=0):
        raise ValueError('Saved model predictions do not match evaluation.')
    manifest = dict(model='extra_trees', algorithm='ExtraTreesRegressor', reference_model=metadata['reference_model'],
        trained_utc=datetime.now(timezone.utc).isoformat(), python_version=platform.python_version(), versions=versions,
        features=FEATURES, control_features=FEATURES, output_unit='kWh', horizon_hours=1,
        training_data_type='research_informed_estimates', evaluation_kind='held_out_generated_formula_targets',
        physical_accuracy_validated=False, measured_validation_hours=0, input_scope='controls_only',
        environment_source='not_used', environment_scenarios=[], limitations=metadata['limitations'],
        timestamp_role=assumptions['timestamp_role'], selection_metric='validation_mae',
        validation_candidates=[dict(min_samples_leaf=item[1], validation_mae_kwh=item[0]) for item in candidates],
        validation_mae_kwh=score, train_rows=len(train), validation_rows=len(validation), test_rows=len(test),
        test_metrics=metrics, selected_configuration=selected.named_steps['regressor'].get_params(),
        source_dataset_sha256=metadata['source_dataset_sha256'], dataset_sha256=metadata['dataset_sha256'],
        mean_baseline_test_mae_kwh=metadata['mean_baseline_test_mae_kwh'],
        artifacts={name:digest(args.output/name) for name in ['model.joblib', 'supported_inputs.json.gz', 'assumptions.json']},
        report_artifacts={name:digest(args.reports/name) for name in ['held_out_predictions.csv', 'control_test_inputs.csv']})
    write_json(args.output/'manifest.json', manifest)
    print(json.dumps(dict(model='extra_trees', validation_mae_kwh=score, test_metrics=metrics,
                          selected_leaf_size=leaf, physical_accuracy_validated=False, saved_predictions_verified=True), indent=2))


if __name__ == '__main__':
    main()
