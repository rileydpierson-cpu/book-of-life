const path = require('path');
const { defineConfig } = require('vite');

module.exports = defineConfig({
  publicDir: false,
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        app: path.resolve(__dirname, 'index.html'),
        editor: path.resolve(__dirname, 'editor.html'),
        login: path.resolve(__dirname, 'login.html')
      }
    }
  }
});
