import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_DIR = process.env.FRESNEL_AUTH_DATA_DIR
  ? path.resolve(process.env.FRESNEL_AUTH_DATA_DIR)
  : path.join(__dirname, '..', '.fresnel-data');
const STORE_PATH = path.join(DATA_DIR, 'auth-store.json');

const ACCESS_TTL_SEC = 60 * 60; // 1 hour
const REFRESH_TTL_SEC = 60 * 60 * 24 * 7; // 7 days

const FALLBACK_DEV_SECRET = crypto.randomBytes(32).toString('hex');
let warnedMissingSecret = false;

function getJwtSecret() {
  const configured = process.env.JWT_SECRET?.trim();
  if (configured && configured.length >= 16) return configured;
  if (!warnedMissingSecret) {
    warnedMissingSecret = true;
    console.warn('[Fresnel Auth] JWT_SECRET not set (or <16 chars); using ephemeral per-process secret.');
  }
  return FALLBACK_DEV_SECRET;
}

function base64UrlEncode(input) {
  return Buffer.from(input)
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

function base64UrlDecode(str) {
  const normalized = str.replace(/-/g, '+').replace(/_/g, '/');
  const pad = normalized.length % 4 === 0 ? '' : '='.repeat(4 - (normalized.length % 4));
  return Buffer.from(normalized + pad, 'base64').toString('utf8');
}

function signJwt(payload, ttlSeconds) {
  const now = Math.floor(Date.now() / 1000);
  const header = base64UrlEncode(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = base64UrlEncode(
    JSON.stringify({ ...payload, iat: now, exp: now + ttlSeconds, jti: crypto.randomUUID() })
  );
  const signature = crypto
    .createHmac('sha256', getJwtSecret())
    .update(`${header}.${body}`)
    .digest('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
  return `${header}.${body}.${signature}`;
}

export function verifyJwt(token, expectedType = 'access') {
  if (typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [headerB64, payloadB64, sigB64] = parts;
  const expectedSig = crypto
    .createHmac('sha256', getJwtSecret())
    .update(`${headerB64}.${payloadB64}`)
    .digest('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');

  const sigBuf = Buffer.from(sigB64);
  const expBuf = Buffer.from(expectedSig);
  if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
    return null;
  }

  try {
    const payload = JSON.parse(base64UrlDecode(payloadB64));
    const now = Math.floor(Date.now() / 1000);
    if (typeof payload.exp !== 'number' || payload.exp <= now) return null;
    if (expectedType && payload.token_use !== expectedType) return null;
    return payload;
  } catch {
    return null;
  }
}

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${derived}`;
}

function verifyPassword(password, storedHash) {
  const [salt, keyHex] = String(storedHash || '').split(':');
  if (!salt || !keyHex) return false;
  const derived = crypto.scryptSync(password, salt, 64);
  const stored = Buffer.from(keyHex, 'hex');
  return derived.length === stored.length && crypto.timingSafeEqual(derived, stored);
}

function slugify(value) {
  const base = String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  return `${base || 'workspace'}-${crypto.randomBytes(2).toString('hex')}`;
}

function loadStore() {
  try {
    if (fs.existsSync(STORE_PATH)) {
      const parsed = JSON.parse(fs.readFileSync(STORE_PATH, 'utf8'));
      if (parsed && Array.isArray(parsed.records)) return parsed;
    }
  } catch {
    // Fall back to empty store
  }
  return { records: [] };
}

function saveStore(store) {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(STORE_PATH, JSON.stringify(store, null, 2), 'utf8');
  } catch {
    // Read-only container filesystem: remain in-memory
  }
}

const memoryStore = loadStore();

function formatPublicRecord(rec) {
  return {
    workspace: rec.workspace,
    administrator: {
      id: rec.administrator.id,
      workspace_id: rec.workspace.id,
      name: rec.administrator.name,
      email: rec.administrator.email,
      role: rec.administrator.role
    },
    widget: rec.widget
  };
}

export function registerWorkspace(input) {
  const wsName = String(input?.workspace?.name || '').trim();
  const email = String(input?.workspace?.email || '').trim().toLowerCase();
  const adminName = String(input?.administrator?.name || '').trim();
  const password = String(input?.administrator?.password || '');

  if (wsName.length < 2 || wsName.length > 120) {
    return { status: 422, detail: 'Workspace name must be between 2 and 120 characters.' };
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 320) {
    return { status: 422, detail: 'Please provide a valid work email address.' };
  }
  if (adminName.length < 2 || adminName.length > 120) {
    return { status: 422, detail: 'Administrator name must be between 2 and 120 characters.' };
  }
  if (password.length < 8 || password.length > 1024) {
    return { status: 422, detail: 'Password must be at least 8 characters long.' };
  }

  const existing = memoryStore.records.find((r) => r.administrator.email === email);
  if (existing) {
    return { status: 409, detail: 'An account with this email already exists.' };
  }

  const workspaceId = `ws_${crypto.randomUUID()}`;
  const adminId = `usr_${crypto.randomUUID()}`;
  const widgetId = `wdg_${crypto.randomUUID()}`;
  const publicKey = `frsn_${crypto.randomBytes(12).toString('hex')}`;

  const record = {
    workspace: { id: workspaceId, name: wsName, slug: slugify(wsName) },
    administrator: {
      id: adminId,
      workspace_id: workspaceId,
      name: adminName,
      email,
      role: 'admin',
      passwordHash: hashPassword(password)
    },
    widget: {
      id: widgetId,
      workspace_id: workspaceId,
      public_key: publicKey,
      name: `${wsName} Site Auditor`,
      is_default: true
    }
  };

  memoryStore.records.push(record);
  saveStore(memoryStore);
  return { status: 201, data: formatPublicRecord(record) };
}

export function loginWorkspace(input) {
  const email = String(input?.email || '').trim().toLowerCase();
  const password = String(input?.password || '');

  const record = memoryStore.records.find((r) => r.administrator.email === email);
  if (!record || !verifyPassword(password, record.administrator.passwordHash)) {
    return { status: 401, detail: 'The email or password is incorrect.' };
  }

  return { status: 200, data: issueAuthBundle(record) };
}

export function refreshWorkspaceToken(refreshToken) {
  const claims = verifyJwt(refreshToken, 'refresh');
  if (!claims) {
    return { status: 401, detail: 'Refresh token is invalid or expired.' };
  }
  const record = memoryStore.records.find((r) => r.administrator.id === claims.sub);
  if (!record) {
    return { status: 401, detail: 'Account no longer exists.' };
  }
  return { status: 200, data: issueAuthBundle(record) };
}

export function getWorkspaceByAccessToken(accessToken) {
  const claims = verifyJwt(accessToken, 'access');
  if (!claims) return null;
  const record = memoryStore.records.find((r) => r.administrator.id === claims.sub);
  return record ? formatPublicRecord(record) : null;
}

export function findWidgetByPublicKey(publicKey) {
  const key = String(publicKey || '').trim();
  const record = memoryStore.records.find((r) => r.widget.public_key === key);
  return record ? { workspace: record.workspace, widget: record.widget } : null;
}

function issueAuthBundle(record) {
  const baseClaims = {
    sub: record.administrator.id,
    workspace_id: record.workspace.id,
    role: record.administrator.role
  };
  return {
    access_token: signJwt({ ...baseClaims, token_use: 'access' }, ACCESS_TTL_SEC),
    refresh_token: signJwt({ ...baseClaims, token_use: 'refresh' }, REFRESH_TTL_SEC),
    token_type: 'bearer',
    expires_in: ACCESS_TTL_SEC,
    refresh_expires_in: REFRESH_TTL_SEC,
    ...formatPublicRecord(record)
  };
}
