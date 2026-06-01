#!/usr/bin/env node
/**
 * Update GitHub Pages current-url.json with the tunnel URL
 * 
 * Usage: node scripts/update-github-pages-url.js <tunnel-url>
 */

const https = require('https');
const path = require('path');
const { loadConfig } = require('../src/config');

loadConfig(path.join(__dirname, '..'));

const tunnelUrl = process.argv[2];
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const GITHUB_OWNER = process.env.GITHUB_OWNER || extractOwnerFromGit();
const GITHUB_REPO = process.env.GITHUB_REPO || extractRepoFromGit();
const GITHUB_BRANCH = process.env.GITHUB_BRANCH || 'main';

if (!tunnelUrl) {
  console.error('❌ Usage: node scripts/update-github-pages-url.js <tunnel-url>');
  process.exit(1);
}

if (!GITHUB_TOKEN) {
  console.error('❌ GITHUB_TOKEN environment variable is required');
  process.exit(1);
}

if (!GITHUB_OWNER || !GITHUB_REPO) {
  console.error('❌ Could not determine GitHub owner/repo. Set GITHUB_OWNER and GITHUB_REPO in .env');
  process.exit(1);
}

/**
 * Extract GitHub owner from git remote
 */
function extractOwnerFromGit() {
  try {
    const { execSync } = require('child_process');
    const url = execSync('git config --get remote.origin.url', { encoding: 'utf8' }).trim();
    const match = url.match(/(?:https:\/\/github\.com\/|git@github\.com:)([^/]+)\/([^/.]+)/);
    return match ? match[1] : null;
  } catch {
    return null;
  }
}

/**
 * Extract GitHub repo from git remote
 */
function extractRepoFromGit() {
  try {
    const { execSync } = require('child_process');
    const url = execSync('git config --get remote.origin.url', { encoding: 'utf8' }).trim();
    const match = url.match(/(?:https:\/\/github\.com\/|git@github\.com:)([^/]+)\/([^/.]+)/);
    return match ? match[2].replace(/\.git$/, '') : null;
  } catch {
    return null;
  }
}

/**
 * Make GitHub API request
 */
function makeGitHubApiRequest(method, filePath, body = null) {
  return new Promise((resolve, reject) => {
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
 * Update GitHub Pages
 */
async function updateGitHubPages() {
  const filePath = 'docs/current-url.json';
  const content = JSON.stringify({ url: tunnelUrl, updatedAt: new Date().toISOString() }, null, 2);
  const encodedContent = Buffer.from(content).toString('base64');

  // Get current file SHA
  let sha = null;
  try {
    const getResponse = await makeGitHubApiRequest('GET', filePath);
    sha = getResponse.sha;
  } catch (error) {
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
  } catch (error) {
    console.error(`❌ Failed to update GitHub Pages:`, error.message);
    process.exit(1);
  }
}

updateGitHubPages();
