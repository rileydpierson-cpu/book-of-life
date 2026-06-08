const fs = require('fs');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..');
const distDir = path.join(repoRoot, 'dist');
const mobileAssetsDir = path.join(repoRoot, 'apps', 'mobile', 'android', 'app', 'src', 'main', 'assets', 'mobile-web');
const vendorAssets = [
  ['phosphor/regular', 'node_modules/@phosphor-icons/web/src/regular'],
  ['phosphor/fill', 'node_modules/@phosphor-icons/web/src/fill'],
  ['phosphor/duotone', 'node_modules/@phosphor-icons/web/src/duotone'],
  ['phosphor/bold', 'node_modules/@phosphor-icons/web/src/bold'],
  ['exifr', 'node_modules/exifr/dist'],
  ['markdown-it', 'node_modules/markdown-it']
];

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
for (const [targetPath, sourcePath] of vendorAssets) {
  copyDirectory(path.join(repoRoot, sourcePath), path.join(mobileAssetsDir, 'vendor', targetPath));
}
fs.mkdirSync(path.join(mobileAssetsDir, 'desktop', 'assets'), { recursive: true });
fs.copyFileSync(
  path.join(repoRoot, 'apps', 'mobile', 'assets', 'icon.png'),
  path.join(mobileAssetsDir, 'desktop', 'assets', 'icon.png')
);

console.log(`Prepared mobile web assets in ${path.relative(repoRoot, mobileAssetsDir)}`);
