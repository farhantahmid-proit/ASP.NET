import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { generateSW } from 'workbox-build';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.join(__dirname, '..');
const DIST_DIR = path.join(ROOT_DIR, 'dist', 'fresnel');
const DIST_BROWSER_DIR = path.join(DIST_DIR, 'browser');
const DIST_SERVER_DIR = path.join(DIST_DIR, 'server');

function copyDirRecursive(srcDir, destDir) {
  if (!fs.existsSync(srcDir)) return;
  fs.mkdirSync(destDir, { recursive: true });
  for (const entry of fs.readdirSync(srcDir, { withFileTypes: true })) {
    const srcPath = path.join(srcDir, entry.name);
    const destPath = path.join(destDir, entry.name);
    if (entry.isDirectory()) {
      copyDirRecursive(srcPath, destPath);
    } else if (entry.isFile()) {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

async function buildWorkboxServiceWorker() {
  if (!fs.existsSync(DIST_BROWSER_DIR)) {
    return;
  }
  const { count, size, warnings } = await generateSW({
    globDirectory: DIST_BROWSER_DIR,
    globPatterns: ['**/*.{js,css,html,ico,png,svg,woff,woff2,webmanifest}'],
    globIgnores: ['sw.js', 'workbox-*.js', '**/*.map'],
    swDest: path.join(DIST_BROWSER_DIR, 'sw.js'),
    maximumFileSizeToCacheInBytes: 6 * 1024 * 1024,
    clientsClaim: true,
    skipWaiting: true,
    cleanupOutdatedCaches: true,
    sourcemap: false,
    navigateFallback: '/index.html',
    navigateFallbackDenylist: [/^\/api\//],
    runtimeCaching: [
      {
        urlPattern: ({ url }) => url.pathname.startsWith('/offline-audits/'),
        handler: 'CacheFirst',
        options: {
          cacheName: 'fresnel-saved-audits-offline-v1',
          expiration: {
            maxEntries: 120,
            maxAgeSeconds: 60 * 60 * 24 * 90
          },
          cacheableResponse: {
            statuses: [0, 200]
          }
        }
      },
      {
        urlPattern: ({ url, request }) =>
          request.method === 'GET' && url.pathname.startsWith('/api/audit/'),
        handler: 'NetworkFirst',
        options: {
          cacheName: 'fresnel-audit-reports-api-v1',
          networkTimeoutSeconds: 4,
          expiration: {
            maxEntries: 60,
            maxAgeSeconds: 60 * 60 * 24 * 30
          },
          cacheableResponse: {
            statuses: [0, 200]
          }
        }
      },
      {
        urlPattern: /^https:\/\/fonts\.googleapis\.com\/.*/i,
        handler: 'CacheFirst',
        options: {
          cacheName: 'google-fonts-cache',
          expiration: {
            maxEntries: 10,
            maxAgeSeconds: 60 * 60 * 24 * 365
          },
          cacheableResponse: {
            statuses: [0, 200]
          }
        }
      },
      {
        urlPattern: /^https:\/\/fonts\.gstatic\.com\/.*/i,
        handler: 'CacheFirst',
        options: {
          cacheName: 'gstatic-fonts-cache',
          expiration: {
            maxEntries: 10,
            maxAgeSeconds: 60 * 60 * 24 * 365
          },
          cacheableResponse: {
            statuses: [0, 200]
          }
        }
      }
    ]
  });

  if (warnings.length > 0) {
    console.warn('[Workbox] Build warnings:', warnings.join('\n'));
  }
  console.log(
    `[Workbox] Generated sw.js precaching ${count} assets (${Math.round(size / 1024)} KB) for offline Saved Audits support.`
  );
}

async function buildApp() {
  const angularJsonPath = path.join(ROOT_DIR, 'angular.json');
  const angularConfig = JSON.parse(fs.readFileSync(angularJsonPath, 'utf-8'));

  // Temporarily omit outputMode during ng build so @angular-devkit/build-angular:application
  // builds dist/fresnel/browser without requiring @angular/ssr, then restore outputMode: "server"
  // in finally so AI Studio's archive handler packages the full-stack server bundle (app.tar.gz).
  const cliConfig = structuredClone(angularConfig);
  if (cliConfig?.projects?.fresnel?.architect?.build?.options) {
    delete cliConfig.projects.fresnel.architect.build.options.outputMode;
  }

  fs.writeFileSync(angularJsonPath, JSON.stringify(cliConfig, null, 2) + '\n', 'utf-8');

  let buildStatus = 0;
  try {
    const ngBin = path.join(ROOT_DIR, 'node_modules', '.bin', 'ng');
    const res = spawnSync(ngBin, ['build'], {
      cwd: ROOT_DIR,
      stdio: 'inherit'
    });
    buildStatus = res.status ?? 1;
  } finally {
    if (angularConfig?.projects?.fresnel?.architect?.build?.options) {
      angularConfig.projects.fresnel.architect.build.options.outputMode = 'server';
    }
    fs.writeFileSync(angularJsonPath, JSON.stringify(angularConfig, null, 2) + '\n', 'utf-8');
  }

  if (buildStatus !== 0) {
    process.exit(buildStatus);
  }

  // Generate Workbox offline service worker into dist/fresnel/browser/sw.js
  await buildWorkboxServiceWorker();

  // Persist phantom-gdemo-1 non-secret runtime configuration into server/runtime-env.json.
  // Secrets (GEMINI_API_KEY) are never written to disk; the server reads them from process.env only.
  const runtimeEnvPayload = {
    GCP_PROJECT: 'phantom-gdemo-1',
    GCP_PROJECT_NUMBER: '20833501260',
    GCP_LOCATION: 'global',
    FRESNEL_GCP_PROJECT: 'phantom-gdemo-1',
    MANAGED_AGENT: 'antigravity-preview-09-2026',
    MODEL: 'gemini-4-argon',
    FALLBACK_MODEL: 'gemini-3.8-flash'
  };
  fs.writeFileSync(
    path.join(ROOT_DIR, 'server', 'runtime-env.json'),
    JSON.stringify(runtimeEnvPayload, null, 2) + '\n',
    'utf-8'
  );

  // Copy backend server/, agent/, public/, server.ts, and metadata.json into dist/fresnel/
  fs.mkdirSync(DIST_SERVER_DIR, { recursive: true });
  copyDirRecursive(path.join(ROOT_DIR, 'server'), DIST_SERVER_DIR);
  copyDirRecursive(path.join(ROOT_DIR, 'agent'), path.join(DIST_DIR, 'agent'));
  copyDirRecursive(path.join(ROOT_DIR, 'public'), path.join(DIST_DIR, 'public'));

  for (const rootFile of ['server.ts', 'metadata.json', '.env.example']) {
    const srcFile = path.join(ROOT_DIR, rootFile);
    if (fs.existsSync(srcFile)) {
      fs.copyFileSync(srcFile, path.join(DIST_DIR, rootFile));
    }
  }

  // Create dist/fresnel/server/server.mjs entrypoint expected by AI Studio full-stack Angular deployment
  const serverMjsContent = `import { startFresnelServer, resolvePortAndHost } from './index.js';

const { port, host } = resolvePortAndHost();
startFresnelServer(port, host);
`;
  fs.writeFileSync(path.join(DIST_SERVER_DIR, 'server.mjs'), serverMjsContent, 'utf-8');
}

buildApp().catch((err) => {
  console.error('[Build] Failed:', err);
  process.exit(1);
});
