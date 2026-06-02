const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { app, BrowserWindow, Menu, shell, ipcMain, dialog } = require('electron');

const devProjectRoot = path.resolve(__dirname, '..', '..', '..');
const serverRoot = app.isPackaged
  ? path.join(process.resourcesPath, 'local-server')
  : devProjectRoot;
const desktopPort = Number(process.env.BOOK_OF_LIFE_DESKTOP_PORT || 3131);
const baseUrl = `http://127.0.0.1:${desktopPort}`;

let serverProcess = null;
let mainWindow = null;

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
  return dirPath;
}

function desktopDataPaths() {
  const dataRoot = ensureDir(path.join(app.getPath('userData'), 'Library Data'));
  const journalVault = ensureDir(path.join(dataRoot, 'Journal Vault'));
  const photoRoot = ensureDir(path.join(dataRoot, 'Photos'));
  const cacheDir = ensureDir(path.join(dataRoot, 'Cache'));
  const deviceSyncRoot = ensureDir(path.join(dataRoot, 'Device Uploads'));
  ensureDir(path.join(journalVault, 'Journal'));
  ensureDir(path.join(journalVault, 'Images'));
  return { dataRoot, journalVault, photoRoot, cacheDir, deviceSyncRoot };
}

function serverEnvironment() {
  const paths = desktopDataPaths();
  return {
    ...process.env,
    ELECTRON_RUN_AS_NODE: '1',
    PORT: String(desktopPort),
    BOOK_OF_LIFE_DESKTOP: '1',
    LIFESERVER_AUTH_ENABLED: process.env.LIFESERVER_AUTH_ENABLED || 'false',
    LIFESERVER_ALLOW_LOCALHOST_VIEWER_BYPASS: 'true',
    LIFESERVER_JOURNAL_VAULT: process.env.LIFESERVER_JOURNAL_VAULT || paths.journalVault,
    LIFESERVER_PHOTO_ROOT: process.env.LIFESERVER_PHOTO_ROOT || paths.photoRoot,
    LIFESERVER_DEVICE_SYNC_ROOT: process.env.LIFESERVER_DEVICE_SYNC_ROOT || paths.deviceSyncRoot,
    LIFESERVER_CACHE_DIR: process.env.LIFESERVER_CACHE_DIR || paths.cacheDir
  };
}

function startLocalHost() {
  if (serverProcess) return;
  const serverEntry = path.join(serverRoot, 'server.js');
  serverProcess = spawn(process.execPath, [serverEntry], {
    cwd: serverRoot,
    env: serverEnvironment(),
    stdio: ['ignore', 'pipe', 'pipe']
  });
  serverProcess.stdout.on('data', (chunk) => console.log(`[local-host] ${chunk}`.trim()));
  serverProcess.stderr.on('data', (chunk) => console.error(`[local-host] ${chunk}`.trim()));
  serverProcess.on('exit', (code) => {
    console.log(`Book of Life local host exited with code ${code}.`);
    serverProcess = null;
  });
}

async function waitForLocalHost(retries = 100) {
  for (let index = 0; index < retries; index += 1) {
    try {
      const response = await fetch(`${baseUrl}/api/auth/status`);
      if (response.ok) return true;
    } catch (error) {
      // Keep waiting while the Express server and indexer start.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return false;
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1320,
    height: 900,
    minWidth: 980,
    minHeight: 720,
    title: 'Book of Life',
    webPreferences: desktopWebPreferences()
  });
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
  mainWindow.loadURL(`${baseUrl}/desktop/onboarding`);
}

function openSettingsWindow() {
  const settingsWindow = new BrowserWindow({
    width: 1180,
    height: 860,
    minWidth: 900,
    minHeight: 680,
    title: 'Book of Life Desktop Sync',
    parent: mainWindow || undefined,
    webPreferences: desktopWebPreferences()
  });
  settingsWindow.loadURL(`${baseUrl}/desktop/settings`);
}

function desktopWebPreferences() {
  return {
    contextIsolation: true,
    nodeIntegration: false,
    preload: path.join(__dirname, 'preload.cjs')
  };
}

ipcMain.handle('book-of-life:pick-directory', async (event) => {
  const senderUrl = event.senderFrame?.url || '';
  if (!senderUrl.startsWith(baseUrl)) return { canceled: true, path: '' };
  const result = await dialog.showOpenDialog(BrowserWindow.fromWebContents(event.sender), {
    title: 'Choose a folder',
    properties: ['openDirectory', 'createDirectory']
  });
  return {
    canceled: result.canceled,
    path: result.filePaths?.[0] || ''
  };
});

function installMenu() {
  const template = [
    {
      label: 'Book of Life',
      submenu: [
        { label: 'Open Library', click: () => mainWindow?.loadURL(baseUrl) },
        { label: 'Desktop Sync Settings', click: openSettingsWindow },
        { label: 'Open Data Folder', click: () => shell.openPath(path.join(app.getPath('userData'), 'Library Data')) },
        { type: 'separator' },
        { label: 'Quit', role: 'quit' }
      ]
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { role: 'togglefullscreen' }
      ]
    }
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

app.whenReady().then(async () => {
  startLocalHost();
  const ready = await waitForLocalHost();
  installMenu();
  createWindow();
  if (!ready) {
    mainWindow.webContents.once('did-finish-load', () => {
      const safeRoot = serverRoot.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
      mainWindow.webContents.executeJavaScript(`document.body.innerHTML = '<main style="font-family: system-ui; padding: 32px;"><h1>Book of Life could not start</h1><p>The local desktop host did not respond on ${baseUrl}.</p><p>Server root: ${safeRoot}</p></main>';`);
    });
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

app.on('before-quit', () => {
  if (serverProcess) {
    serverProcess.kill();
    serverProcess = null;
  }
});
