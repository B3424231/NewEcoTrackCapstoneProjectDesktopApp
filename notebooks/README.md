# AC energy model comparison in Google Colab

1. Open https://colab.research.google.com/.
2. Choose **File → Upload notebook** and select `AC_Energy_XGBoost_DecisionTree_RandomForest_Colab.ipynb`.
3. Choose **Runtime → Run all**. A CPU runtime is sufficient. The notebook installs its dependencies, downloads and checks the original public dataset, trains XGBoost, Decision Tree and Random Forest, displays results and downloads a ZIP with all three trained models and their evidence.

The notebook is self-contained. It does not require the desktop repository, Google Drive access, a cloud API key or production records. The companion percent-format script contains the same cells and can be used outside Colab with the dependencies listed in the notebook. Rebuild the notebook after editing that script with `venv\Scripts\python.exe scripts/build_ac_energy_colab.py`.

## Prediction and evaluation

- Source: Ramírez, Jiménez-Cabas and Bula (2019), *Experimental data for an air-conditioning system identification*, DOI https://doi.org/10.1016/j.dib.2019.104316.
- Predict the next five minutes of experimental energy proxy in kWh, integrated from the published component power columns and actual elapsed seconds.
- Inputs are measured T9 inlet air temperature, Low/High fan setting from the paper, Cooling context and elapsed experiment seconds.
- Runs 1–12 are used for development. Four-fold GroupKFold tunes each model with complete experiments kept together. Runs 13–16 are held out for final evaluation.
- Report MAE, RMSE, R², mean bias, a mean baseline and per-run errors. Select by development CV MAE, not the lowest observed test error.
- The exported pipelines are the same development-fitted models that were evaluated. Saved-model predictions are checked against the exported held-out predictions.

## Scope of the evidence

The data contain 16 cooling experiments on one mini-split AC. Published power is derived from recorded current times 120 V, not independently measured real power. Source temperature is inlet air temperature, not thermostat setpoint. Auto/Medium fan settings, other AC modes and calendar timestamps are not available. The notebook reports these limitations and any held-out temperature outside the development range.

The resulting models are experimental research artifacts. They cannot replace the desktop app's broad target-setpoint control model without a compatible measured input source, an explicit adapter and validation on the target equipment. No live application model or production record is modified by this notebook.
