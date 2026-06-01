#!/usr/bin/env node
/**
 * Start server with localtunnel tunnel and update GitHub Pages redirect
 * 
 * This script:
 * 1. Starts the Express server on localhost:3000
 * 2. Creates a localtunnel public URL
 * 3. Updates GitHub Pages (docs/current-url.json) with the tunnel URL via GitHub API
 * 4. Prints tunnel information to console
 * 5. Handles cleanup on exit
 */

const { spawn } = require('child_process');
const localtunnel = require('localtunnel');
const path = require('path');
const https = require('https');
const { loadConfig } = require('../src/config');

const PROJECT_ROOT = path.join(__dirname, '..');
const CONFIG = loadConfig(PROJECT_ROOT);
const PORT = Number(CONFIG.server.port || 3000);
const SERVER_SCRIPT = path.join(__dirname, '..', 'server.js');

// GitHub Pages config
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const GITHUB_OWNER = process.env.GITHUB_OWNER || extractOwnerFromGit();
const GITHUB_REPO = process.env.GITHUB_REPO || extractRepoFromGit();
const GITHUB_BRANCH = process.env.GITHUB_BRANCH || 'main';

let tunnel = null;
let serverProcess = null;

/**
 * Extract GitHub owner and repo from git remote
 */
function extractOwnerFromGit() {
  try {
    const { execSync } = require('child_process');
    const url = execSync('git config --get remote.origin.url', { encoding: 'utf8' }).trim();
    // Handle both HTTPS and SSH formats
    const match = url.match(/(?:https:\/\/github\.com\/|git@github\.com:)([^/]+)\/([^/.]+)/);
    return match ? match[1] : null;
  } catch {
    return null;
  }
}

/**
 * Extract GitHub repo name from git remote
 */
function extractRepoFromGit() {
  try {
    const { execSync } = require('child_process');
    const url = execSync('git config --get remote.origin.url', { encoding: 'utf8' }).trim();
    // Handle both HTTPS and SSH formats
    const match = url.match(/(?:https:\/\/github\.com\/|git@github\.com:)([^/]+)\/([^/.]+)/);
    return match ? match[2].replace(/\.git$/, '') : null;
  } catch {
    return null;
  }
}

/**
 * Update GitHub Pages current-url.json via GitHub API
 */
async function updateGitHubPages(tunnelUrl) {
  if (!GITHUB_TOKEN || !GITHUB_OWNER || !GITHUB_REPO) {
    console.warn('\n⚠️  Skipping GitHub Pages update: Missing GITHUB_TOKEN, GITHUB_OWNER, or GITHUB_REPO');
    console.warn('   Set GITHUB_TOKEN in .env to enable automatic GitHub Pages updates\n');
    return false;
  }

  const filePath = 'docs/current-url.json';
  const content = JSON.stringify({ url: tunnelUrl, updatedAt: new Date().toISOString() }, null, 2);
  const encodedContent = Buffer.from(content).toString('base64');

  // First, try to get the current file SHA (needed for updates)
  let sha = null;
  try {
    const getResponse = await makeGitHubApiRequest('GET', filePath);
    sha = getResponse.sha;
  } catch (error) {
    // File might not exist yet, that's OK
    console.log('📄 Creating docs/current-url.json for the first time...');
  }

  // Create or update the file
  const requestBody = {
    message: `Update tunnel URL: ${tunnelUrl}`,
    content: encodedContent,
    branch: GITHUB_BRANCH,
  };

  if (sha) {
    requestBody.sha = sha;
  }

  try {
    await makeGitHubApiRequest('PUT', filePath, requestBody);
    console.log(`✅ Updated GitHub Pages: ${tunnelUrl}`);
    return true;
  } catch (error) {
    console.error(`❌ Failed to update GitHub Pages:`, error.message);
    return false;
  }
}

/**
 * Make a GitHub API request
 */
function makeGitHubApiRequest(method, filePath, body = null) {
  return new Promise((resolve, reject) => {
    const url = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${filePath}`;

    const options = {
      hostname: 'api.github.com',
      path: `/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${filePath}`,
      method,
      headers: {
        'Authorization': `token ${GITHUB_TOKEN}`,
        'User-Agent': 'Book-of-Life',
        'Accept': 'application/vnd.github.v3+json',
        'Content-Type': 'application/json',
      },
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => (data += chunk));
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          if (res.statusCode >= 400) {
            reject(new Error(`GitHub API error: ${res.statusCode} - ${parsed.message}`));
          } else {
            resolve(parsed);
          }
        } catch {
          reject(new Error(`Failed to parse GitHub API response: ${data}`));
        }
      });
    });

    req.on('error', reject);

    if (body) {
      req.write(JSON.stringify(body));
    }

    req.end();
  });
}

/**
 * Start the Express server
 */
function startServer() {
  return new Promise((resolve, reject) => {
    console.log(`🚀 Starting server on localhost:${PORT}...`);
    serverProcess = spawn('node', [SERVER_SCRIPT], { stdio: 'inherit' });

    serverProcess.on('error', reject);
    serverProcess.on('close', (code) => {
      console.log(`\n⚠️  Server exited with code ${code}`);
      process.exit(code);
    });

    // Wait a bit for server to start, then resolve
    setTimeout(resolve, 1000);
  });
}

/**
 * Create localtunnel tunnel
 */
async function createTunnel() {
  try {
    console.log('🌐 Creating localtunnel tunnel...');
    tunnel = await localtunnel({ port: PORT });
    const tunnelUrl = tunnel.url;

    console.log(`\n✨ Tunnel ready!`);
    console.log(`   Public URL: ${tunnelUrl}`);
    console.log(`   Local URL:  http://localhost:${PORT}\n`);

    // Update GitHub Pages with the tunnel URL
    await updateGitHubPages(tunnelUrl);

    tunnel.on('close', () => {
      console.log('\n⚠️  Tunnel closed');
      process.exit(0);
    });

    return tunnelUrl;
  } catch (error) {
    console.error('❌ Failed to create tunnel:', error.message);
    process.exit(1);
  }
}

/**
 * Handle graceful shutdown
 */
function handleShutdown() {
  console.log('\n🛑 Shutting down...');

  if (tunnel) {
    tunnel.close();
  }

  if (serverProcess) {
    serverProcess.kill('SIGTERM');
  }

  process.exit(0);
}

/**
 * Main execution
 */
async function main() {
  console.log('📖 Book of Life - Starting with public tunnel\n');
  console.log(`   GitHub Pages will be updated to redirect to the public URL\n`);

  process.on('SIGINT', handleShutdown);
  process.on('SIGTERM', handleShutdown);

  try {
    await startServer();
    await createTunnel();
  } catch (error) {
    console.error('❌ Startup failed:', error);
    process.exit(1);
  }
}

main();
