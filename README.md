# EcoTrack

A desktop application built with Electron.js (frontend) and Python (backend).

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
│   └── renderer.js      # Frontend JavaScript
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
