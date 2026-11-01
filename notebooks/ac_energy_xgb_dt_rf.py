# %% [markdown]
# # EcoTrack: XGBoost, Decision Tree and Random Forest
#
# Train and compare **five-minute experimental AC energy forecasts** on a published
# mini-split experiment. This notebook downloads the original data automatically.
# CPU runtime is sufficient. In Google Colab, select **Runtime → Run all**.
#
# **Source:** Ramírez, H., Jiménez-Cabas, J. and Bula, A. (2019),
# *Experimental data for an air-conditioning system identification*, Data in Brief
# 25, 104316. [Paper](https://doi.org/10.1016/j.dib.2019.104316).
# [Original Excel supplement](https://ars.els-cdn.com/content/image/1-s2.0-S2352340919306705-mmc1.xlsx).
# The article declares a CC BY license. Cite the authors and preserve attribution.
#
# **What is actually available:** sixteen cooling experiments on one 3.5 kW
# mini-split. Fan settings are Low/High, supplied by Table 3 of the paper.
# Temperature input is measured **evaporator inlet air temperature (T9)**, not a
# thermostat setpoint. Time is elapsed experimental seconds, not calendar time.
# All runs are cooling runs; other operating modes cannot be learned here.
# Published power was calculated from recorded current × 120 V. It is an
# experimental power proxy, not independently metered real power with a reported
# power factor. Report these limits with your results.
#
# The label integrates the published component power values over the next five
# minutes using actual elapsed timestamps. The model sees only information at
# the forecast origin. Entire runs are separated between development and test.
# No generated controls dataset, old model predictions or production readings
# enter training. This notebook exports three trained models and a comparison;
# it does not replace the desktop application's model automatically.

# %%
import importlib.metadata
import json
import os
from pathlib import Path
import subprocess
import sys

try:
    import google.colab
    IN_COLAB = True
except ImportError:
    IN_COLAB = False

if IN_COLAB:
    subprocess.check_call([sys.executable, '-m', 'pip', 'install', '-q',
        'numpy>=1.26,<3', 'pandas>=2.2,<4', 'scikit-learn>=1.5,<2',
        'xgboost>=2.1,<4', 'openpyxl>=3.1,<4', 'plotly>=5.20,<7',
        'joblib>=1.4,<2', 'requests>=2.31,<3'])

import hashlib
import io
import time
import zipfile
from datetime import datetime, timezone

import joblib
import numpy as np
import pandas as pd
import plotly.express as px
import plotly.graph_objects as go
from plotly.subplots import make_subplots
import requests
from sklearn.base import clone
from sklearn.compose import ColumnTransformer
from sklearn.dummy import DummyRegressor
from sklearn.ensemble import RandomForestRegressor
from sklearn.impute import SimpleImputer
from sklearn.metrics import mean_absolute_error, mean_squared_error, r2_score
from sklearn.model_selection import GridSearchCV, GroupKFold
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import OneHotEncoder
from sklearn.tree import DecisionTreeRegressor
from threadpoolctl import threadpool_limits
from xgboost import XGBRegressor

if IN_COLAB:
    from IPython.display import HTML, display

SEED = 20261029
HORIZON_SECONDS = 300
MAX_GAP_SECONDS = 30  # Source cadence is 18 seconds; missing samples split coverage.
N_JOBS = 2
OUTPUT = Path('/content/ecotrack_xgb_dt_rf' if IN_COLAB else
              os.getenv('ECOTRACK_COLAB_OUTPUT', 'reports/minisplit-xgb-dt-rf')).resolve()
OUTPUT.mkdir(parents=True, exist_ok=True)
for folder in ['source', 'models', 'plots']:
    (OUTPUT/folder).mkdir(exist_ok=True)


def show_table(frame):
    if IN_COLAB:
        display(frame)
    else:
        print(frame.to_string(index=False))


def write_json(path, value):
    path.write_text(json.dumps(value, indent=2, allow_nan=False) + '\n', encoding='utf-8')


