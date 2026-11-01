# EcoTrack

A desktop application built with Electron.js (frontend) and Python (backend).

## Downloads

The [November 1, 2026 release](https://github.com/B3424231/NewEcoTrackCapstoneProjectDesktopApp/releases/tag/v1.0.0-20261101) includes the verified October 30 Android APK and its SHA-256 checksum. Installers are attached to GitHub Releases so they do not enlarge Git source history.

Mobile source code is maintained in [NewEcotrackCapstoneMobileApp](https://github.com/B3424231/NewEcotrackCapstoneMobileApp).

## Prerequisites

- **Node.js** (v14 or higher) - [Download](https://nodejs.org/)
- **Python** (v3.8 or higher) - [Download](https://www.python.org/)
- **npm** (comes with Node.js)

## Installation

### 1. Install Electron and Dependencies

```bash
cd c:\Users\junju\Desktop\EcoTrack
npm install
```

This installs:
- **Electron** - Framework for building desktop apps
- **Electron-builder** - For packaging and building distributables
- **Flask & CORS** - Python backend dependencies

### 2. Install Python Dependencies

```bash
# Create a virtual environment (optional but recommended)
python -m venv venv
venv\Scripts\activate  # On Windows

# Install Python packages
pip install -r requirements.txt
```

## Project Structure

```
EcoTrack/
├── src/
│   ├── main.js          # Electron main process
│   └── preload.js       # Preload script for IPC
├── public/
│   ├── index.html       # Main HTML file
│   ├── styles.css       # Styles
│   └── js/              # Modular page controllers
├── backend/
│   └── app.py           # Flask backend server
├── package.json         # Node dependencies
├── requirements.txt     # Python dependencies
└── .env                 # Environment variables
```

## Development

### Start Both Frontend and Backend
```bash
npm run dev
```

This runs:
- Electron in development mode with hot reload
- Python Flask server on port 5000

### Start Only Frontend (Electron)
```bash
npm start
```

### Start Only Backend (Python)
```bash
python backend/app.py
```

## Building

### Build Installer
```bash
npm run dist
```

### Build Portable Version
```bash
npm run pack
```

## API Reference

### Backend Health Check
- **Endpoint**: `GET http://localhost:5000/api/health`
- **Response**: `{ "status": "healthy", "message": "EcoTrack Backend is running" }`

### Get Data
- **Endpoint**: `GET http://localhost:5000/api/data`
- **Response**: `{ "data": "...", "timestamp": "..." }`

## Configuration

Edit `.env` file to change:
- `FLASK_PORT` - Python backend port (default: 5000)
- `FLASK_ENV` - Environment mode (development/production)

## Troubleshooting

**Electron won't start:**
- Ensure Node.js is installed: `node --version`
- Clear node_modules: `rm -r node_modules` then `npm install`

**Python backend won't connect:**
- Check Python version: `python --version`
- Verify Flask is installed: `pip list`
- Check if port 5000 is available

**Port already in use:**
- Change `FLASK_PORT` in `.env` file
- Or kill the process using the port

## License

MIT License

## Data storage and database checks

Supabase owns users, controller/AC registries, locations, rules, notifications and maintenance records. Firmware uploads telemetry to Supabase. The Python backend keeps an independent SQLite telemetry history at `backend/telemetry.db`; `ECOTRACK_SQLITE_DB_PATH` can override this path. Cloud deletions do not automatically erase this local history.

Telemetry uses Supabase as a temporary bridge: hardware -> Supabase `telemetry` -> verified SQLite archive -> monitoring APIs -> UI. Each observation keeps its actual timestamp and reported `interval_seconds` from the device's applied AC Device Scheduler configuration. Importing a backlog does not sample, merge, or generate readings.

Apply `supabase_telemetry_bridge_migration.sql` for the backend-only `ecotrack_ack_telemetry` RPC. With `SUPABASE_SERVICE_ROLE_KEY` configured in the Python backend, synchronization archives the complete cloud payload in `telemetry_cloud_receipts` in the same SQLite transaction as the history row. Only then can the RPC remove that exact, unchanged cloud record. Original payloads remain in SQLite after acknowledgement; anonymous and signed-in UI clients cannot call the cleanup function. Missing credentials, RPC errors, changed records, and duplicate-ID conflicts preserve cloud rows. No age-based deletion is used.

Cleanup retries survive restart. A separate bounded backlog scan catches older and delayed uploads while the normal import cursor continues receiving new readings. `/api/telemetry/sync` reports `cleanup_pending`, `cleanup_error`, and `backlog_error`. A desktop/backend outage retains undelivered readings in Supabase; available cloud capacity still limits how long an outage can last. Optional `ECOTRACK_MONITOR_SYNC=1` is a separate cloud backup of monitoring history and is not needed for this bridge.

Focused checks: `venv\Scripts\python.exe scripts/test_telemetry_bridge.py`, `node scripts/test_telemetry_bridge_database.js`, and the existing cloud-ingestion/scheduler tests.


The renderer uses the Supabase client directly for cloud tables and a telemetry adapter for `/api/telemetry`. The old PocketBase service and `PB_URL` are no longer required. Profile/controller caches reconcile successful authenticated cloud results, including empty results; connection errors preserve the cache.

`npm run transfer:sqlite` catches up local telemetry using the same validated importer as automatic backend sync. Missing measurements stay unknown. Demo inserts are separate optional legacy SQL files under `scripts/demo-seeds/`; normal schema setup does not insert demo records. The obsolete analytics snapshot store and save endpoint have been retired.

Run `npm run test:database` for cache/adapter regressions and CRUD/filter tests against a temporary SQLite database. Run `npm test` for the existing mock-data checks. The database audit and cleanup results are in `reports/database-audit/`.

## Source and release files

Commit application source, dependency lockfiles, database migrations, firmware, bundled browser assets, and the active Extra Trees model. Its small training reference and two regression CSV fixtures are retained for reproducibility.

Keep dependencies, Python environments, local databases and backups, credentials, generated reports, screenshots, downloaded datasets, caches, and installer outputs local. The ignore rules exclude those files without deleting them. Generated audit reports can be recreated by their corresponding scripts.

To build the desktop installer, install `requirements-build.txt` in the existing virtual environment, run `venv\Scripts\python.exe scripts/build_backend.py`, and then run `npm run dist`. Configure `.env` locally from `.env.example`. Attach distributable installers and APKs to GitHub Releases; do not commit them to the repository.
