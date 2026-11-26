#!/usr/bin/env node
/**
 * Cross-browser Manifest V3 build script for `browser-ext/`.
 * Emits ready-to-load packages into:
 *   - dist/browser-ext/chromium/ (Chrome, Edge, Brave, Opera, Vivaldi)
 *   - dist/browser-ext/firefox/  (Mozilla Firefox >= 121)
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');

const srcDir = path.join(__dirname, 'src');
const manifestsDir = path.join(__dirname, 'manifests');
const publicDir = path.join(repoRoot, 'public');
const outBaseDir = path.join(repoRoot, 'dist', 'browser-ext');

function isPlainObject(val) {
  return Boolean(val) && typeof val === 'object' && !Array.isArray(val);
}

function deepMerge(base, override) {
  const out = { ...base };
  for (const [key, val] of Object.entries(override)) {
    if (isPlainObject(val) && isPlainObject(out[key])) {
      out[key] = deepMerge(out[key], val);
    } else {
      out[key] = val;
    }
  }
  return out;
}

function copyDirRecursive(from, to) {
  fs.mkdirSync(to, { recursive: true });
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    const srcPath = path.join(from, entry.name);
    const dstPath = path.join(to, entry.name);
    if (entry.isDirectory()) {
      copyDirRecursive(srcPath, dstPath);
    } else {
      fs.copyFileSync(srcPath, dstPath);
    }
  }
}

export function buildAllExtensionTargets() {
  const baseManifest = JSON.parse(
    fs.readFileSync(path.join(manifestsDir, 'base.manifest.json'), 'utf8'),
  );

  const targets = [
    { name: 'chromium', overrideFile: 'chromium.override.json' },
    { name: 'firefox', overrideFile: 'firefox.override.json' },
  ];

  const builtTargets = [];

  for (const target of targets) {
    const targetOutDir = path.join(outBaseDir, target.name);
    fs.rmSync(targetOutDir, { recursive: true, force: true });
    copyDirRecursive(srcDir, targetOutDir);

    const iconsDir = path.join(targetOutDir, 'icons');
    fs.mkdirSync(iconsDir, { recursive: true });
    for (const iconName of ['pwa-192x192.png', 'pwa-512x512.png']) {
      const iconSrc = path.join(publicDir, iconName);
      if (!fs.existsSync(iconSrc)) {
        throw new Error(`Missing extension icon asset: ${iconSrc}`);
      }
      fs.copyFileSync(iconSrc, path.join(iconsDir, iconName));
    }

    const overrideManifest = JSON.parse(
      fs.readFileSync(path.join(manifestsDir, target.overrideFile), 'utf8'),
    );
    const mergedManifest = deepMerge(baseManifest, overrideManifest);
    fs.writeFileSync(
      path.join(targetOutDir, 'manifest.json'),
      JSON.stringify(mergedManifest, null, 2) + '\n',
      'utf8',
    );

    // Assert every referenced asset exists on disk
    const requiredFiles = [
      mergedManifest.action?.default_popup,
      mergedManifest.action?.default_icon?.['192'],
      mergedManifest.icons?.['192'],
      mergedManifest.icons?.['512'],
      'popup.css',
      'popup.js',
      'webext-api.js',
      'tab-audit-core.js',
    ].filter(Boolean);

    for (const relPath of requiredFiles) {
      const absPath = path.join(targetOutDir, relPath);
      if (!fs.existsSync(absPath)) {
        throw new Error(`[build:ext:${target.name}] Missing referenced file: ${absPath}`);
      }
    }

    builtTargets.push({ name: target.name, outDir: targetOutDir, manifest: mergedManifest });
  }

  return builtTargets;
}

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  const results = buildAllExtensionTargets();
  for (const r of results) {
    console.log(`[build:ext] Built ${r.name} MV3 -> ${path.relative(repoRoot, r.outDir)}`);
  }
}