VERSIONS = {name: importlib.metadata.version(name) for name in
    ['numpy', 'pandas', 'scikit-learn', 'xgboost', 'joblib', 'openpyxl', 'plotly', 'requests']}
print('Runtime:', sys.version.split()[0], '| forecast horizon:', HORIZON_SECONDS, 'seconds')
show_table(pd.DataFrame(VERSIONS.items(), columns=['Package', 'Version']))

# %% [markdown]
# ## Download and verify the original data
#
# The fixed SHA-256 protects the reviewed data version. If the publisher changes
# the supplement, stop and review it rather than silently training on a new file.
# The per-run factors below are transcribed from the article's Table 3. They are
# experiment metadata, not measurements invented for missing rows.

# %%
DATA_URL = 'https://ars.els-cdn.com/content/image/1-s2.0-S2352340919306705-mmc1.xlsx'
DATA_SHA256 = '9f352c6f51ceaf00c68ee419596e0d49c80052768df40d23203d69d47fbbbf66'
SOURCE = OUTPUT/'source/original_supplement_mmc1.xlsx'
LOCAL_SOURCE = Path('datasets/public_ac_candidates_20261029/minisplit_2019/original_supplement_mmc1.xlsx')
if not SOURCE.exists():
    if LOCAL_SOURCE.exists():
        SOURCE.write_bytes(LOCAL_SOURCE.read_bytes())
    else:
        response = requests.get(DATA_URL, timeout=90)
        response.raise_for_status()
        if not response.content.startswith(b'PK'):
            raise ValueError('Publisher did not return an Excel workbook. Retry or upload the original supplement.')
        SOURCE.write_bytes(response.content)
actual_hash = hashlib.sha256(SOURCE.read_bytes()).hexdigest()
if actual_hash != DATA_SHA256:
    raise ValueError('Dataset checksum differs from the reviewed publication supplement.')

RUN_FACTORS = [
    (1, 'low', 28, 46), (2, 'high', 28, 55), (3, 'low', 23, 62), (4, 'high', 23, 75),
    (5, 'high', 28, 46), (6, 'high', 23, 62), (7, 'low', 23, 75), (8, 'low', 28, 55),
    (9, 'low', 28, 46), (10, 'high', 28, 55), (11, 'low', 23, 62), (12, 'high', 23, 75),
    (13, 'high', 28, 46), (14, 'high', 23, 62), (15, 'low', 23, 75), (16, 'low', 28, 55)]
run_metadata = pd.DataFrame(RUN_FACTORS, columns=[
    'run_id', 'fan_setting', 'experimental_inlet_temperature_c', 'experimental_relative_humidity_percent'])
run_metadata['operating_mode'] = 'cooling'
run_metadata.to_csv(OUTPUT/'source/run_metadata_from_paper_table3.csv', index=False)
print('Verified original workbook:', SOURCE.name, '| SHA-256:', actual_hash)
show_table(run_metadata)

# %% [markdown]
# ## Inspect original measurements
#
# Power 1, 2 and 3 represent the compressor, condenser fan and evaporator fan
# channels derived from the paper's current measurements. Their sum is the
# experimental total-power proxy in kW. These columns are used **only to build
# future labels**, never as predictors. Inlet temperature is T9; do not rename it
# to target/setpoint temperature. No missing power is filled with zero.

# %%
book = pd.read_excel(SOURCE, sheet_name=None, engine='openpyxl')
if set(book) != {f'Run{i}' for i in range(1, 17)}:
    raise ValueError('Expected the original sixteen experiment worksheets.')
