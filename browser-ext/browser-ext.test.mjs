import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseLocalAuditFile } from '../src/lib/services/local-audit-storage';
import {
  detectBrowserFamily,
  executeTabScript,
  getExtensionApi,
  loadSettings,
  openExtensionTab,
  queryActiveTab,
  saveSettings,
} from './src/webext-api.js';
import { buildFresnelDeepLink, buildFresnelJsonPayload } from './src/tab-audit-core.js';
import { buildAllExtensionTargets } from './build-ext.mjs';

describe('browser-ext/ cross-browser webext-api shim', () => {
  it('detects Firefox vs Chromium runtimes and normalizes Promise + callback APIs', async () => {
    const firefoxEnv = {
      browser: {
        runtime: { getBrowserInfo: async () => ({ name: 'Firefox' }) },
        tabs: {
          query: async () => [{ id: 11, url: 'https://example.org/' }],
          create: async ({ url }) => ({ id: 12, url }),
        },
        scripting: {
          executeScript: async () => [{ result: { ok: true, engine: 'gecko' } }],
        },
        storage: {
          local: {
            _store: {},
            async get(key) {
              return { [key]: this._store[key] };
            },
            async set(obj) {
              Object.assign(this._store, obj);
            },
          },
        },
      },
    };

    expect(detectBrowserFamily(firefoxEnv)).toBe('firefox');
    const ffApi = getExtensionApi(firefoxEnv);
    expect((await queryActiveTab(ffApi))?.id).toBe(11);
    expect(await executeTabScript(11, () => {}, ffApi)).toEqual({ ok: true, engine: 'gecko' });
    expect((await openExtensionTab('https://example.org/audit/live', ffApi)).id).toBe(12);
    await saveSettings({ routeMode: 'knowledgebase' }, ffApi);
    expect(await loadSettings({ appOrigin: 'http://localhost:3000', routeMode: 'standalone' }, ffApi)).toEqual({
      appOrigin: 'http://localhost:3000',
      routeMode: 'knowledgebase',
    });

    const chromeEnv = {
      chrome: {
        runtime: { id: 'ext-id-123', lastError: null },
        tabs: {
          query: (_q, cb) => cb([{ id: 21, url: 'https://example.com/' }]),
          create: ({ url }, cb) => cb({ id: 22, url }),
        },
        scripting: {
          executeScript: (_opts, cb) => cb([{ result: { ok: true, engine: 'blink' } }]),
        },
      },
    };

    expect(detectBrowserFamily(chromeEnv)).toBe('chromium');
    const crApi = getExtensionApi(chromeEnv);
    expect((await queryActiveTab(crApi))?.id).toBe(21);
    expect(await executeTabScript(21, () => {}, crApi)).toEqual({ ok: true, engine: 'blink' });
    expect((await openExtensionTab('https://example.com/audit/live', crApi)).id).toBe(22);
  });
});

describe('browser-ext/ tab-audit-core payload & deep-link builder', () => {
  it('emits fresnel-audit-json/v1 payload that parses cleanly through parseLocalAuditFile', () => {
    const payload = buildFresnelJsonPayload(
      {
        pageUrl: 'https://example.com/app',
        hostname: 'example.com',
        pathname: '/app',
        title: 'Example App',
        ttfbMs: 42,
        fcpMs: 310,
        techHints: ['React', 'Next.js'],
        scores: {
          performance: 88,
          accessibility: 86,
          bestPractices: 90,
          seo: 84,
          security: 84,
        },
        findings: [
          {
            category: 'accessibility',
            ruleId: 'image-alt',
            title: 'Add alt text to 1 image(s) missing alt attributes',
            summary: 'Found 1 <img> element without alt.',
            files: ['tab/app'],
          },
        ],
      },
      { browserFamily: 'firefox' },
    );

    const parsed = parseLocalAuditFile('browser-ext-live-tab.json', JSON.stringify(payload));
    expect(parsed.repoFullName).toBe('browser-ext/example.com');
    expect(parsed.branch).toBe('browser-ext-firefox');
    expect(parsed.storageSource).toBe('imported');
    expect(parsed.totalCommitsCount).toBe(1);
    expect(parsed.performanceBefore).toBe(88);
  });

  it('builds standalone and KnowledgeBaseAI deep links and rejects unsafe protocols', () => {
    expect(
      buildFresnelDeepLink({
        appOrigin: 'http://localhost:3000',
        routeMode: 'standalone',
        targetUrl: 'https://example.com/pricing?plan=pro',
      }),
    ).toBe(
      'http://localhost:3000/audit/live?targetUrl=https%3A%2F%2Fexample.com%2Fpricing%3Fplan%3Dpro&source=ext',
    );

    expect(
      buildFresnelDeepLink({
        appOrigin: 'https://kb.example.com/',
        routeMode: 'knowledgebase',
        targetUrl: 'https://example.com/',
      }),
    ).toBe(
      'https://kb.example.com/fresnel/audit/live?targetUrl=https%3A%2F%2Fexample.com%2F&source=ext',
    );

    for (const unsafeUrl of [
      'chrome://extensions',
      'about:blank',
      'javascript:alert(1)',
      'file:///etc/passwd',
    ]) {
      expect(() =>
        buildFresnelDeepLink({
          appOrigin: 'http://localhost:3000',
          routeMode: 'standalone',
          targetUrl: unsafeUrl,
        }),
      ).toThrow();
    }
  });
});

describe('browser-ext/ multi-target MV3 build output', () => {
  it('builds valid Chromium and Firefox MV3 packages with all referenced assets present', () => {
    const results = buildAllExtensionTargets();
    expect(results.map((r) => r.name)).toEqual(['chromium', 'firefox']);

    const chromiumDir = path.resolve(__dirname, '../dist/browser-ext/chromium');
    const firefoxDir = path.resolve(__dirname, '../dist/browser-ext/firefox');

    const chromiumManifest = JSON.parse(
      fs.readFileSync(path.join(chromiumDir, 'manifest.json'), 'utf8'),
    );
    expect(chromiumManifest.manifest_version).toBe(3);
    expect(chromiumManifest.minimum_chrome_version).toBe('109');
    expect(fs.existsSync(path.join(chromiumDir, chromiumManifest.action.default_popup))).toBe(true);
    expect(fs.existsSync(path.join(chromiumDir, chromiumManifest.icons['192']))).toBe(true);
    expect(fs.existsSync(path.join(chromiumDir, chromiumManifest.icons['512']))).toBe(true);

    const firefoxManifest = JSON.parse(
      fs.readFileSync(path.join(firefoxDir, 'manifest.json'), 'utf8'),
    );
    expect(firefoxManifest.manifest_version).toBe(3);
    expect(firefoxManifest.browser_specific_settings?.gecko?.id).toBe('fresnel-auditor@oits.dev');
    expect(firefoxManifest.browser_specific_settings?.gecko?.strict_min_version).toBe('121.0');
    expect(fs.existsSync(path.join(firefoxDir, firefoxManifest.action.default_popup))).toBe(true);
    expect(fs.existsSync(path.join(firefoxDir, firefoxManifest.icons['192']))).toBe(true);
    expect(fs.existsSync(path.join(firefoxDir, firefoxManifest.icons['512']))).toBe(true);
  });
});
