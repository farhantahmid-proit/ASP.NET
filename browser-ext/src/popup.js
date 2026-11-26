/**
 * Fresnel Companion Cross-Browser Extension — Popup Controller (Manifest V3)
 * Works across Chrome, Firefox, Edge, Brave, Opera, and Vivaldi via webext-api.js.
 */

import {
  detectBrowserFamily,
  executeTabScript,
  loadSettings,
  openExtensionTab,
  queryActiveTab,
  saveSettings,
} from './webext-api.js';
import {
  buildFresnelDeepLink,
  buildFresnelJsonPayload,
  inspectActiveTabDom,
} from './tab-audit-core.js';

const DEFAULT_SETTINGS = {
  appOrigin: 'http://localhost:3000',
  routeMode: 'standalone',
};

let latestFresnelPayload = null;
let currentBrowserFamily = detectBrowserFamily();

const runBtn = document.getElementById('run-audit-btn');
const deepBtn = document.getElementById('deep-audit-btn');
const exportBtn = document.getElementById('export-json-btn');
const copyBtn = document.getElementById('copy-json-btn');
const statusBox = document.getElementById('status-box');
const techRow = document.getElementById('tech-row');
const scoresGrid = document.getElementById('scores-grid');
const findingsList = document.getElementById('findings-list');
const runtimeBadge = document.getElementById('runtime-badge');
const appOriginInput = document.getElementById('app-origin-input');
const routeModeInputs = Array.from(document.querySelectorAll('input[name="route-mode"]'));

function setStatus(text) {
  if (statusBox) statusBox.textContent = text;
}

function getCurrentSettings() {
  const checkedMode = routeModeInputs.find((input) => input.checked)?.value;
  return {
    appOrigin: (appOriginInput?.value || DEFAULT_SETTINGS.appOrigin).trim(),
    routeMode: checkedMode === 'knowledgebase' ? 'knowledgebase' : 'standalone',
  };
}

function renderResults(scan) {
  if (techRow) {
    techRow.replaceChildren();
    const hints = Array.isArray(scan.techHints) ? scan.techHints : [];
    techRow.hidden = hints.length === 0;
    for (const tech of hints) {
      const pill = document.createElement('span');
      pill.className = 'tech-pill';
      pill.textContent = tech;
      techRow.appendChild(pill);
    }
  }

  if (scoresGrid) {
    scoresGrid.replaceChildren();
    scoresGrid.hidden = false;
    const entries = [
      ['Perf', scan.scores.performance],
      ['A11y', scan.scores.accessibility],
      ['SEO', scan.scores.seo],
      ['Sec', scan.scores.security],
    ];
    for (const [label, val] of entries) {
      const box = document.createElement('div');
      box.className = 'score-box';
      const lbl = document.createElement('span');
      lbl.className = 'score-label';
      lbl.textContent = label;
      const num = document.createElement('span');
      num.className = 'score-val';
      num.textContent = String(val);
      box.appendChild(lbl);
      box.appendChild(num);
      scoresGrid.appendChild(box);
    }
  }

  if (findingsList) {
    findingsList.replaceChildren();
    findingsList.hidden = false;
    if (scan.findings.length === 0) {
      const li = document.createElement('li');
      li.className = 'finding-item';
      li.textContent = 'Zero critical issues detected on this tab.';
      findingsList.appendChild(li);
    } else {
      for (const f of scan.findings) {
        const li = document.createElement('li');
        li.className = 'finding-item';
        const cat = document.createElement('span');
        cat.className = 'finding-cat';
        cat.textContent = f.category;
        const txt = document.createElement('span');
        txt.textContent = f.title;
        li.appendChild(cat);
        li.appendChild(txt);
        findingsList.appendChild(li);
      }
    }
  }
}

async function initPopup() {
  if (runtimeBadge) {
    runtimeBadge.textContent =
      currentBrowserFamily === 'firefox'
        ? 'Firefox MV3'
        : currentBrowserFamily === 'chromium'
          ? 'Chromium MV3'
          : 'MV3';
  }

  const settings = await loadSettings(DEFAULT_SETTINGS);
  if (appOriginInput) appOriginInput.value = settings.appOrigin;
  for (const input of routeModeInputs) {
    input.checked = input.value === settings.routeMode;
  }
}

appOriginInput?.addEventListener('change', () => {
  void saveSettings(getCurrentSettings());
});

for (const input of routeModeInputs) {
  input.addEventListener('change', () => {
    void saveSettings(getCurrentSettings());
  });
}

runBtn?.addEventListener('click', async () => {
  setStatus('Scanning active tab...');
  runBtn.disabled = true;
  try {
    const tab = await queryActiveTab();
    if (!tab?.id || !tab.url || !/^https?:\/\//i.test(tab.url)) {
      setStatus('Open a standard http:// or https:// webpage to audit.');
      return;
    }

    const result = await executeTabScript(tab.id, inspectActiveTabDom);
    if (!result) {
      setStatus('Unable to read DOM from this tab.');
      return;
    }

    latestFresnelPayload = buildFresnelJsonPayload(result, {
      browserFamily: currentBrowserFamily === 'unknown' ? 'chromium' : currentBrowserFamily,
    });
    renderResults(result);
    if (exportBtn) exportBtn.disabled = false;
    if (copyBtn) copyBtn.disabled = false;
    setStatus(`Audited ${result.hostname}: ${result.findings.length} finding(s) ready for Fresnel.`);
  } catch (err) {
    setStatus(err instanceof Error ? err.message : 'Failed to inspect active tab.');
  } finally {
    runBtn.disabled = false;
  }
});

deepBtn?.addEventListener('click', async () => {
  try {
    const settings = getCurrentSettings();
    await saveSettings(settings);
    const tab = await queryActiveTab();
    const targetUrl = tab?.url || '';
    const deepUrl = buildFresnelDeepLink({
      appOrigin: settings.appOrigin,
      routeMode: settings.routeMode,
      targetUrl,
    });
    await openExtensionTab(deepUrl);
    setStatus('Opened deep site audit in Fresnel.');
  } catch (err) {
    setStatus(err instanceof Error ? err.message : 'Unable to open Fresnel deep audit.');
  }
});

exportBtn?.addEventListener('click', () => {
  if (!latestFresnelPayload) return;
  const host = latestFresnelPayload.record.repoFullName.replace(/[^a-zA-Z0-9._-]+/g, '-');
  const blob = new Blob([JSON.stringify(latestFresnelPayload, null, 2)], {
    type: 'application/json;charset=utf-8',
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `fresnel-${host}.json`;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, 150);
  setStatus('Exported Fresnel JSON. Import it in Fresnel via "Import File" or "Saved Audits".');
});

copyBtn?.addEventListener('click', async () => {
  if (!latestFresnelPayload) return;
  try {
    await navigator.clipboard.writeText(JSON.stringify(latestFresnelPayload, null, 2));
    setStatus('Copied Fresnel JSON to clipboard.');
  } catch {
    setStatus('Clipboard permission denied — use Download JSON instead.');
  }
});

void initPopup();
