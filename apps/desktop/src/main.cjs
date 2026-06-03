const fs = require('fs');
const net = require('net');
const path = require('path');
const { spawn, spawnSync } = require('child_process');
const { app, BrowserWindow, Menu, Tray, nativeImage, shell, ipcMain, dialog, utilityProcess, screen } = require('electron');

const devProjectRoot = path.resolve(__dirname, '..', '..', '..');
const serverRoot = app.isPackaged
  ? path.join(process.resourcesPath, 'local-server')
  : devProjectRoot;
const appIconPath = path.join(__dirname, '..', 'assets', 'icon.png');
const desktopIconServerPath = app.isPackaged
  ? path.join(process.resourcesPath, 'desktop-assets', 'icon.png')
  : appIconPath;
const trayIconPath = path.join(
  __dirname,
  '..',
  'assets',
  process.platform === 'darwin' ? 'tray-black-32.png' : 'tray-white-32.png'
);

let serverProcess = null;
let mainWindow = null;
let onboardingWindow = null;
let trayWindow = null;
let tray = null;
let desktopPort = 3131;
let baseUrl = 'http://127.0.0.1:3131';
let serverExit = null;
let appQuitting = false;
let intentionalServerStop = false;
let restartAttempts = 0;
let trayStatusSnapshot = null;
let trayStatusTimer = null;
const serverLog = {
  stdout: [],
  stderr: []
};

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
    PORT: String(desktopPort),
    BOOK_OF_LIFE_DESKTOP: '1',
    LIFESERVER_AUTH_ENABLED: process.env.LIFESERVER_AUTH_ENABLED || 'false',
    LIFESERVER_ALLOW_LOCALHOST_VIEWER_BYPASS: 'true',
    LIFESERVER_JOURNAL_VAULT: process.env.LIFESERVER_JOURNAL_VAULT || paths.journalVault,
    LIFESERVER_PHOTO_ROOT: process.env.LIFESERVER_PHOTO_ROOT || paths.photoRoot,
    LIFESERVER_DEVICE_SYNC_ROOT: process.env.LIFESERVER_DEVICE_SYNC_ROOT || paths.deviceSyncRoot,
    LIFESERVER_CACHE_DIR: process.env.LIFESERVER_CACHE_DIR || paths.cacheDir,
    BOOK_OF_LIFE_DESKTOP_ICON_PATH: desktopIconServerPath
  };
}

function parseMajorVersion(output) {
  const match = String(output || '').match(/v?(\d+)\./);
  return match ? Number(match[1]) : 0;
}

function isModernNodeRuntime(executable) {
  if (!executable || !fs.existsSync(executable)) return false;
  const result = spawnSync(executable, ['--version'], { encoding: 'utf8' });
  if (result.status !== 0) return false;
  return parseMajorVersion(result.stdout || result.stderr) >= 18;
}

function findNodeRuntime() {
  const candidates = [
    process.env.BOOK_OF_LIFE_NODE_PATH,
    ...String(process.env.PATH || '')
      .split(path.delimiter)
      .filter(Boolean)
      .map((dir) => path.join(dir, process.platform === 'win32' ? 'node.exe' : 'node'))
  ];
  const seen = new Set();
  for (const candidate of candidates) {
    if (!candidate || seen.has(candidate)) continue;
    seen.add(candidate);
    if (isModernNodeRuntime(candidate)) return { executable: candidate, electronNodeMode: false };
  }
  return { executable: process.execPath, utilityProcess: true };
}

function appendServerLog(type, chunk) {
  const text = String(chunk || '').trim();
  if (!text) return;
  serverLog[type].push(text);
  if (serverLog[type].length > 20) serverLog[type].shift();
}

function canListenOnPort(port) {
  return new Promise((resolve) => {
    const tester = net.createServer();
    tester.once('error', () => resolve(false));
    tester.once('listening', () => {
      tester.close(() => resolve(true));
    });
    tester.listen(port, '127.0.0.1');
  });
}

async function chooseDesktopPort() {
  const requested = Number(process.env.BOOK_OF_LIFE_DESKTOP_PORT || 3131);
  const firstPort = Number.isFinite(requested) && requested > 0 ? Math.floor(requested) : 3131;
  for (let offset = 0; offset < 50; offset += 1) {
    const candidate = firstPort + offset;
    if (await canListenOnPort(candidate)) return candidate;
  }
  return firstPort;
}

