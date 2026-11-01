"""Windows desktop backend entry point; configuration and writable data stay external."""
import json
import multiprocessing
import os
from pathlib import Path
import sys


def configure_runtime():
    config_path = os.environ.get('ECOTRACK_CONFIG_PATH')
    if config_path:
        config = Path(config_path).expanduser().resolve()
        if config.is_file():
            if config.suffix.lower() == '.json':
                values = json.loads(config.read_text(encoding='utf-8-sig'))
                if not isinstance(values, dict):
                    raise ValueError('Backend configuration must be a JSON object.')
                for key, value in values.items():
                    if isinstance(key, str) and isinstance(value, (str, int, float)):
                        os.environ.setdefault(key, str(value))
            else:
                from dotenv import load_dotenv
                load_dotenv(config, override=False)
    database = os.environ.get('ECOTRACK_SQLITE_DB_PATH')
    if not database or not Path(database).is_absolute():
        raise ValueError('The packaged backend requires an absolute writable SQLite path.')
    folder = Path(database).parent
    folder.mkdir(parents=True, exist_ok=True)
    # Never create application data beside the installed/frozen executable.
    os.chdir(folder)
    return int(os.environ.get('PORT', '5000'))


def main():
    port = configure_runtime()
    from backend.app import app, start_telemetry_sync, monitoring_service, history_health
    from waitress import serve
    start_telemetry_sync()
    monitoring_service.start_sync()
    history_health.start()
    print(f'[*] EcoTrack packaged backend listening on 127.0.0.1:{port}', flush=True)
    serve(app, host='127.0.0.1', port=port, threads=8)


if __name__ == '__main__':
    multiprocessing.freeze_support()
    # Also supports a source smoke run without installing the application package.
    if not getattr(sys, 'frozen', False):
        sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
    main()
