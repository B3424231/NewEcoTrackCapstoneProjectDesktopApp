"""Freeze the verified project Python environment without copying local data/secrets."""
import hashlib
import importlib.metadata
import json
from pathlib import Path
import shutil
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]
MODEL = ROOT / 'backend/ml/control_extra_trees'
OUTPUT = ROOT / 'artifacts/packaging/backend'
WORK = ROOT / 'artifacts/packaging/backend-work'


def main():
    manifest = json.loads((MODEL / 'manifest.json').read_text(encoding='utf-8'))
    for package, version in manifest['versions'].items():
        actual = importlib.metadata.version(package)
        if actual != version:
            raise RuntimeError(f'{package} is {actual}; the model requires {version}.')
    for name, expected in manifest['artifacts'].items():
        if hashlib.sha256((MODEL / name).read_bytes()).hexdigest() != expected:
            raise RuntimeError(f'Model integrity verification failed for {name}.')
    assert OUTPUT.resolve().is_relative_to(ROOT) and WORK.resolve().is_relative_to(ROOT)
    subprocess.run([sys.executable, '-m', 'PyInstaller', '--noconfirm',
        '--distpath', str(OUTPUT), '--workpath', str(WORK),
        str(ROOT / 'packaging/backend.spec')], cwd=ROOT, check=True)
    executable = OUTPUT / 'ecotrack-backend/ecotrack-backend.exe'
    if not executable.is_file():
        raise RuntimeError('PyInstaller did not produce the backend executable.')
    # Windows invokes this plain PowerShell resource, rather than importing it.
    scanner = ROOT / 'scripts/wlan_scan.ps1'
    if scanner.is_file():
        target = executable.parent / '_internal/scripts/wlan_scan.ps1'
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(scanner, target)
    private = [p for p in executable.parent.rglob('*') if p.is_file() and
               (p.name.startswith('.env') or p.name.endswith(('.db', '.key')))]
    if private:
        raise RuntimeError('A private runtime file was unexpectedly collected.')
    print('Verified backend runtime:', executable)


if __name__ == '__main__':
    main()
