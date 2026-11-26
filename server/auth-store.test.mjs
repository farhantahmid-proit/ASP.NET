import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

let tempDir = '';
let authStore;

function signManualJwt(payload, secret) {
  const b64 = (obj) =>
    Buffer.from(JSON.stringify(obj))
      .toString('base64')
      .replace(/=/g, '')
      .replace(/\+/g, '-')
      .replace(/\//g, '_');
  const header = b64({ alg: 'HS256', typ: 'JWT' });
  const body = b64(payload);
  const sig = crypto
    .createHmac('sha256', secret)
    .update(`${header}.${body}`)
    .digest('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
  return `${header}.${body}.${sig}`;
}

beforeAll(async () => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fresnel-auth-test-'));
  process.env.FRESNEL_AUTH_DATA_DIR = tempDir;
  process.env.JWT_SECRET = 'vitest-isolated-jwt-secret-32-chars!';
  authStore = await import('./auth-store.js');
});

afterAll(() => {
  delete process.env.FRESNEL_AUTH_DATA_DIR;
  if (tempDir && fs.existsSync(tempDir)) {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

describe('server/auth-store', () => {
  it('registers a workspace, rejects duplicate email (409), and validates login/JWT/refresh/widget', () => {
    const reg = authStore.registerWorkspace({
      workspace: { name: 'Fresnel QA', email: 'qa@fresnel.test' },
      administrator: { name: 'QA Admin', password: 'StrongPassword123!' },
    });

    expect(reg.status).toBe(201);
    expect(reg.data.workspace.name).toBe('Fresnel QA');
    expect(reg.data.widget.public_key).toMatch(/^frsn_/);

    const dup = authStore.registerWorkspace({
      workspace: { name: 'Fresnel QA 2', email: 'QA@FRESNEL.TEST' },
      administrator: { name: 'QA Admin', password: 'StrongPassword123!' },
    });
    expect(dup.status).toBe(409);

    const badPass = authStore.loginWorkspace({
      email: 'qa@fresnel.test',
      password: 'WrongPassword123!',
    });
    expect(badPass.status).toBe(401);

    const login = authStore.loginWorkspace({
      email: 'qa@fresnel.test',
      password: 'StrongPassword123!',
    });
    expect(login.status).toBe(200);
    expect(login.data.token_type).toBe('bearer');
    expect(login.data.access_token).toBeTruthy();
    expect(login.data.refresh_token).toBeTruthy();

    const accessClaims = authStore.verifyJwt(login.data.access_token, 'access');
    expect(accessClaims).not.toBeNull();
    expect(accessClaims.workspace_id).toBe(reg.data.workspace.id);

    // Tampered token fails verification
    const tampered = `${login.data.access_token.slice(0, -4)}xxxx`;
    expect(authStore.verifyJwt(tampered, 'access')).toBeNull();

    // Refresh token cannot be used as access token
    expect(authStore.verifyJwt(login.data.refresh_token, 'access')).toBeNull();

    // Expired token fails verification
    const expiredToken = signManualJwt(
      { sub: 'usr_x', token_use: 'access', iat: 100, exp: 101 },
      process.env.JWT_SECRET,
    );
    expect(authStore.verifyJwt(expiredToken, 'access')).toBeNull();

    // Token lookup & widget lookup
    const me = authStore.getWorkspaceByAccessToken(login.data.access_token);
    expect(me?.administrator.email).toBe('qa@fresnel.test');

    const refreshed = authStore.refreshWorkspaceToken(login.data.refresh_token);
    expect(refreshed.status).toBe(200);
    expect(refreshed.data.access_token).not.toBe(login.data.access_token);

    const widgetMeta = authStore.findWidgetByPublicKey(reg.data.widget.public_key);
    expect(widgetMeta?.workspace.id).toBe(reg.data.workspace.id);
    expect(authStore.findWidgetByPublicKey('frsn_nonexistent')).toBeNull();
  });
});
