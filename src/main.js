const { app, BrowserWindow, Menu, shell, ipcMain } = require('electron');
const path = require('path');
const isDev = require('electron-is-dev');

// Suppress and handle SSL handshake resets (net_error -101) and clock skew
app.commandLine.appendSwitch('ignore-certificate-errors');
app.commandLine.appendSwitch('allow-insecure-localhost', 'true');

let mainWindow;

function focusMainWindow() {
  if (!mainWindow) {
    createWindow();
    return;
  }
  if (mainWindow.isMinimized()) {
    mainWindow.restore();
  }
  if (!mainWindow.isVisible()) {
    mainWindow.show();
  }
  // Bring to foreground on Windows and bypass OS foreground locking
  mainWindow.setAlwaysOnTop(true);
  mainWindow.focus();
  mainWindow.setAlwaysOnTop(false);
  if (typeof app.focus === 'function') {
    app.focus({ steal: true });
  }
  if (process.platform === 'win32') {
    mainWindow.flashFrame(false);
  }
}

// IPC handlers for notification clicks to restore, focus, and navigate
ipcMain.on('focus-window', (event, data) => {
  focusMainWindow();
});

ipcMain.handle('focus-window', async (event, data) => {
  focusMainWindow();
  return { success: true };
});

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 2000,
    height: 1000,
    icon: path.join(__dirname, '../assets/ecoTrack.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  const startUrl = `file://${path.join(__dirname, '../public/login.html')}`;

  mainWindow.loadURL(startUrl);

  // Prevent blank/white windows when links or window.open are triggered
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url && (url.startsWith('http://') || url.startsWith('https://'))) {
      shell.openExternal(url);
    }
    return { action: 'deny' };
  });

  // Remove menu bar
  Menu.setApplicationMenu(null);

  // Enable standard shortcuts for development and smooth reload (Ctrl+R, F5, Ctrl+Shift+I)
  mainWindow.webContents.on('before-input-event', (event, input) => {
    if ((input.control && input.key.toLowerCase() === 'r') || input.key === 'F5') {
      mainWindow.webContents.reloadIgnoringCache();
      event.preventDefault();
    }
    if (input.control && input.shift && input.key.toLowerCase() === 'i') {
      mainWindow.webContents.toggleDevTools();
      event.preventDefault();
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.setAppUserModelId("EcoTrack Notification");
app.on('ready', createWindow);

// Handle SSL / certificate errors gracefully across network reconnects
app.on('certificate-error', (event, webContents, url, error, certificate, callback) => {
  event.preventDefault();
  callback(true);
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (mainWindow === null) {
    createWindow();
  }
});
