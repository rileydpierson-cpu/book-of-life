import fs from 'fs';
import os from 'os';
import path from 'path';
import { createRequire } from 'module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const { AuthService } = require('./auth.js');

function createAuthService() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'book-of-life-auth-'));
  const userStorePath = path.join(root, 'users.json');
  const service = new AuthService({
    auth: {
      enabled: true,
      allowedUsers: ['alice', 'bob'],
      userStorePath,
      sessionDays: 30,
      secureCookie: false
    }
  });
  return { root, userStorePath, service };
}

describe('auth service', () => {
  it('creates users, logs them in, and changes passwords', () => {
    const { service, userStorePath } = createAuthService();
    try {
      const created = service.signup('Alice', 'correct horse battery');
      expect(created.username).toBe('alice');
      expect(fs.existsSync(userStorePath)).toBe(true);

      const loggedIn = service.login('alice', 'correct horse battery');
      expect(loggedIn.username).toBe('alice');

      const changed = service.changePassword('alice', 'correct horse battery', 'new stronger passphrase');
      expect(changed.username).toBe('alice');
      expect(() => service.login('alice', 'correct horse battery')).toThrow(/not accepted/i);
      expect(service.login('alice', 'new stronger passphrase').username).toBe('alice');
    } finally {
      clearInterval(service.cleanupInterval);
    }
  });

  it('only allows signup for approved usernames', () => {
    const { service } = createAuthService();
    try {
      expect(() => service.signup('mallory', 'correct horse battery')).toThrow(/not approved/i);
    } finally {
      clearInterval(service.cleanupInterval);
    }
  });
});
