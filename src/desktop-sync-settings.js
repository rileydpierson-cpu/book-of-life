const path = require('path');
const { normalizeDesktopSyncSettings } = require('../shared/sync-contracts');
const { readJson, writeJson } = require('./utils');

class DesktopSyncSettingsStore {
  constructor({ cacheDir }) {
    this.settingsPath = path.join(cacheDir, 'desktop-sync-settings.json');
    this.state = normalizeDesktopSyncSettings();
    this.loaded = false;
  }

  async init() {
    const cached = await readJson(this.settingsPath, null);
    this.state = normalizeDesktopSyncSettings(cached || {});
    this.loaded = true;
    return this.state;
  }

  async ensureLoaded() {
    if (!this.loaded) await this.init();
  }

  async getSettings() {
    await this.ensureLoaded();
    return this.state;
  }

  async saveSettings(nextSettings) {
    await this.ensureLoaded();
    this.state = normalizeDesktopSyncSettings({
      ...this.state,
      ...(nextSettings || {})
    });
    await writeJson(this.settingsPath, this.state);
    return this.state;
  }
}

module.exports = {
  DesktopSyncSettingsStore
};
