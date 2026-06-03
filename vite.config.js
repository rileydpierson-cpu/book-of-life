const path = require('path');
const { defineConfig } = require('vite');

module.exports = defineConfig({
  publicDir: false,
  test: {
    exclude: ['**/node_modules/**', '**/dist/**', '**/apps/desktop/release/**']
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        app: path.resolve(__dirname, 'index.html'),
        editor: path.resolve(__dirname, 'editor.html'),
        login: path.resolve(__dirname, 'login.html'),
        desktopSettings: path.resolve(__dirname, 'desktop-settings.html'),
        desktopOnboarding: path.resolve(__dirname, 'desktop-onboarding.html'),
        desktopTray: path.resolve(__dirname, 'desktop-tray.html')
      }
    }
  }
});
