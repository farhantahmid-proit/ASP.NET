# Fresnel Companion Cross-Browser Extension (`browser-ext/`, Manifest V3)

Audit any logged-in, authenticated staging, or production browser tab directly inside **Chrome, Mozilla Firefox, Microsoft Edge, Brave, Opera, Vivaldi, or Safari**, export `fresnel-audit-json/v1`, or hand off in one click to Fresnel's All-in-One Site Audit.

## Build Both Targets

```bash
npm run build:ext
```

This emits:
- `dist/browser-ext/chromium/` — Chrome, Edge, Brave, Opera, Vivaldi (`minimum_chrome_version: "109"`)
- `dist/browser-ext/firefox/` — Mozilla Firefox >= 121 (`browser_specific_settings.gecko`)

---

## Installation Instructions

### 1. Google Chrome / Brave / Opera / Vivaldi
1. Open `chrome://extensions` (or `brave://extensions`, `opera://extensions`, `vivaldi://extensions`).
2. Enable **Developer mode** (top-right).
3. Click **Load unpacked** and select `dist/browser-ext/chromium/`.

### 2. Microsoft Edge
1. Open `edge://extensions`.
2. Enable **Developer mode** (left sidebar).
3. Click **Load unpacked** and select `dist/browser-ext/chromium/`.

### 3. Mozilla Firefox (121+)
1. Open `about:debugging#/runtime/this-firefox`.
2. Click **Load Temporary Add-on…**.
3. Select `dist/browser-ext/firefox/manifest.json`.

### 4. Apple Safari (macOS Xcode Conversion)
1. Run `npm run build:ext`.
2. Convert the Chromium MV3 folder into a Safari Web Extension app target:
   ```bash
   xcrun safari-web-extension-converter dist/browser-ext/chromium/ --project-location dist/browser-ext/safari
   ```
3. Build and enable the extension in Safari Settings → Extensions.

---

## Switching Between Standalone Fresnel & KnowledgeBaseAI

Open **Connection Settings** at the bottom of the extension popup:
- **Fresnel App URL:** Defaults to `http://localhost:3000` (set to your KnowledgeBaseAI origin, e.g. `http://localhost:4179`, or production URL).
- **Route Mode:**
  - **Standalone (`/audit/live`):** Opens `<origin>/audit/live?targetUrl=<url>&source=ext`
  - **KnowledgeBaseAI (`/fresnel/audit/live`):** Opens `<origin>/fresnel/audit/live?targetUrl=<url>&source=ext`