raw_parts = []
audit = []
for meta in run_metadata.to_dict('records'):
    frame = book[f"Run{meta['run_id']}"].copy()
    frame.columns = frame.columns.str.strip()
    required = ['Time (s)', 'T9 (°C)', 'Power 1 (kW)', 'Power 2 (kW)', 'Power 3 (kW)']
    if not set(required).issubset(frame.columns):
        raise ValueError('Published measurement columns changed.')
    frame[required] = frame[required].apply(pd.to_numeric, errors='coerce')
    if not np.isfinite(frame['Time (s)']).all() or frame['Time (s)'].duplicated().any():
        raise ValueError('Missing or duplicate elapsed times require source review.')
    frame = frame.sort_values('Time (s)').reset_index(drop=True)
    frame['elapsed_seconds'] = frame['Time (s)']
    frame['indoor_inlet_temperature_c'] = frame['T9 (°C)']
    power_columns = ['Power 1 (kW)', 'Power 2 (kW)', 'Power 3 (kW)']
    frame['power_proxy_kw'] = frame[power_columns].sum(axis=1, min_count=3)
    for name, value in meta.items():
        frame[name] = value
    audit.append(dict(run_id=meta['run_id'], rows=len(frame),
        first_seconds=float(frame.elapsed_seconds.min()), last_seconds=float(frame.elapsed_seconds.max()),
        median_interval_seconds=float(frame.elapsed_seconds.diff().median()),
        inlet_min_c=float(frame.indoor_inlet_temperature_c.min()),
        inlet_max_c=float(frame.indoor_inlet_temperature_c.max()),
        missing_power_rows=int(frame.power_proxy_kw.isna().sum()),
        negative_power_rows=int(frame.power_proxy_kw.lt(0).sum())))
    raw_parts.append(frame)
raw = pd.concat(raw_parts, ignore_index=True)
audit_frame = pd.DataFrame(audit)
audit_frame.to_csv(OUTPUT/'data_audit.csv', index=False)
show_table(audit_frame)
print('Original observations:', len(raw), '| experiments:', raw.run_id.nunique())

# %% [markdown]
# ## Build genuine future labels from elapsed time
#
# At time t, predict the integral of published total-power proxy from t to t+300s.
# Consecutive observed points define trapezoids; the horizon endpoint uses linear
# interpolation within its observed interval. Do not extrapolate beyond a run,
# across a missing-power row, or across a gap over 30 seconds. The small endpoint
# interpolation is a documented numerical integration method, not a new sensor row.
# All three models use the same eligible origins and the same future target.

# %%
def future_energy_labels(times, powers, horizon_seconds, max_gap_seconds):
    """Return kWh per origin, with NaN where a complete future window is unavailable."""
    times = np.asarray(times, dtype=float)
    powers = np.asarray(powers, dtype=float)
    if times.ndim != 1 or powers.shape != times.shape or not np.isfinite(times).all():
        raise ValueError('Elapsed times and powers must be aligned one-dimensional arrays.')
    if horizon_seconds <= 0 or max_gap_seconds <= 0 or (np.diff(times) <= 0).any():
        raise ValueError('Use positive horizon/cadence and unique increasing elapsed times.')
    result = np.full(len(times), np.nan)
    if len(times) < 2:
        return result
    valid = np.isfinite(powers) & (powers >= 0)
    breaks = (np.diff(times) > max_gap_seconds) | ~valid[:-1] | ~valid[1:]
    segments = np.cumsum(np.r_[0, breaks])
    for segment_id in np.unique(segments):
        indices = np.flatnonzero((segments == segment_id) & valid)
        if len(indices) < 2:
            continue
        t, p = times[indices], powers[indices]
        cumulative = np.r_[0., np.cumsum((p[:-1] + p[1:]) * .5 * np.diff(t))]
        origins = np.flatnonzero(t + horizon_seconds <= t[-1])
        endpoint = t[origins] + horizon_seconds
        left = np.minimum(np.searchsorted(t, endpoint, side='right') - 1, len(t)-2)
        fraction = (endpoint - t[left]) / (t[left+1] - t[left])
        endpoint_power = p[left] + (p[left+1] - p[left]) * fraction
        endpoint_integral = cumulative[left] + (p[left] + endpoint_power) * .5 * (endpoint - t[left])
        result[indices[origins]] = (endpoint_integral - cumulative[origins]) / 3600
    return result