function startLocalHost() {
  if (serverProcess) return;
  serverExit = null;
  intentionalServerStop = false;
  serverLog.stdout = [];
  serverLog.stderr = [];
  const serverEntry = path.join(serverRoot, 'server.js');
  const runtime = findNodeRuntime();
  const env = serverEnvironment();
  delete env.ELECTRON_RUN_AS_NODE;
  if (runtime.utilityProcess) {
    console.log('Starting Book of Life local host with Electron utility process.');
    serverProcess = utilityProcess.fork(serverEntry, [], {
      cwd: serverRoot,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
      serviceName: 'Book of Life Local Service'
    });
  } else {
    console.log(`Starting Book of Life local host with ${runtime.executable}.`);
    serverProcess = spawn(runtime.executable, [serverEntry], {
      cwd: serverRoot,
      env,
      stdio: ['ignore', 'pipe', 'pipe']
    });
  }
  serverProcess.stdout?.on('data', (chunk) => {
    appendServerLog('stdout', chunk);
    console.log(`[local-host] ${String(chunk).trim()}`);
  });
  serverProcess.stderr?.on('data', (chunk) => {
    appendServerLog('stderr', chunk);
    console.error(`[local-host] ${String(chunk).trim()}`);
  });
  serverProcess.on('exit', (code, signal) => {
    serverExit = { code, signal };
    console.log(`Book of Life local host exited with code ${code}${signal ? ` and signal ${signal}` : ''}.`);
    serverProcess = null;
    updateTrayMenu();
    if (!appQuitting && !intentionalServerStop) scheduleLocalHostRestart();
  });
  updateTrayMenu();
}

function scheduleLocalHostRestart() {
  if (restartAttempts >= 5) return;
  restartAttempts += 1;
  const delayMs = Math.min(1000 * restartAttempts, 5000);
  setTimeout(() => {
    if (!appQuitting && !serverProcess) startLocalHost();
  }, delayMs);
}

async function stopLocalHost() {
  if (!serverProcess) return;
  intentionalServerStop = true;
  const processToStop = serverProcess;
  processToStop.kill();
  await new Promise((resolve) => {
    processToStop.once('exit', resolve);
    setTimeout(resolve, 2500).unref();
  });
}

async function restartLocalHost() {
  restartAttempts = 0;
  await stopLocalHost();
  intentionalServerStop = false;
  startLocalHost();
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

async function refreshTrayStatusSnapshot() {
  if (!serverProcess) return trayStatusSnapshot;
  try {
    const response = await fetch(`${baseUrl}/api/desktop/tray/status`, { cache: 'no-store' });
    if (!response.ok) throw new Error(`Tray status failed (${response.status})`);
    trayStatusSnapshot = await response.json();
    if (trayWindow && !trayWindow.isDestroyed()) {
      trayWindow.webContents.send('book-of-life:tray-status-snapshot', trayStatusSnapshot);
    }
  } catch (error) {
    trayStatusSnapshot = {
      ok: false,
      error: error.message || 'Tray status unavailable.'
    };
    if (trayWindow && !trayWindow.isDestroyed()) {
      trayWindow.webContents.send('book-of-life:tray-status-snapshot', trayStatusSnapshot);
    }
  }
  return trayStatusSnapshot;
}

function startTrayStatusCache() {
  clearInterval(trayStatusTimer);
  refreshTrayStatusSnapshot().catch(() => {});
  trayStatusTimer = setInterval(() => {
    refreshTrayStatusSnapshot().catch(() => {});
  }, 2000);
  trayStatusTimer.unref?.();
}

function sendTrayStatusSnapshot() {
  if (!trayWindow || trayWindow.isDestroyed() || !trayStatusSnapshot) return;
  trayWindow.webContents.send('book-of-life:tray-status-snapshot', trayStatusSnapshot);
}

function createWindow() {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
    return;
  }
  mainWindow = new BrowserWindow({
    width: 1320,
    height: 900,
    minWidth: 980,
    minHeight: 720,
    title: 'Book of Life',
    icon: appIconPath,
    webPreferences: desktopWebPreferences()
  });
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
  mainWindow.on('closed', () => {
    mainWindow = null;
  });
  mainWindow.loadURL(baseUrl);
}

