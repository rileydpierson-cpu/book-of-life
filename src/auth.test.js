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

function createResponseRecorder() {
  return {
    statusCode: 200,
    jsonPayload: null,
    redirectTarget: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.jsonPayload = payload;
      return this;
    },
    redirect(target) {
      this.redirectTarget = target;
      return this;
    }
  };
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

  it('can bypass viewer auth for localhost only when enabled', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'book-of-life-auth-'));
    const userStorePath = path.join(root, 'users.json');
    const service = new AuthService({
      auth: {
        enabled: true,
        allowLocalhostViewerBypass: true,
        allowedUsers: ['alice', 'bob'],
        userStorePath,
        sessionDays: 30,
        secureCookie: false
      }
    });

    try {
      const middleware = service.middleware();
      const localReq = {
        path: '/',
        headers: { host: 'localhost:3000' },
        socket: { remoteAddress: '127.0.0.1' },
        connection: { remoteAddress: '127.0.0.1' },
        ip: '127.0.0.1'
      };
      const localRes = createResponseRecorder();
      let localNextCalled = false;
      middleware(localReq, localRes, () => {
        localNextCalled = true;
      });
      expect(localNextCalled).toBe(true);
      expect(localReq.authenticated).toBe(true);
      expect(localReq.sessionInfo?.localhostBypass).toBe(true);

      const remoteReq = {
        path: '/',
        headers: { host: '192.168.1.50:3000' },
        socket: { remoteAddress: '192.168.1.10' },
        connection: { remoteAddress: '192.168.1.10' },
        ip: '192.168.1.10'
      };
      const remoteRes = createResponseRecorder();
      middleware(remoteReq, remoteRes, () => {});
      expect(remoteRes.redirectTarget).toBe('/login');

      const localApiReq = {
        path: '/api/bootstrap',
        headers: { host: '[::1]:3000' },
        socket: { remoteAddress: '::1' },
        connection: { remoteAddress: '::1' },
        ip: '::1'
      };
      const localApiRes = createResponseRecorder();
      let localApiNextCalled = false;
      middleware(localApiReq, localApiRes, () => {
        localApiNextCalled = true;
      });
      expect(localApiNextCalled).toBe(true);
      expect(localApiReq.sessionInfo?.localhostBypass).toBe(true);

      const proxiedRemoteReq = {
        path: '/',
        headers: { host: 'photos.example.com', 'x-forwarded-for': '198.51.100.24' },
        socket: { remoteAddress: '127.0.0.1' },
        connection: { remoteAddress: '127.0.0.1' },
        ip: '127.0.0.1'
      };
      const proxiedRemoteRes = createResponseRecorder();
      middleware(proxiedRemoteReq, proxiedRemoteRes, () => {});
      expect(proxiedRemoteRes.redirectTarget).toBe('/login');
    } finally {
      clearInterval(service.cleanupInterval);
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