# Independent, hand-calculated checks of units, exact elapsed time and gap handling.
assert np.isclose(future_energy_labels([0, 60, 120], [2, 2, 2], 60, 60)[0], 2/60)
assert np.isclose(future_energy_labels([0, 60, 120], [0, 2, 4], 30, 60)[0], 15/3600)
assert np.isnan(future_energy_labels([0, 18, 72, 90], [1, 1, 1, 1], 36, 30)).all()
assert np.isnan(future_energy_labels([0, 18, 36], [1, np.nan, 1], 18, 30)).all()
assert future_energy_labels([0, 18], [0, 0], 18, 30)[0] == 0

prepared = []
for run_id, frame in raw.groupby('run_id', sort=True):
    frame = frame.sort_values('elapsed_seconds').copy()
    frame['future_energy_proxy_kwh'] = future_energy_labels(
        frame.elapsed_seconds, frame.power_proxy_kw, HORIZON_SECONDS, MAX_GAP_SECONDS)
    frame['label_end_seconds'] = frame.elapsed_seconds + HORIZON_SECONDS
    prepared.append(frame)
prepared = pd.concat(prepared, ignore_index=True)
FEATURES = ['indoor_inlet_temperature_c', 'fan_setting', 'operating_mode', 'elapsed_seconds']
TARGET = 'future_energy_proxy_kwh'
eligible = np.isfinite(prepared[TARGET]) & np.isfinite(prepared.indoor_inlet_temperature_c)
excluded_origins = int((~eligible).sum())
data = prepared.loc[eligible].copy().reset_index(drop=True)
if data.empty or set(data.run_id) != set(range(1, 17)):
    raise ValueError('Every experiment must retain eligible forecast origins.')
print('Eligible forecast origins:', len(data), '| excluded incomplete/invalid origins:', excluded_origins)
show_table(data[['run_id', *FEATURES, TARGET]].head(8))

# %% [markdown]
# ## Freeze the experiment split before tuning
#
# Development: Runs 1–12. Untouched evaluation: Runs 13–16. Both fan levels and
# both experimental inlet-temperature settings occur in each side. Development
# includes the first eight design combinations plus four repeated runs. Test uses
# four later repeat runs. This is a held-out-experiment comparison on **one AC**,
# not cross-device or long-term calendar validation.
#
# Four-fold GroupKFold uses only development runs. Entire experiments stay in one
# fold, including their overlapping five-minute target windows. Preprocessing is
# fitted inside each pipeline/fold. Experiment ID, future powers and the target
# never enter the feature matrix. Choose the winning model using development CV
# MAE before looking at test scores. Do not choose hyperparameters on test data.

# %%
DEV_RUNS = list(range(1, 13))
TEST_RUNS = [13, 14, 15, 16]
development = data[data.run_id.isin(DEV_RUNS)].copy()
test = data[data.run_id.isin(TEST_RUNS)].copy()
assert set(development.run_id).isdisjoint(set(test.run_id))
X_dev, y_dev = development[FEATURES], development[TARGET]
X_test, y_test = test[FEATURES], test[TARGET]
cv = list(GroupKFold(n_splits=4).split(X_dev, y_dev, groups=development.run_id))
for train_index, validation_index in cv:
    assert set(development.iloc[train_index].run_id).isdisjoint(set(development.iloc[validation_index].run_id))
assert not any(name.startswith('Power') or 'proxy' in name or name == 'run_id' for name in FEATURES)
splits = data[['run_id', 'elapsed_seconds', 'label_end_seconds']].copy()
splits['split'] = np.where(splits.run_id.isin(TEST_RUNS), 'test', 'development')
splits.to_csv(OUTPUT/'split_assignments.csv', index=False)
write_json(OUTPUT/'cross_validation_runs.json', [dict(
    fold=i+1, train_runs=sorted(map(int, development.iloc[a].run_id.unique())),
    validation_runs=sorted(map(int, development.iloc[b].run_id.unique()))) for i, (a, b) in enumerate(cv)])
show_table(data.groupby('run_id').agg(rows=(TARGET, 'size'), fan=('fan_setting', 'first'),
    mean_target_kwh=(TARGET, 'mean')).reset_index().assign(
        split=lambda frame: np.where(frame.run_id.isin(TEST_RUNS), 'test', 'development')))

