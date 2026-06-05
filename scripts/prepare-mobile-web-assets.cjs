const fs = require('fs');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..');
const distDir = path.join(repoRoot, 'dist');
const mobileAssetsDir = path.join(repoRoot, 'apps', 'mobile', 'android', 'app', 'src', 'main', 'assets', 'mobile-web');

function copyDirectory(source, target) {
  fs.mkdirSync(target, { recursive: true });
  for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
    const sourcePath = path.join(source, entry.name);
    const targetPath = path.join(target, entry.name);
    if (entry.isDirectory()) {
      copyDirectory(sourcePath, targetPath);
      continue;
    }
    if (entry.isFile()) {
      fs.copyFileSync(sourcePath, targetPath);
    }
  }
}

if (!fs.existsSync(path.join(distDir, 'index.html'))) {
  throw new Error('dist/index.html was not found. Run `npm run build` before preparing mobile web assets.');
}

fs.rmSync(mobileAssetsDir, { recursive: true, force: true });
copyDirectory(distDir, mobileAssetsDir);

console.log(`Prepared mobile web assets in ${path.relative(repoRoot, mobileAssetsDir)}`);
