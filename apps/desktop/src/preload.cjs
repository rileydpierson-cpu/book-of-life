const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('bookOfLifeDesktop', {
  async pickDirectory() {
    const result = await ipcRenderer.invoke('book-of-life:pick-directory');
    return result && typeof result === 'object' ? result : { canceled: true, path: '' };
  }
});