# %% [markdown]
# ## Tune XGBoost, Decision Tree and Random Forest fairly
#
# All models use identical features, folds and MAE selection. A small, disclosed
# grid is used for a reproducible CPU run. No test rows are used for early
# stopping. The constant development-mean baseline must also be reported: a
# complex model is not useful merely because its training score looks good.
# Missing categories and numeric preprocessing are handled within the pipeline;
# unsupported new fan/mode categories will raise an error at prediction time.

# %%
numeric = ['indoor_inlet_temperature_c', 'elapsed_seconds']
categorical = ['fan_setting', 'operating_mode']
preprocessor = ColumnTransformer([
    ('numeric', SimpleImputer(strategy='median'), numeric),
    ('categorical', OneHotEncoder(handle_unknown='error', sparse_output=False), categorical)])
estimators = {
    'XGBoost': (XGBRegressor(objective='reg:squarederror', tree_method='hist',
        random_state=SEED, n_jobs=N_JOBS, verbosity=0), {
        'model__n_estimators': [150, 300], 'model__max_depth': [2, 4],
        'model__learning_rate': [.05], 'model__subsample': [.8],
        'model__colsample_bytree': [1.0], 'model__reg_lambda': [5.]}),
    'Decision Tree': (DecisionTreeRegressor(random_state=SEED), {
        'model__max_depth': [3, 6, 10], 'model__min_samples_leaf': [5, 15]}),
    'Random Forest': (RandomForestRegressor(n_estimators=150, random_state=SEED,
        n_jobs=N_JOBS), {'model__max_depth': [6, 12], 'model__min_samples_leaf': [5, 15]})}
searches, tuning_records = {}, []
for name, (estimator, grid) in estimators.items():
    pipeline = Pipeline([('preprocessor', clone(preprocessor)), ('model', estimator)])
    search = GridSearchCV(pipeline, grid, scoring='neg_mean_absolute_error',
        cv=cv, n_jobs=1, refit=True, error_score='raise', return_train_score=True)
    started = time.perf_counter()
    with threadpool_limits(limits=N_JOBS):
        search.fit(X_dev, y_dev)
    searches[name] = search
    candidates = pd.DataFrame(search.cv_results_)
    candidates['model_name'] = name
    candidates.to_csv(OUTPUT/(name.lower().replace(' ', '_') + '_cv_candidates.csv'), index=False)
    tuning_records.append(dict(model=name, cv_mae_kwh=float(-search.best_score_),
        cv_mae_std_kwh=float(search.cv_results_['std_test_score'][search.best_index_]),
        candidates=len(candidates), fit_seconds=time.perf_counter()-started,
        parameters=json.dumps(search.best_params_, sort_keys=True)))
    print(name, '| development CV MAE:', round(-search.best_score_, 6), 'kWh', flush=True)
tuning = pd.DataFrame(tuning_records).sort_values('cv_mae_kwh').reset_index(drop=True)
WINNER = tuning.iloc[0]['model']
print('Winner selected BEFORE test evaluation:', WINNER)
show_table(tuning)

# %% [markdown]
# ## Evaluate the frozen models on Runs 13–16
#
# MAE and RMSE are in kWh over five minutes. R² can legitimately be negative.
# Improvement over the mean baseline is reported without hiding poor results.
# Adjacent target windows overlap, so thousands of rows are not thousands of
# independent experiments. Inspect all four run-level results. Do not sum the
# overlapping targets or predictions to claim the experiment's total energy.

# %%
def metrics(actual, predicted):
    actual, predicted = np.asarray(actual), np.asarray(predicted)
    return dict(mae_kwh=float(mean_absolute_error(actual, predicted)),
        rmse_kwh=float(np.sqrt(mean_squared_error(actual, predicted))),
        r2=float(r2_score(actual, predicted)), mean_error_kwh=float(np.mean(predicted-actual)))