function createOnboardingWindow() {
  if (onboardingWindow) {
    if (onboardingWindow.isMinimized()) onboardingWindow.restore();
    onboardingWindow.show();
    onboardingWindow.focus();
    return;
  }
  onboardingWindow = new BrowserWindow({
    width: 760,
    height: 620,
    minWidth: 640,
    minHeight: 540,
    center: true,
    resizable: true,
    frame: false,
    title: 'Book of Life Setup',
    icon: appIconPath,
    webPreferences: desktopWebPreferences()
  });
  onboardingWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
  onboardingWindow.on('closed', () => {
    onboardingWindow = null;
  });
  onboardingWindow.loadURL(`${baseUrl}/desktop/onboarding`);
}

function openLibraryWindow() {
  createWindow();
  mainWindow?.loadURL(baseUrl);
  if (onboardingWindow && !onboardingWindow.isDestroyed()) onboardingWindow.close();
}

function openOnboardingWindow() {
  createOnboardingWindow();
}

function createTrayWindow() {
  if (trayWindow) return trayWindow;
  trayWindow = new BrowserWindow({
    width: 360,
    height: 420,
    show: false,
    frame: false,
    resizable: false,
    movable: true,
    skipTaskbar: true,
    title: 'Book of Life Status',
    icon: appIconPath,
    webPreferences: desktopWebPreferences()
  });
  trayWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
  trayWindow.on('blur', () => {
    if (!trayWindow?.webContents.isDevToolsOpened()) trayWindow.hide();
  });
  trayWindow.on('closed', () => {
    trayWindow = null;
  });
  trayWindow.webContents.on('did-finish-load', sendTrayStatusSnapshot);
  trayWindow.loadURL(`${baseUrl}/desktop/tray`);
  return trayWindow;
}

function validTrayBounds(bounds) {
  return bounds &&
    Number.isFinite(bounds.x) &&
    Number.isFinite(bounds.y) &&
    Number(bounds.width || 0) > 0 &&
    Number(bounds.height || 0) > 0;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(value, max));
}

function positionTrayWindow(clickBounds = null) {
  const win = createTrayWindow();
  const cursorPoint = screen.getCursorScreenPoint();
  const anchorPoint = validTrayBounds(clickBounds)
    ? {
        x: clickBounds.x + (clickBounds.width / 2),
        y: clickBounds.y + (clickBounds.height / 2)
      }
    : cursorPoint;
  const display = screen.getDisplayNearestPoint(anchorPoint);
  const workArea = display.workArea;
  const size = win.getBounds();
  const margin = 8;
  const anchorIsRight = anchorPoint.x > workArea.x + (workArea.width / 2);
  const desiredX = anchorIsRight
    ? anchorPoint.x - size.width + 28
    : anchorPoint.x - 28;
  const desiredY = workArea.y + workArea.height - size.height - margin;
  const x = clamp(
    Math.round(desiredX),
    workArea.x + margin,
    workArea.x + workArea.width - size.width - margin
  );
  const y = clamp(
    Math.round(desiredY),
    workArea.y + margin,
    workArea.y + workArea.height - size.height - margin
  );
  win.setPosition(x, y);
}

