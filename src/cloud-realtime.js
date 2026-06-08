const { createClient } = require('@supabase/supabase-js');

function hasRealtimeSettings(settings = {}) {
  return Boolean(
    settings.supabaseUrl &&
    settings.supabasePublishableKey &&
    settings.libraryId &&
    settings.cloudSession?.accessToken
  );
}

class CloudRealtimeWakeup {
  constructor({ getSettings, onChange, logger = console, debounceMs = 1200 } = {}) {
    this.getSettings = getSettings;
    this.onChange = onChange;
    this.logger = logger;
    this.debounceMs = debounceMs;
    this.client = null;
    this.channel = null;
    this.started = false;
    this.timer = null;
    this.activeKey = '';
    this.status = {
      enabled: false,
      connected: false,
      libraryId: '',
      lastEventAt: '',
      lastStartedAt: '',
      lastError: ''
    };
  }

  getStatus() {
    return { ...this.status };
  }

  async start(reason = 'startup') {
    this.started = true;
    const settings = await this.getSettings();
    return this.applySettings(settings, reason);
  }

  async refresh(reason = 'settings') {
    if (!this.started) return this.start(reason);
    const settings = await this.getSettings();
    return this.applySettings(settings, reason);
  }

  async applySettings(settings = {}, reason = 'settings') {
    if (!hasRealtimeSettings(settings)) {
      await this.stop();
      this.status = {
        ...this.status,
        enabled: false,
        connected: false,
        libraryId: settings.libraryId || '',
        lastError: ''
      };
      return this.getStatus();
    }

    const nextKey = [
      settings.supabaseUrl,
      settings.supabasePublishableKey,
      settings.libraryId,
      settings.cloudSession.accessToken
    ].join('|');
    if (this.channel && this.activeKey === nextKey) return this.getStatus();

    await this.stop();
    this.activeKey = nextKey;
    this.status = {
      ...this.status,
      enabled: true,
      connected: false,
      libraryId: settings.libraryId,
      lastStartedAt: new Date().toISOString(),
      lastError: ''
    };

    try {
      this.client = createClient(settings.supabaseUrl, settings.supabasePublishableKey, {
        auth: {
          autoRefreshToken: false,
          persistSession: false
        }
      });
      this.client.realtime.setAuth(settings.cloudSession.accessToken);
      this.channel = this.client
        .channel(`book-of-life-sync-${settings.libraryId}`)
        .on(
          'postgres_changes',
          {
            event: 'INSERT',
            schema: 'public',
            table: 'sync_changes',
            filter: `library_id=eq.${settings.libraryId}`
          },
          (payload) => this.handleChange(payload)
        )
        .subscribe((state, error) => {
          this.status.connected = state === 'SUBSCRIBED';
          if (error) {
            this.status.lastError = error.message || String(error);
            this.logger.warn?.(`Cloud realtime wake-up skipped (${reason}): ${this.status.lastError}`);
          }
        });
    } catch (error) {
      this.status.lastError = error.message || 'Cloud realtime setup failed.';
      this.logger.warn?.(`Cloud realtime wake-up setup failed (${reason}): ${this.status.lastError}`);
      await this.stop();
    }
    return this.getStatus();
  }

  handleChange(payload = {}) {
    this.status.lastEventAt = new Date().toISOString();
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(async () => {
      this.timer = null;
      try {
        await this.onChange?.({
          reason: 'cloud-realtime',
          change: payload.new || null
        });
      } catch (error) {
        this.status.lastError = error.message || 'Cloud realtime wake-up failed.';
        this.logger.warn?.(`Cloud realtime wake-up failed: ${this.status.lastError}`);
      }
    }, this.debounceMs);
    this.timer.unref?.();
  }

  async stop() {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (this.channel && this.client) {
      await this.client.removeChannel(this.channel).catch(() => null);
    }
    this.channel = null;
    this.client = null;
    this.activeKey = '';
    this.status.connected = false;
  }
}

module.exports = {
  CloudRealtimeWakeup,
  hasRealtimeSettings
};