baseline = DummyRegressor(strategy='mean').fit(X_dev, y_dev)
baseline_predictions = baseline.predict(X_test)
baseline_scores = metrics(y_test, baseline_predictions)
predictions = test[['run_id', *FEATURES, 'label_end_seconds', TARGET]].copy()
predictions['Mean Baseline'] = baseline_predictions
comparison, per_run = [], []
for name, search in searches.items():
    predicted = search.best_estimator_.predict(X_test)
    if not np.isfinite(predicted).all() or (predicted < 0).any():
        raise ValueError(name + ' returned invalid energy. Review the model; do not silently clip outputs.')
    predictions[name] = predicted
    row = dict(model=name, **metrics(y_test, predicted),
        cv_mae_kwh=float(-search.best_score_), selected_by_cv=name == WINNER)
    row['mae_improvement_vs_mean_percent'] = 100*(1-row['mae_kwh']/baseline_scores['mae_kwh']) if baseline_scores['mae_kwh'] else None
    comparison.append(row)
    for run_id, group in predictions.groupby('run_id'):
        per_run.append(dict(model=name, run_id=int(run_id), rows=len(group),
                           **metrics(group[TARGET], group[name])))
comparison.append(dict(model='Mean Baseline', **baseline_scores, cv_mae_kwh=None,
                       selected_by_cv=False, mae_improvement_vs_mean_percent=0.))
comparison = pd.DataFrame(comparison)
per_run = pd.DataFrame(per_run)
comparison.to_csv(OUTPUT/'model_comparison.csv', index=False)
per_run.to_csv(OUTPUT/'held_out_run_metrics.csv', index=False)
predictions.to_csv(OUTPUT/'held_out_predictions.csv', index=False)
tuning.to_csv(OUTPUT/'development_cv_selection.csv', index=False)
show_table(comparison)
print('Per-experiment performance:')
show_table(per_run)

# %% [markdown]
# ## Charts for model comparison and your presentation
#
# The energy traces are next-five-minute predictions at each origin, not a
# nonoverlapping cumulative meter reading. Histograms and residuals expose model
# error rather than hiding it behind a single score. Interactive HTML charts are
# saved in the results ZIP and displayed inline in Colab.

# %%
charts = {}
charts['model_comparison'] = px.bar(comparison, x='model', y=['mae_kwh', 'rmse_kwh'],
    barmode='group', title='Held-out experimental forecast error',
    labels={'value': 'Five-minute energy error (kWh)', 'model': 'Model', 'variable': 'Metric'})
traces = make_subplots(rows=4, cols=1, shared_xaxes=False,
    subplot_titles=[f'Untouched experiment Run {run}' for run in TEST_RUNS], vertical_spacing=.08)
for row, run_id in enumerate(TEST_RUNS, 1):
    group = predictions[predictions.run_id.eq(run_id)]
    for label, values in [('Recorded-current target', group[TARGET]), (WINNER, group[WINNER])]:
        traces.add_trace(go.Scatter(x=group.elapsed_seconds/60, y=values, mode='lines',
            name=label, legendgroup=label, showlegend=row == 1), row=row, col=1)
    traces.update_yaxes(title_text='Next 5 min (kWh)', row=row, col=1)
    traces.update_xaxes(title_text='Elapsed experiment minutes', row=row, col=1)
traces.update_layout(height=950, title=f'CV-selected {WINNER}: held-out runs')
charts['held_out_runs'] = traces
scatter = go.Figure()
for name in searches:
    scatter.add_trace(go.Scatter(x=y_test, y=predictions[name], mode='markers', name=name,
        marker=dict(size=4, opacity=.4)))
bounds = [float(min(y_test.min(), predictions[list(searches)].min().min())),
          float(max(y_test.max(), predictions[list(searches)].max().max()))]
scatter.add_trace(go.Scatter(x=bounds, y=bounds, mode='lines', name='Perfect prediction'))
scatter.update_layout(title='Held-out target versus prediction', xaxis_title='Experimental target (kWh)',
                      yaxis_title='Predicted next-five-minute energy (kWh)')
