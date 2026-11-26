/**
 * Cross-browser WebExtension MV3 API shim.
 * Normalizes Firefox (`browser.*` Promise API) and Chromium (`chrome.*` Promise/callback API)
 * without external dependencies.
 */

/**
 * Detect the active extension runtime family.
 * @param {Record<string, any>} [env]
 * @returns {'firefox' | 'chromium' | 'unknown'}
 */
export function detectBrowserFamily(env = globalThis) {
  if (env?.browser?.runtime?.getBrowserInfo || (env?.browser?.scripting && env?.browser?.tabs && !env?.chrome?.runtime?.id)) {
    return 'firefox';
  }
  if (typeof navigator !== 'undefined' && /Firefox\//i.test(navigator.userAgent || '')) {
    return 'firefox';
  }
  if (env?.chrome?.tabs || env?.chrome?.scripting || env?.browser?.tabs) {
    return 'chromium';
  }
  return 'unknown';
}

/**
 * Return the unified WebExtension API object (`browser` preferred over `chrome`).
 * @param {Record<string, any>} [env]
 */
export function getExtensionApi(env = globalThis) {
  return env?.browser ?? env?.chrome ?? null;
}

/**
 * Invoke a WebExtension method that may return a Promise or accept a trailing callback.
 * @template T
 * @param {(cb?: (res: T) => void) => Promise<T> | void} invoker
 * @param {Record<string, any>} [api]
 * @returns {Promise<T>}
 */
function callWebExt(invoker, api) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (err, val) => {
      if (settled) return;
      settled = true;
      if (err) reject(err);
      else resolve(val);
    };

    try {
      const maybePromise = invoker((res) => {
        const lastErr = api?.runtime?.lastError;
        if (lastErr) {
          finish(new Error(lastErr.message || String(lastErr)));
        } else {
          finish(null, res);
        }
      });

      if (maybePromise && typeof maybePromise.then === 'function') {
        maybePromise.then(
          (val) => finish(null, val),
          (err) => finish(err instanceof Error ? err : new Error(String(err))),
        );
      }
    } catch (err) {
      finish(err instanceof Error ? err : new Error(String(err)));
    }
  });
}

/**
 * Query the currently active tab in the focused window.
 * @param {Record<string, any>} [api]
 */
export async function queryActiveTab(api = getExtensionApi()) {
  if (!api?.tabs?.query) {
    throw new Error('Extension tabs.query API is unavailable.');
  }
  const tabs = await callWebExt(
    (cb) => api.tabs.query({ active: true, currentWindow: true }, cb),
    api,
  );
  return Array.isArray(tabs) ? tabs[0] ?? null : null;
}

/**
 * Execute a self-contained function inside the target tab's DOM context.
 * @param {number} tabId
 * @param {Function} func
 * @param {Record<string, any>} [api]
 */
export async function executeTabScript(tabId, func, api = getExtensionApi()) {
  if (!api?.scripting?.executeScript) {
    throw new Error('Extension scripting.executeScript API is unavailable.');
  }
  const results = await callWebExt(
    (cb) => api.scripting.executeScript({ target: { tabId }, func }, cb),
    api,
  );
  return Array.isArray(results) && results[0] ? results[0].result ?? null : null;
}

/**
 * Open a URL in a new browser tab.
 * @param {string} url
 * @param {Record<string, any>} [api]
 */
export async function openExtensionTab(url, api = getExtensionApi()) {
  if (!api?.tabs?.create) {
    throw new Error('Extension tabs.create API is unavailable.');
  }
  return callWebExt((cb) => api.tabs.create({ url }, cb), api);
}

const SETTINGS_STORAGE_KEY = 'fresnel.ext.settings.v2';

/**
 * Load extension connection settings from `storage.local` (or `localStorage` fallback).
 * @template T
 * @param {T} defaults
 * @param {Record<string, any>} [api]
 * @returns {Promise<T>}
 */
export async function loadSettings(defaults, api = getExtensionApi()) {
  try {
    if (api?.storage?.local?.get) {
      const stored = await callWebExt(
        (cb) => api.storage.local.get(SETTINGS_STORAGE_KEY, cb),
        api,
      );
      const val = stored?.[SETTINGS_STORAGE_KEY];
      if (val && typeof val === 'object') {
        return { ...defaults, ...val };
      }
    } else if (typeof globalThis.localStorage !== 'undefined') {
      const raw = globalThis.localStorage.getItem(SETTINGS_STORAGE_KEY);
      if (raw) {
        return { ...defaults, ...JSON.parse(raw) };
      }
    }
  } catch {
    // Fall back to defaults cleanly
  }
  return { ...defaults };
}

/**
 * Persist partial extension connection settings to `storage.local` (or `localStorage` fallback).
 * @template T
 * @param {Partial<T>} partial
 * @param {Record<string, any>} [api]
 * @returns {Promise<void>}
 */
export async function saveSettings(partial, api = getExtensionApi()) {
  const current = await loadSettings({}, api);
  const next = { ...current, ...partial };
  try {
    if (api?.storage?.local?.set) {
      await callWebExt(
        (cb) => api.storage.local.set({ [SETTINGS_STORAGE_KEY]: next }, cb),
        api,
      );
    } else if (typeof globalThis.localStorage !== 'undefined') {
      globalThis.localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(next));
    }
  } catch {
    // Ignore storage quota errors in constrained environments
  }
}
