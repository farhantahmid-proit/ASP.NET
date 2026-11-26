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
    } else if (entry.isFile() && !/\.(test|spec)\.[^.]+$/i.test(entry.name)) {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

function runVite(args) {
  const viteEntry = path.join(ROOT_DIR, 'node_modules', 'vite', 'bin', 'vite.js');
  const res = fs.existsSync(viteEntry)
    ? spawnSync(process.execPath, [viteEntry, ...args], { cwd: ROOT_DIR, stdio: 'inherit' })
    : spawnSync(
        path.join(ROOT_DIR, 'node_modules', '.bin', process.platform === 'win32' ? 'vite.cmd' : 'vite'),
        args,
        { cwd: ROOT_DIR, stdio: 'inherit', shell: process.platform === 'win32' }
      );
  if ((res.status ?? 1) !== 0) {
    process.exit(res.status ?? 1);
  }
}

async function buildWorkboxServiceWorker() {
  if (!fs.existsSync(DIST_BROWSER_DIR)) return;
  const { count, size, warnings } = await generateSW({
    globDirectory: DIST_BROWSER_DIR,
    globPatterns: ['**/*.{js,css,html,ico,png,svg,woff,woff2,webmanifest}'],
    globIgnores: ['sw.js', 'workbox-*.js', 'widget.js', '**/*.map'],
    swDest: path.join(DIST_BROWSER_DIR, 'sw.js'),
    maximumFileSizeToCacheInBytes: 6 * 1024 * 1024,
    clientsClaim: true,
    skipWaiting: true,
    cleanupOutdatedCaches: true,
    sourcemap: false,
    navigateFallback: '/index.html',
    navigateFallbackDenylist: [/^\/api\//, /^\/widget\.js$/],
    runtimeCaching: [
      {
        urlPattern: ({ url, request }) =>
          request.method === 'GET' && url.pathname.startsWith('/api/audit/'),
        handler: 'NetworkFirst',
        options: {
          cacheName: 'fresnel-audit-reports-api-v1',
          networkTimeoutSeconds: 4,
          expiration: { maxEntries: 60, maxAgeSeconds: 60 * 60 * 24 * 30 },
          cacheableResponse: { statuses: [0, 200] }
        }
      },
      {
        urlPattern: /^https:\/\/fonts\.(?:googleapis|gstatic)\.com\/.*/i,
        handler: 'CacheFirst',
        options: {
          cacheName: 'google-fonts-cache',
          expiration: { maxEntries: 20, maxAgeSeconds: 60 * 60 * 24 * 365 },
          cacheableResponse: { statuses: [0, 200] }
        }
      }
    ]
  });

  if (warnings.length > 0) {
    console.warn('[Workbox] Build warnings:', warnings.join('\n'));
  }
  console.log(`[Workbox] Generated sw.js precaching ${count} assets (${Math.round(size / 1024)} KB).`);
}

async function buildApp() {
  // 1. Build React + TanStack Router SPA -> dist/fresnel/browser/
  runVite(['build']);

  // 2. Build zero-dependency embeddable widget -> dist/fresnel/browser/widget.js
  runVite(['build', '--config', 'vite.embed.config.ts']);

  // 3. Generate offline Service Worker
  await buildWorkboxServiceWorker();

  // 4. Copy backend server/, agent/, public/, and root runtime files into dist/fresnel/
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
