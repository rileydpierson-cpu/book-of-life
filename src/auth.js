const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { ensureDirSync } = require('./utils');

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

function normalizeUsername(value) {
  return String(value || '').trim().toLowerCase();
}

function validateUsername(value) {
  const normalized = normalizeUsername(value);
  if (!normalized) return 'Enter a username.';
  if (normalized.length < 3) return 'Username must be at least 3 characters.';
  if (normalized.length > 32) return 'Username must be 32 characters or fewer.';
  if (!/^[a-z0-9](?:[a-z0-9._-]*[a-z0-9])?$/.test(normalized)) {
    return 'Usernames may only use letters, numbers, periods, underscores, or hyphens.';
  }
  return '';
}

function validatePassword(value) {
  const password = String(value || '');
  if (!password) return 'Enter a password.';
  if (password.length < 8) return 'Password must be at least 8 characters.';
  if (password.length > 256) return 'Password is too long.';
  return '';
}

function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const passwordHash = crypto.scryptSync(String(password || ''), salt, 64).toString('hex');
  return { passwordHash, passwordSalt: salt };
}

function verifyPassword(password, passwordHash, passwordSalt) {
  if (!passwordHash || !passwordSalt) return false;
  const left = Buffer.from(String(passwordHash || ''), 'hex');
  const right = Buffer.from(hashPassword(password, passwordSalt).passwordHash, 'hex');
  if (left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}

function isLoopbackAddress(value) {
  const normalized = String(value || '').trim().toLowerCase();
  if (!normalized) return false;
  if (normalized === '::1' || normalized === '::ffff:127.0.0.1') return true;
  return normalized === '127.0.0.1' || normalized.startsWith('127.');
}

function normalizeHostName(value) {
  const raw = String(value || '').trim().toLowerCase();
  if (!raw) return '';
  if (raw.startsWith('[')) {
    const closingIndex = raw.indexOf(']');
    if (closingIndex !== -1) return raw.slice(1, closingIndex);
  }
  const colonIndex = raw.indexOf(':');
  return colonIndex === -1 ? raw : raw.slice(0, colonIndex);
}

class AuthService {
  constructor(config) {
    this.config = config.auth || {};
    this.enabled = Boolean(this.config.enabled);
    this.allowLocalhostViewerBypass = Boolean(this.config.allowLocalhostViewerBypass);
    this.cookieName = 'lifeserver_session';
    this.sessions = new Map();
    this.loginAttempts = new Map();
    this.sessionTtlMs = Math.max(1, Number(this.config.sessionDays || 30)) * 24 * 60 * 60 * 1000;
    this.allowedUsers = new Set((this.config.allowedUsers || []).map(normalizeUsername).filter(Boolean));
    this.userStorePath = path.resolve(String(this.config.userStorePath || './storage/auth/users.json'));
    this.users = this.loadUsers();
    this.cleanupInterval = setInterval(() => this.cleanup(), 30 * 60 * 1000);
    this.cleanupInterval.unref();
  }

  loadUsers() {
    if (!this.enabled) return new Map();
    ensureDirSync(path.dirname(this.userStorePath));
    if (!fs.existsSync(this.userStorePath)) return new Map();

    try {
      const raw = JSON.parse(fs.readFileSync(this.userStorePath, 'utf8'));
      const records = Array.isArray(raw?.users) ? raw.users : [];
      const users = new Map();
      for (const item of records) {
        const username = normalizeUsername(item?.username);
        if (!username || !item?.passwordHash || !item?.passwordSalt) continue;
        users.set(username, {
          username,
          passwordHash: String(item.passwordHash),
          passwordSalt: String(item.passwordSalt),
          createdAt: Number(item.createdAt) || Date.now(),
          updatedAt: Number(item.updatedAt) || Date.now()
        });
      }
      return users;
    } catch (error) {
      return new Map();
    }
  }

  persistUsers() {
    ensureDirSync(path.dirname(this.userStorePath));
    const payload = {
      users: Array.from(this.users.values())
        .sort((left, right) => left.username.localeCompare(right.username))
        .map((user) => ({
          username: user.username,
          passwordHash: user.passwordHash,
          passwordSalt: user.passwordSalt,
          createdAt: user.createdAt,
          updatedAt: user.updatedAt
        }))
    };
    fs.writeFileSync(this.userStorePath, JSON.stringify(payload, null, 2), 'utf8');
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

  isLocalhostViewerRequest(req) {
    if (!this.enabled || !this.allowLocalhostViewerBypass) return false;
    if (this.isPublicSyncPath(req)) return false;
    const hostName = normalizeHostName(req.headers?.host || req.hostname || '');
    if (!isLoopbackAddress(hostName) && hostName !== 'localhost') return false;
    const remoteAddress = req.socket?.remoteAddress || req.connection?.remoteAddress || req.ip || '';
    return isLoopbackAddress(remoteAddress);
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
    if (!this.enabled) return { authenticated: true, username: null };
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

      if (this.isLocalhostViewerRequest(req)) {
        req.authenticated = true;
        req.sessionInfo = { username: null, localhostBypass: true };
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

  createSession(username) {
    const token = crypto.randomBytes(32).toString('hex');
    this.sessions.set(token, {
      username: normalizeUsername(username),
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

  isUsernameAllowed(username) {
    return this.allowedUsers.has(normalizeUsername(username));
  }

  signup(username, password) {
    if (!this.enabled) return { ok: true, username: null };

    const usernameError = validateUsername(username);
    if (usernameError) {
      const error = new Error(usernameError);
      error.statusCode = 400;
      throw error;
    }

    const passwordError = validatePassword(password);
    if (passwordError) {
      const error = new Error(passwordError);
      error.statusCode = 400;
      throw error;
    }

    const normalized = normalizeUsername(username);
    if (!this.isUsernameAllowed(normalized)) {
      const error = new Error('That username is not approved for access. Add it to LIFESERVER_ALLOWED_USERS first.');
      error.statusCode = 403;
      throw error;
    }
    if (this.users.has(normalized)) {
      const error = new Error('That username already exists.');
      error.statusCode = 409;
      throw error;
    }

    const now = Date.now();
    const { passwordHash, passwordSalt } = hashPassword(password);
    this.users.set(normalized, {
      username: normalized,
      passwordHash,
      passwordSalt,
      createdAt: now,
      updatedAt: now
    });
    this.persistUsers();
    return { ok: true, username: normalized };
  }

  login(username, password) {
    if (!this.enabled) return { ok: true, username: null };

    const normalized = normalizeUsername(username);
    const user = this.users.get(normalized);
    if (!user || !verifyPassword(password, user.passwordHash, user.passwordSalt)) {
      const error = new Error('That username or password was not accepted.');
      error.statusCode = 401;
      throw error;
    }

    return { ok: true, username: normalized };
  }

  authenticateMobileAccount(username, password) {
    return this.login(username, password);
  }

  changePassword(username, currentPassword, nextPassword) {
    const normalized = normalizeUsername(username);
    const user = this.users.get(normalized);
    if (!user) {
      const error = new Error('Account not found.');
      error.statusCode = 404;
      throw error;
    }
    if (!verifyPassword(currentPassword, user.passwordHash, user.passwordSalt)) {
      const error = new Error('Current password was not accepted.');
      error.statusCode = 401;
      throw error;
    }
    const passwordError = validatePassword(nextPassword);
    if (passwordError) {
      const error = new Error(passwordError);
      error.statusCode = 400;
      throw error;
    }

    const { passwordHash, passwordSalt } = hashPassword(nextPassword);
    user.passwordHash = passwordHash;
    user.passwordSalt = passwordSalt;
    user.updatedAt = Date.now();
    this.users.set(normalized, user);
    this.persistUsers();
    return { ok: true, username: normalized };
  }

}

module.exports = {
  AuthService,
  normalizeUsername,
  validateUsername,
  validatePassword
};
