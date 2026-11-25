# Fresnel Companion Chrome Extension (Manifest V3)

Audit any logged-in, authenticated staging, or production browser tab directly inside Chrome and export a `fresnel-audit-json/v1` report straight into Fresnel's **Saved Audits** importer.

## Installation (Load Unpacked)

1. Open `chrome://extensions` in Google Chrome or Chromium.
2. Enable **Developer mode** in the top-right corner.
3. Click **Load unpacked** and select this `/chrome-extension` folder.
4. Navigate to any logged-in page you want to audit, click the **Fresnel Live Tab Auditor** extension icon, and click **Run Live Tab Audit**.
5. Click **Download Fresnel Audit JSON** (or **Copy Fresnel JSON**) and drop it into Fresnel's **Import File** or **Live Audit Suite -> Companion Extension** importer.