function toggleTrayWindow(clickBounds = null) {
  const win = createTrayWindow();
  if (win.isVisible()) {
    win.hide();
    return;
  }
  positionTrayWindow(clickBounds);
  sendTrayStatusSnapshot();
  refreshTrayStatusSnapshot().catch(() => {});
  win.show();
  win.focus();
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function localHostDiagnosticHtml() {
  const exitText = serverExit
    ? `Exited with code ${serverExit.code ?? 'unknown'}${serverExit.signal ? ` and signal ${serverExit.signal}` : ''}.`
    : 'Still running or no exit event was received.';
  const stderr = serverLog.stderr.join('\n') || 'No stderr captured.';
  const stdout = serverLog.stdout.join('\n') || 'No stdout captured.';
  return `
    <main style="font-family: system-ui, sans-serif; max-width: 920px; padding: 32px; line-height: 1.5;">
      <h1>Book of Life could not start</h1>
      <p>The local desktop service did not respond at <code>${escapeHtml(baseUrl)}</code>.</p>
      <dl>
        <dt>Server root</dt>
        <dd><code>${escapeHtml(serverRoot)}</code></dd>
        <dt>Port</dt>
        <dd><code>${escapeHtml(desktopPort)}</code></dd>
        <dt>Server process</dt>
        <dd>${escapeHtml(exitText)}</dd>
      </dl>
      <h2>Recent stderr</h2>
      <pre style="white-space: pre-wrap; background: #f6f7f8; padding: 16px; border-radius: 8px;">${escapeHtml(stderr)}</pre>
      <h2>Recent stdout</h2>
      <pre style="white-space: pre-wrap; background: #f6f7f8; padding: 16px; border-radius: 8px;">${escapeHtml(stdout)}</pre>
    </main>
  `;
}

function openSettingsWindow() {
  const settingsWindow = new BrowserWindow({
    width: 1180,
    height: 860,
    minWidth: 900,
    minHeight: 680,
    title: 'Book of Life Desktop Sync',
    icon: appIconPath,
    parent: mainWindow || undefined,
    webPreferences: desktopWebPreferences()
  });
  settingsWindow.loadURL(`${baseUrl}/desktop/settings`);
}

function createTrayImage() {
  const image = nativeImage.createFromPath(trayIconPath);
  if (process.platform === 'darwin') image.setTemplateImage(true);
  return image;
}

function updateTrayMenu() {
  if (!tray) return;
  const serviceLabel = serverProcess
    ? `Local service: running on ${desktopPort}`
    : `Local service: stopped${serverExit?.signal ? ` (${serverExit.signal})` : ''}`;
  tray.setToolTip(`Book of Life - ${serviceLabel}`);
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: serviceLabel, enabled: false },
    { type: 'separator' },
    { label: 'Open Book of Life', click: openLibraryWindow },
    { label: 'Open Onboarding', click: openOnboardingWindow },
    { label: 'Hosting Settings', click: openSettingsWindow },
    { label: 'Open Local Service URL', click: () => shell.openExternal(baseUrl) },
    { label: 'Restart Local Service', click: () => restartLocalHost() },
    { type: 'separator' },
    { label: 'Quit', click: () => {
      appQuitting = true;
      app.quit();
    } }
  ]));
}

function installTray() {
  if (tray) return;
  tray = new Tray(createTrayImage());
  tray.on('click', (_event, bounds) => toggleTrayWindow(bounds));
  updateTrayMenu();
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

ipcMain.handle('book-of-life:tray-status-snapshot', async (event) => {
  const senderUrl = event.senderFrame?.url || '';
  if (!senderUrl.startsWith(baseUrl)) return { ok: false };
  return trayStatusSnapshot || refreshTrayStatusSnapshot();
});

ipcMain.handle('book-of-life:window-control', async (event, action) => {
  const senderUrl = event.senderFrame?.url || '';
  if (!senderUrl.startsWith(baseUrl)) return { ok: false };
  const senderWindow = BrowserWindow.fromWebContents(event.sender);
  if (!senderWindow) return { ok: false };
  if (action === 'minimize') senderWindow.minimize();
  if (action === 'close') senderWindow.close();
  if (action === 'open-library') openLibraryWindow();
  if (action === 'open-onboarding') openOnboardingWindow();
  if (action === 'quit') {
    appQuitting = true;
    app.quit();
  }
  return { ok: true };
});

function installMenu() {
  const template = [
    {
      label: 'Book of Life',
      submenu: [
        { label: 'Open Library', click: openLibraryWindow },
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
  desktopPort = await chooseDesktopPort();
  baseUrl = `http://127.0.0.1:${desktopPort}`;
  startLocalHost();
  const ready = await waitForLocalHost();
  if (ready) restartAttempts = 0;
  installMenu();
  installTray();
  if (ready) startTrayStatusCache();
  if (ready) {
    createOnboardingWindow();
  } else {
    createWindow();
    mainWindow.webContents.once('did-finish-load', () => {
      mainWindow.webContents.executeJavaScript(`document.body.innerHTML = ${JSON.stringify(localHostDiagnosticHtml())};`);
    });
  }
});

app.on('window-all-closed', () => {
  if (!tray && process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

app.on('before-quit', () => {
  appQuitting = true;
  clearInterval(trayStatusTimer);
  if (serverProcess) {
    serverProcess.kill();
    serverProcess = null;
  }
});
