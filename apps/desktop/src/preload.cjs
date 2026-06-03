const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('bookOfLifeDesktop', {
  async pickDirectory() {
    const result = await ipcRenderer.invoke('book-of-life:pick-directory');
    return result && typeof result === 'object' ? result : { canceled: true, path: '' };
  },
  async minimizeWindow() {
    return ipcRenderer.invoke('book-of-life:window-control', 'minimize');
  },
  async closeWindow() {
    return ipcRenderer.invoke('book-of-life:window-control', 'close');
  },
  async openLibrary() {
    return ipcRenderer.invoke('book-of-life:window-control', 'open-library');
  },
  async openOnboarding() {
    return ipcRenderer.invoke('book-of-life:window-control', 'open-onboarding');
  },
  async quitApp() {
    return ipcRenderer.invoke('book-of-life:window-control', 'quit');
  }
});
