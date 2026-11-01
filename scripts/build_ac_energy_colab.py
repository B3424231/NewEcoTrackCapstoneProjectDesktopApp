"""Build a self-contained Colab notebook from the reviewed percent-format script."""
import ast
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
source = ROOT/'notebooks/ac_energy_xgb_dt_rf.py'
target = ROOT/'notebooks/AC_Energy_XGBoost_DecisionTree_RandomForest_Colab.ipynb'
cells = []
kind, lines = None, []


def flush():
    if kind is None:
        return
    content = ''.join(lines).strip()+'\n'
    if kind == 'markdown':
        content = '\n'.join(line[2:] if line.startswith('# ') else '' if line == '#' else line
                            for line in content.splitlines())+'\n'
        cells.append(dict(cell_type='markdown', metadata={}, source=content.splitlines(True)))
    else:
        ast.parse(content)
        cells.append(dict(cell_type='code', metadata={}, source=content.splitlines(True),
                          execution_count=None, outputs=[]))


for line in source.read_text(encoding='utf-8').splitlines(True):
    if line.startswith('# %%'):
        flush()
        kind = 'markdown' if '[markdown]' in line else 'code'
        lines = []
    else:
        lines.append(line)
flush()
notebook = dict(nbformat=4, nbformat_minor=5, metadata=dict(
    colab=dict(name=target.name, provenance=[]),
    kernelspec=dict(display_name='Python 3', language='python', name='python3'),
    language_info=dict(name='python', version='3')),
    cells=[{**cell, 'id':f'ecotrack-{i:02d}'} for i, cell in enumerate(cells)])
target.write_text(json.dumps(notebook, ensure_ascii=False, indent=1)+'\n', encoding='utf-8')
print('Created', target, '| cells:', len(cells))
