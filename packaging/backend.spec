# PyInstaller one-folder runtime. No .env, SQLite, cache or user files are collected.
from pathlib import Path
from PyInstaller.utils.hooks import copy_metadata

root = Path(SPECPATH).parent
model = root / 'backend' / 'ml' / 'control_extra_trees'
datas = [(str(model / name), 'backend/ml/control_extra_trees') for name in (
    'model.joblib', 'manifest.json', 'supported_inputs.json.gz', 'assumptions.json', 'SOURCE.md')]
if (root / 'scripts' / 'ble_scanner.exe').is_file():
    datas.append((str(root / 'scripts' / 'ble_scanner.exe'), 'scripts'))
for name in ('scikit-learn', 'joblib', 'numpy', 'scipy', 'pandas', 'flask', 'waitress', 'threadpoolctl'):
    datas += copy_metadata(name)

a = Analysis([str(root / 'backend' / 'packaged_entry.py')], pathex=[str(root)],
    binaries=[], datas=datas,
    hiddenimports=['sklearn.pipeline', 'sklearn.compose._column_transformer',
        'sklearn.ensemble._forest', 'sklearn.tree._tree', 'sklearn.tree._classes',
        'sklearn.preprocessing._encoders'],
    hookspath=[], runtime_hooks=[],
    excludes=['matplotlib', 'plotly', 'xgboost', 'tkinter', 'IPython', 'notebook',
        'pytest', 'sphinx', 'torch', 'tensorflow'],
    noarchive=False, optimize=0)
pyz = PYZ(a.pure)
exe = EXE(pyz, a.scripts, [], exclude_binaries=True, name='ecotrack-backend',
    debug=False, bootloader_ignore_signals=False, strip=False, upx=False,
    console=True, disable_windowed_traceback=False)
coll = COLLECT(exe, a.binaries, a.datas, strip=False, upx=False, name='ecotrack-backend')
