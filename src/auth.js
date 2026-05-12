const crypto = require('crypto');

function parseCookies(headerValue) {
  const raw = String(headerValue || '');
  if (!raw) return {};
  return raw.split(';').reduce((acc, pair) => {
    const index = pair.indexOf('=');
    if (index === -1) return acc;
    const key = pair.slice(0, index).trim();
    const value = decodeURIComponent(pair.slice(index + 1).trim());
    if (key) acc[key] = value;
    return acc;
  }, {});
}

function constantTimeSecretMatch(left, right) {
  const hashLeft = crypto.createHash('sha256').update(String(left || ''), 'utf8').digest();
  const hashRight = crypto.createHash('sha256').update(String(right || ''), 'utf8').digest();
  return crypto.timingSafeEqual(hashLeft, hashRight);
}

class AuthService {
  constructor(config) {
    this.config = config.auth || {};
    this.enabled = Boolean(this.config.enabled && this.config.accessSecret);
    this.cookieName = 'lifeserver_session';
    this.sessions = new Map();
    this.loginAttempts = new Map();
    this.sessionTtlMs = Math.max(1, Number(this.config.sessionDays || 30)) * 24 * 60 * 60 * 1000;
    this.cleanupInterval = setInterval(() => this.cleanup(), 30 * 60 * 1000);
    this.cleanupInterval.unref();
  }

  cleanup() {
    const now = Date.now();
    for (const [token, session] of this.sessions.entries()) {
      if (!session || session.expiresAt <= now) this.sessions.delete(token);
    }
    for (const [ip, attempt] of this.loginAttempts.entries()) {
      if (!attempt || (attempt.blockedUntil && attempt.blockedUntil <= now && attempt.count === 0)) {
        this.loginAttempts.delete(ip);
      }
    }
  }

  isProtectedApiPath(req) {
    return req.path.startsWith('/api/') || req.path.startsWith('/media/');
  }

  isPublicAssetPath(req) {
    return req.path.startsWith('/assets/');
  }

  isPublicSyncPath(req) {
    return req.path.startsWith('/api/sync/');
  }

  setSessionCookie(res, token) {
    const maxAgeSeconds = Math.floor(this.sessionTtlMs / 1000);
    const parts = [
      `${this.cookieName}=${encodeURIComponent(token)}`,
      'Path=/',
      'HttpOnly',
      'SameSite=Lax',
      `Max-Age=${maxAgeSeconds}`
    ];
    if (this.config.secureCookie) parts.push('Secure');
    res.setHeader('Set-Cookie', parts.join('; '));
  }

  clearSessionCookie(res) {
    const parts = [
      `${this.cookieName}=`,
      'Path=/',
      'HttpOnly',
      'SameSite=Lax',
      'Max-Age=0'
    ];
    if (this.config.secureCookie) parts.push('Secure');
    res.setHeader('Set-Cookie', parts.join('; '));
  }

  getSessionToken(req) {
    const cookies = parseCookies(req.headers.cookie);
    return cookies[this.cookieName] || null;
  }

  getSession(req) {
    if (!this.enabled) return { authenticated: true };
    const token = this.getSessionToken(req);
    if (!token) return null;
    const session = this.sessions.get(token);
    if (!session) return null;
    if (session.expiresAt <= Date.now()) {
      this.sessions.delete(token);
      return null;
    }
    session.expiresAt = Date.now() + this.sessionTtlMs;
    return session;
  }

  middleware() {
    return (req, res, next) => {
      if (!this.enabled) {
        req.authenticated = true;
        next();
        return;
      }

      const session = this.getSession(req);
      if (session) {
        req.authenticated = true;
        req.sessionInfo = session;
        next();
        return;
      }

      if (this.isProtectedApiPath(req)) {
        if (this.isPublicSyncPath(req)) {
          next();
          return;
        }
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }

      if (this.isPublicAssetPath(req)) {
        next();
        return;
      }

      res.redirect('/login');
    };
  }

  getAttemptBucket(ip) {
    const key = String(ip || 'unknown');
    const now = Date.now();
    const existing = this.loginAttempts.get(key) || { count: 0, blockedUntil: 0, lastAttemptAt: 0 };
    if (existing.blockedUntil && existing.blockedUntil <= now) {
      existing.count = 0;
      existing.blockedUntil = 0;
    }
    return { key, record: existing };
  }

  canAttemptLogin(ip) {
    const { record } = this.getAttemptBucket(ip);
    const now = Date.now();
    if (record.blockedUntil && record.blockedUntil > now) {
      return { ok: false, retryAfterMs: record.blockedUntil - now };
    }
    return { ok: true, retryAfterMs: 0 };
  }

  recordFailedLogin(ip) {
    const { key, record } = this.getAttemptBucket(ip);
    const now = Date.now();
    if (!record.lastAttemptAt || now - record.lastAttemptAt > 15 * 60 * 1000) {
      record.count = 0;
      record.blockedUntil = 0;
    }
    record.count += 1;
    record.lastAttemptAt = now;
    if (record.count >= 5) {
      record.blockedUntil = now + 10 * 60 * 1000;
      record.count = 0;
    }
    this.loginAttempts.set(key, record);
  }

  recordSuccessfulLogin(ip) {
    const key = String(ip || 'unknown');
    this.loginAttempts.delete(key);
  }

  createSession() {
    const token = crypto.randomBytes(32).toString('hex');
    this.sessions.set(token, {
      createdAt: Date.now(),
      expiresAt: Date.now() + this.sessionTtlMs
    });
    return token;
  }

  destroySession(req, res) {
    const token = this.getSessionToken(req);
    if (token) this.sessions.delete(token);
    this.clearSessionCookie(res);
  }

  authenticate(secret) {
    if (!this.enabled) return true;
    return constantTimeSecretMatch(secret, this.config.accessSecret);
  }
}

module.exports = { AuthService };
