const fs = require('fs');
const http = require('http');
const net = require('net');
const os = require('os');
const path = require('path');
const { spawn, spawnSync } = require('child_process');

const repoRoot = path.resolve(__dirname, '..', '..', '..');
const releaseRoot = path.join(repoRoot, 'apps', 'desktop', 'release');
const localServerRoot = path.join(releaseRoot, 'linux-unpacked', 'resources', 'local-server');
const debPath = path.join(releaseRoot, 'Book of Life-0.1.0-amd64.deb');

function fail(message) {
  console.error(`Linux release verification failed: ${message}`);
  process.exit(1);
}

function assertFile(filePath, label) {
  if (!fs.existsSync(filePath)) fail(`${label} is missing: ${filePath}`);
}

function canListenOnPort(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once('error', () => resolve(false));
    server.once('listening', () => server.close(() => resolve(true)));
    server.listen(port, '127.0.0.1');
  });
}

async function choosePort(startPort = 3181) {
  for (let offset = 0; offset < 80; offset += 1) {
    const port = startPort + offset;
    if (await canListenOnPort(port)) return port;
  }
  fail('could not find an available verification port.');
}

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    const request = http.get(url, (response) => {
      let body = '';
      response.setEncoding('utf8');
      response.on('data', (chunk) => {
        body += chunk;
      });
      response.on('end', () => {
        if (response.statusCode < 200 || response.statusCode >= 300) {
          reject(new Error(`HTTP ${response.statusCode}: ${body}`));
          return;
        }
        try {
          resolve(JSON.parse(body));
        } catch (error) {
          reject(new Error(`invalid JSON: ${error.message}`));
        }
      });
    });
    request.setTimeout(12000, () => {
      request.destroy(new Error('request timed out'));
    });
    request.on('error', reject);
  });
}

async function waitForStatus(port, child, stderrLines) {
  const url = `http://127.0.0.1:${port}/api/desktop/onboarding/status`;
  const startedAt = Date.now();
  while (Date.now() - startedAt < 15000) {
    if (child.exitCode !== null) {
      throw new Error(`packaged local server exited with code ${child.exitCode}. stderr: ${stderrLines.join('\n')}`);
    }
    try {
      return await fetchJson(url);
    } catch (error) {
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }
  throw new Error(`timed out waiting for ${url}. stderr: ${stderrLines.join('\n')}`);
}

async function main() {
  assertFile(path.join(localServerRoot, 'server.js'), 'packaged local server');
  assertFile(path.join(localServerRoot, 'src', 'cloud-config.js'), 'packaged cloud config');
  assertFile(path.join(localServerRoot, 'src', 'config.js'), 'packaged config');

  if (fs.existsSync(debPath)) {
    const result = spawnSync('dpkg-deb', ['--contents', debPath], { encoding: 'utf8' });
    if (result.status === 0 && !result.stdout.includes('./opt/Book of Life/resources/local-server/src/cloud-config.js')) {
      fail(`.deb does not contain src/cloud-config.js: ${debPath}`);
    }
    if (result.status !== 0) {
      console.warn(`Skipping .deb contents check because dpkg-deb failed: ${result.stderr || result.error?.message || 'unknown error'}`);
    }
  } else {
    console.warn(`Skipping .deb contents check because it does not exist yet: ${debPath}`);
  }

  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'book-of-life-release-'));
  const port = await choosePort();
  const stderrLines = [];
  const stdoutLines = [];
  const child = spawn(process.execPath, [path.join(localServerRoot, 'server.js')], {
    cwd: localServerRoot,
    env: {
      ...process.env,
      PORT: String(port),
      BOOK_OF_LIFE_DESKTOP: '1',
      LIFESERVER_AUTH_ENABLED: 'false',
      LIFESERVER_ALLOW_LOCALHOST_VIEWER_BYPASS: 'true',
      LIFESERVER_JOURNAL_VAULT: path.join(tempRoot, 'Journal Vault'),
      LIFESERVER_PHOTO_ROOT: path.join(tempRoot, 'Photos'),
      LIFESERVER_DEVICE_SYNC_ROOT: path.join(tempRoot, 'Device Uploads'),
      LIFESERVER_CACHE_DIR: path.join(tempRoot, 'Cache')
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });

  child.stdout.on('data', (chunk) => {
    stdoutLines.push(String(chunk).trim());
    if (stdoutLines.length > 20) stdoutLines.shift();
  });
  child.stderr.on('data', (chunk) => {
    stderrLines.push(String(chunk).trim());
    if (stderrLines.length > 20) stderrLines.shift();
  });

  try {
    const status = await waitForStatus(port, child, stderrLines);
    if (status?.desktop !== true) fail('onboarding status did not report desktop: true.');
    if (status?.cloud?.configured !== true) fail('onboarding status did not report cloud.configured: true.');
    console.log(`Linux release verification passed on port ${port}.`);
  } finally {
    child.kill();
    await new Promise((resolve) => {
      child.once('exit', resolve);
      setTimeout(resolve, 1500).unref();
    });
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

main().catch((error) => fail(error.message || String(error)));