charts['actual_vs_predicted'] = scatter
residuals = pd.DataFrame({name: predictions[name]-y_test.to_numpy() for name in searches})
charts['residuals'] = px.histogram(residuals.melt(var_name='model', value_name='error'),
    x='error', color='model', opacity=.5, barmode='overlay', nbins=40,
    title='Held-out residual distribution', labels={'error': 'Predicted minus experimental target (kWh)'})
for name, figure in charts.items():
    figure.update_layout(template='plotly_white', font=dict(size=13))
    destination = OUTPUT/'plots'/f'{name}.html'
    figure.write_html(destination, include_plotlyjs='directory', full_html=True)
    if IN_COLAB:
        display(HTML(figure.to_html(include_plotlyjs='cdn', full_html=False)))
    else:
        print('Saved chart:', destination.name)

# %% [markdown]
# ## Save all three models, preprocessing and data provenance
#
# Each model remains fitted only on development runs, so the saved artifact is
# exactly the evaluated model. No post-test refit is silently substituted. Load
# the full pipeline to preserve feature order and categorical preprocessing.
# The native XGBoost JSON also requires its separately saved preprocessor.
# The ZIP includes source data, split assignments, CV grids, held-out predictions,
# run metrics, charts, hashes, requirements and a model card.
#
# **Deployment boundary:** the current desktop app expects target setpoints and
# a broad control-setting range. These models expect measured T9 air temperature,
# Low/High fan levels, Cooling and elapsed experimental time. Do not drop these
# artifacts into that interface. External validation and an explicit input
# adapter are required before deployment to your own AC equipment.

# %%
saved_models = []
for name, search in searches.items():
    slug = name.lower().replace(' ', '_')
    path = OUTPUT/'models'/f'{slug}.joblib'
    joblib.dump(search.best_estimator_, path, compress=3)
    restored = joblib.load(path)
    np.testing.assert_allclose(restored.predict(X_test), predictions[name].to_numpy(), rtol=1e-7, atol=1e-10)
    saved_models.append(dict(name=name, file='models/'+path.name,
        sha256=hashlib.sha256(path.read_bytes()).hexdigest(), parameters=search.best_params_))
searches['XGBoost'].best_estimator_.named_steps['model'].save_model(OUTPUT/'models/xgboost_native.json')
joblib.dump(searches['XGBoost'].best_estimator_.named_steps['preprocessor'],
            OUTPUT/'models/xgboost_preprocessor.joblib', compress=3)
domain = dict(
    inlet_temperature_c=[float(X_dev.indoor_inlet_temperature_c.min()), float(X_dev.indoor_inlet_temperature_c.max())],
    fan_settings=sorted(X_dev.fan_setting.unique()), modes=sorted(X_dev.operating_mode.unique()),
    elapsed_seconds=[float(X_dev.elapsed_seconds.min()), float(X_dev.elapsed_seconds.max())])
outside = ~test.indoor_inlet_temperature_c.between(*domain['inlet_temperature_c'])
manifest = dict(created_utc=datetime.now(timezone.utc).isoformat(),
    dataset_doi='10.1016/j.dib.2019.104316', dataset_url=DATA_URL, dataset_sha256=DATA_SHA256,
    authors=['Hermes Ramírez', 'Javier Jiménez-Cabas', 'Antonio Bula'],
    license='Article: CC BY 4.0; retain source attribution', versions=VERSIONS,
    python=sys.version.split()[0], features=FEATURES, target=TARGET, target_unit='kWh',
    horizon_seconds=HORIZON_SECONDS, max_gap_seconds=MAX_GAP_SECONDS,
    target_basis='Future integral of published experimental current-times-120V component power proxy',
    numeric_integration='Trapezoidal between observed times; linear interpolation only at the horizon endpoint',
    calendar_timestamps_available=False, thermostat_setpoints_available=False,
    all_ac_operating_modes_validated=False, deployed_field_accuracy_validated=False,
    cross_device_accuracy_validated=False, physical_ac_count=1,
    development_runs=DEV_RUNS, untouched_test_runs=TEST_RUNS,
    selection='Minimum development GroupKFold MAE; no test-based selection',
    selected_model=WINNER, development_domain=domain,
    held_out_origins_outside_development_temperature_range=int(outside.sum()),
    original_observations=len(raw), eligible_forecast_origins=len(data),
    excluded_origins=excluded_origins, models=saved_models,
    warnings=['Repeated steady-state experiments on one AC are not independent field installations.',
              'Overlapping forecast windows must not be summed into total experiment energy.',
              'Auto/Medium fan, other modes, target setpoint control and calendar effects are not validated.',
              'Reported electrical power is a current-times-voltage proxy, not a calibrated real-power meter.'])
write_json(OUTPUT/'manifest.json', manifest)
pd.DataFrame({'feature': FEATURES, 'meaning': [
    'Measured evaporator inlet air temperature T9, degrees C; not thermostat setpoint',
    'Low or High, from published per-experiment metadata',
    'Cooling only; constant experiment context',
    'Elapsed seconds since the first recorded observation in that experiment']}).to_csv(
        OUTPUT/'input_contract.csv', index=False)
(OUTPUT/'requirements.txt').write_text('\n'.join(f'{key}=={value}' for key, value in VERSIONS.items())+'\n')
model_card = f'''# Experimental mini-split forecast comparison

Source: Ramírez, Jiménez-Cabas and Bula (2019), Data in Brief 25, 104316.
DOI: https://doi.org/10.1016/j.dib.2019.104316
Dataset SHA-256: {DATA_SHA256}

Predictors: measured T9 inlet temperature, Low/High fan setting, Cooling context,
and elapsed experiment seconds. Target: published experimental power proxy
integrated over the next {HORIZON_SECONDS} seconds, in kWh. Data are from one
3.5 kW mini-split; source power is calculated from measured current times 120 V.
No calendar timestamps, broad thermostat-setpoint range or other AC modes are
established by this experiment. Measurements and model-based estimates must be
identified accurately when presenting this work.

Development runs: {DEV_RUNS}; test runs: {TEST_RUNS}. Grid selection uses four-fold
GroupKFold on development runs, with preprocessing inside each fold. Complete
runs separate training, validation and test, so overlapping labels do not cross
split boundaries. Winner selected by development CV MAE: {WINNER}.

The saved pipelines are the exact evaluated development-fitted models. They have
not been refitted on held-out runs. Report model_comparison.csv and the run-level
results, including the mean baseline. Do not sum overlapping five-minute windows.
Do not equate experiment performance with accuracy on different AC equipment.
No application model or production record is modified by this notebook.

Load only trusted model artifacts with joblib. Native XGBoost JSON needs the
exported preprocessor. See manifest.json, input_contract.csv, requirements.txt
and split_assignments.csv for the complete reproducibility contract.
'''
(OUTPUT/'MODEL_CARD.md').write_text(model_card, encoding='utf-8')
print('All three saved models reproduce their held-out predictions.')
print('Held-out origins outside development temperature range:', int(outside.sum()))
print('Model files:', [item['file'] for item in saved_models])

# %% [markdown]
# ## Download your complete results
#
# Google Colab downloads a ZIP containing the three models, comparison tables,
# held-out predictions, original dataset, charts and source/model documentation.
# Save a copy of this notebook with outputs for your research record. Report
# the actual results, even if a model performs worse than the baseline.

# %%
archive = OUTPUT.parent/'ecotrack_xgb_dt_rf_results.zip'
with zipfile.ZipFile(archive, 'w', zipfile.ZIP_DEFLATED) as bundle:
    for path in sorted(OUTPUT.rglob('*')):
        if path.is_file():
            bundle.write(path, path.relative_to(OUTPUT))
with zipfile.ZipFile(archive) as bundle:
    if bundle.testzip() is not None:
        raise ValueError('Results ZIP failed its integrity check.')
print('Results:', archive, '| bytes:', archive.stat().st_size)
if IN_COLAB:
    from google.colab import files
    files.download(str(archive))
