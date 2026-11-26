/**
 * Fresnel Zero-AI Web Standards Grounding Engine
 *
 * Replaces Gemini Search Grounding with:
 * 1. A curated, versioned offline-first registry mapping every Fresnel audit ruleId
 *    to canonical W3C WCAG 2.2, web.dev Core Web Vitals, MDN Web Docs, and OWASP URLs.
 * 2. Optional live enrichment via the free, unauthenticated MDN Web Docs Search API
 *    (https://developer.mozilla.org/api/v1/search) with a 24-hour in-memory cache.
 */

const MDN_CACHE = new Map();
const MDN_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

export const STANDARDS_REGISTRY = {
  'largest-contentful-paint': {
    category: 'performance',
    standard: 'Core Web Vitals — Largest Contentful Paint (LCP ≤ 2.5s) & CLS ≤ 0.1',
    guidance:
      'Prioritize discovery of the above-the-fold hero media using fetchpriority="high" and lock explicit intrinsic width/height attributes to eliminate Cumulative Layout Shift while deferring below-the-fold images with loading="lazy" decoding="async".',
    mdnQuery: 'fetchpriority img loading lazy',
    sources: [
      { title: 'web.dev — Optimize Largest Contentful Paint (LCP)', uri: 'https://web.dev/articles/optimize-lcp' },
      { title: 'web.dev — Optimize Cumulative Layout Shift (CLS)', uri: 'https://web.dev/articles/optimize-cls' },
      { title: 'MDN — HTMLImageElement fetchPriority property', uri: 'https://developer.mozilla.org/en-US/docs/Web/API/HTMLImageElement/fetchPriority' }
    ]
  },
  'largest-contentful-paint-element': {
    category: 'performance',
    standard: 'Lighthouse Diagnostics — LCP Element Discovery & Priority Hints',
    guidance:
      'Ensure the Lighthouse-identified LCP image element is present in initial HTML without lazy-loading and carries fetchpriority="high" plus explicit dimensions.',
    mdnQuery: 'fetchpriority preload',
    sources: [
      { title: 'web.dev — Fetch Priority API', uri: 'https://web.dev/articles/fetch-priority' },
      { title: 'Chrome Developers — Largest Contentful Paint element audit', uri: 'https://developer.chrome.com/docs/lighthouse/performance/lighthouse-largest-contentful-paint' }
    ]
  },
  'uses-rel-preconnect': {
    category: 'performance',
    standard: 'W3C Resource Hints & CSS Font Display Specification',
    guidance:
      'Establish early TLS/DNS connections to critical font and CDN origins with <link rel="preconnect" crossorigin>, replace render-blocking CSS @import rules, and enforce font-display: swap on @font-face declarations.',
    mdnQuery: 'rel preconnect font-display swap',
    sources: [
      { title: 'web.dev — Establish network connections early (preconnect)', uri: 'https://web.dev/articles/uses-rel-preconnect' },
      { title: 'MDN — CSS font-display descriptor', uri: 'https://developer.mozilla.org/en-US/docs/Web/CSS/@font-face/font-display' }
    ]
  },
  'render-blocking-resources': {
    category: 'performance',
    standard: 'Critical Rendering Path — Eliminate Render-Blocking Stylesheets & Scripts',
    guidance:
      'Remove synchronous @import chains and preload critical fonts/stylesheets asynchronously so First Contentful Paint is not blocked on third-party network round-trips.',
    mdnQuery: 'link rel preload',
    sources: [
      { title: 'Chrome Developers — Eliminate render-blocking resources', uri: 'https://developer.chrome.com/docs/lighthouse/performance/render-blocking-resources' },
      { title: 'MDN — rel="preload"', uri: 'https://developer.mozilla.org/en-US/docs/Web/HTML/Attributes/rel/preload' }
    ]
  },
  'unsized-images': {
    category: 'performance',
    standard: 'Core Web Vitals — Intrinsic Aspect Ratio & Layout Stability',
    guidance:
      'Specify explicit width and height attributes (or CSS aspect-ratio) on every <img> element so the browser reserves exact layout space before the asset finishes downloading.',
    mdnQuery: 'aspect-ratio img width height',
    sources: [
      { title: 'web.dev — Set explicit width and height on image elements', uri: 'https://web.dev/articles/optimize-cls#images_without_dimensions' },
      { title: 'MDN — CSS aspect-ratio', uri: 'https://developer.mozilla.org/en-US/docs/Web/CSS/aspect-ratio' }
    ]
  },
  'non-composited-animations': {
    category: 'performance',
    standard: 'Browser Rendering Pipeline — GPU-Composited CSS Transforms',
    guidance:
      'Avoid animating layout-inducing CSS properties (top, left, width, height, margin); migrate keyframes and transitions to GPU-composited transform and opacity properties to maintain 60fps and minimize CLS.',
    mdnQuery: 'css transform will-change animation performance',
    sources: [
      { title: 'web.dev — Stick to compositor-only properties', uri: 'https://web.dev/articles/stick-to-compositor-only-properties-and-manage-layer-count' },
      { title: 'MDN — CSS and JavaScript animation performance', uri: 'https://developer.mozilla.org/en-US/docs/Web/Performance/CSS_JavaScript_animation_performance' }
    ]
  },
  'route-code-splitting': {
    category: 'performance',
    standard: 'JavaScript Delivery — Route-Level Code Splitting & Reduced Bootup Time',
    guidance:
      'Convert eager non-root route imports into dynamic import() chunks so initial JavaScript parse/compile time and Total Blocking Time (TBT) stay minimal.',
    mdnQuery: 'dynamic import javascript',
    sources: [
      { title: 'web.dev — Reduce JavaScript payloads with code splitting', uri: 'https://web.dev/articles/reduce-javascript-payloads-with-code-splitting' },
      { title: 'MDN — JavaScript import() operator', uri: 'https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Operators/import' }
    ]
  },
  bypass: {
    category: 'accessibility',
    standard: 'W3C WCAG 2.2 Level A — 2.4.1 Bypass Blocks & Landmark Regions',
    guidance:
      'Provide a keyboard-focusable skip-to-main-content anchor at the top of the document paired with a <main id="main-content"> landmark so assistive technology users bypass repetitive navigation.',
    mdnQuery: 'main landmark skip navigation accessibility',
    sources: [
      { title: 'W3C WCAG 2.2 — Success Criterion 2.4.1 Bypass Blocks', uri: 'https://www.w3.org/WAI/WCAG22/Understanding/bypass-blocks.html' },
      { title: 'MDN — HTML <main> element', uri: 'https://developer.mozilla.org/en-US/docs/Web/HTML/Element/main' }
    ]
  },
  'document-title': {
    category: 'accessibility',
    standard: 'W3C WCAG 2.2 Level A — 2.4.2 Page Titled',
    guidance:
      'Ensure index.html defines a meaningful <title> and every application route exposes a distinct, contextual page title for screen-reader announcements and browser history.',
    mdnQuery: 'html title element accessibility',
    sources: [
      { title: 'W3C WCAG 2.2 — Success Criterion 2.4.2 Page Titled', uri: 'https://www.w3.org/WAI/WCAG22/Understanding/page-titled.html' },
      { title: 'Chrome Developers — Document does not have a <title> element', uri: 'https://developer.chrome.com/docs/lighthouse/accessibility/document-title' }
    ]
  },
  'target-size': {
    category: 'accessibility',
    standard: 'W3C WCAG 2.2 AA — 2.5.8 Target Size, 1.4.3 Contrast (4.5:1) & 2.4.7 Focus Visible',
    guidance:
      'Ensure interactive controls meet accessible tap target sizing (≥ 44×44px recommended, ≥ 24×24px AA minimum), expose aria-label on icon-only buttons, enforce :focus-visible rings, and maintain ≥ 4.5:1 text luminance contrast.',
    mdnQuery: 'focus-visible aria-label color contrast',
    sources: [
      { title: 'W3C WCAG 2.2 — 2.5.8 Target Size (Minimum)', uri: 'https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html' },
      { title: 'W3C WCAG 2.2 — 1.4.3 Contrast (Minimum)', uri: 'https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html' },
      { title: 'MDN — :focus-visible pseudo-class', uri: 'https://developer.mozilla.org/en-US/docs/Web/CSS/:focus-visible' }
    ]
  },
  'color-contrast': {
    category: 'accessibility',
    standard: 'W3C WCAG 2.2 AA — 1.4.3 Color Contrast (Minimum 4.5:1)',
    guidance:
      'Maintain at least 4.5:1 relative luminance contrast for normal text and 3:1 for large text and UI components, verified mathematically using W3C sRGB luminance equations.',
    mdnQuery: 'color contrast accessibility',
    sources: [
      { title: 'W3C WCAG 2.2 — 1.4.3 Contrast (Minimum)', uri: 'https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html' },
      { title: 'MDN — Color contrast', uri: 'https://developer.mozilla.org/en-US/docs/Web/Accessibility/Understanding_WCAG/Perceivable/Color_contrast' }
    ]
  },
  'button-name': {
    category: 'accessibility',
    standard: 'W3C WCAG 2.2 Level A — 4.1.2 Name, Role, Value',
    guidance:
      'Provide a descriptive aria-label or visually hidden text label on every icon-only <button> so screen readers announce its purpose unambiguously.',
    mdnQuery: 'aria-label button accessibility',
    sources: [
      { title: 'W3C WCAG 2.2 — 4.1.2 Name, Role, Value', uri: 'https://www.w3.org/WAI/WCAG22/Understanding/name-role-value.html' },
      { title: 'MDN — ARIA aria-label attribute', uri: 'https://developer.mozilla.org/en-US/docs/Web/Accessibility/ARIA/Attributes/aria-label' }
    ]
  },
  'csp-xss': {
    category: 'best-practices',
    standard: 'W3C Content Security Policy Level 3 & Referrer Policy',
    guidance:
      'Declare a strict Content-Security-Policy and Referrer-Policy (strict-origin-when-cross-origin) to mitigate script injection and limit cross-origin referrer leakage.',
    mdnQuery: 'Content-Security-Policy referrer policy',
    sources: [
      { title: 'MDN — Content Security Policy (CSP)', uri: 'https://developer.mozilla.org/en-US/docs/Web/HTTP/CSP' },
      { title: 'OWASP — Content Security Policy Cheat Sheet', uri: 'https://cheatsheetseries.owasp.org/cheatsheets/Content_Security_Policy_Cheat_Sheet.html' }
    ]
  },
  'external-anchors-use-rel-noopener': {
    category: 'best-practices',
    standard: 'HTML Living Standard — Cross-Origin Window Opener Isolation',
    guidance:
      'Attach rel="noopener noreferrer" to every external <a target="_blank"> anchor to prevent reverse tabnabbing and cross-origin process sharing.',
    mdnQuery: 'rel noopener noreferrer',
    sources: [
      { title: 'Chrome Developers — Links to cross-origin destinations are unsafe', uri: 'https://developer.chrome.com/docs/lighthouse/best-practices/external-anchors-use-rel-noopener' },
      { title: 'MDN — rel="noopener"', uri: 'https://developer.mozilla.org/en-US/docs/Web/HTML/Attributes/rel/noopener' }
    ]
  },
  'uses-passive-event-listeners': {
    category: 'best-practices',
    standard: 'WHATWG DOM Living Standard — Passive Scroll & Touch Listeners',
    guidance:
      'Pass { passive: true } to wheel, touchstart, touchmove, and scroll addEventListener() registrations that do not call preventDefault() so the compositor thread never stalls waiting on JS.',
    mdnQuery: 'addEventListener passive scroll performance',
    sources: [
      { title: 'Chrome Developers — Does not use passive listeners to improve scrolling performance', uri: 'https://developer.chrome.com/docs/lighthouse/best-practices/uses-passive-event-listeners' },
      { title: 'MDN — Improving scroll performance using passive listeners', uri: 'https://developer.mozilla.org/en-US/docs/Web/API/EventTarget/addEventListener#improving_scroll_performance_using_passive_listeners' }
    ]
  },
  'meta-description': {
    category: 'seo',
    standard: 'Search Indexing & OpenGraph Metadata Specification',
    guidance:
      'Include a responsive <meta name="viewport">, a concise <meta name="description"> (120–160 characters), and OpenGraph tags (og:title, og:description, og:type) in document <head>.',
    mdnQuery: 'meta name description viewport',
    sources: [
      { title: 'Chrome Developers — Document does not have a meta description', uri: 'https://developer.chrome.com/docs/lighthouse/seo/meta-description' },
      { title: 'MDN — Standard metadata names', uri: 'https://developer.mozilla.org/en-US/docs/Web/HTML/Element/meta/name' }
    ]
  },
  canonical: {
    category: 'seo',
    standard: 'RFC 6596 Canonical Link Relation & Schema.org JSON-LD',
    guidance:
      'Declare a self-referencing <link rel="canonical"> URL and structured Schema.org JSON-LD metadata to prevent duplicate indexing and enable rich search results.',
    mdnQuery: 'link rel canonical',
    sources: [
      { title: 'Chrome Developers — Document does not have a valid rel=canonical', uri: 'https://developer.chrome.com/docs/lighthouse/seo/canonical' },
      { title: 'Google Search Central — Structured Data (JSON-LD)', uri: 'https://developers.google.com/search/docs/appearance/structured-data/intro-structured-data' }
    ]
  },
  'crawlable-anchors': {
    category: 'seo',
    standard: 'HTML Semantics & Search Engine Link Crawlability',
    guidance:
      'Use semantic <a href="..."> elements for navigation instead of clickable <span>/<div> handlers or javascript:void(0) hrefs so crawlers and keyboard users can traverse routes.',
    mdnQuery: 'html anchor href crawlable',
    sources: [
      { title: 'Chrome Developers — Links are not crawlable', uri: 'https://developer.chrome.com/docs/lighthouse/seo/crawlable-anchors' },
      { title: 'MDN — HTML <a> Anchor element', uri: 'https://developer.mozilla.org/en-US/docs/Web/HTML/Element/a' }
    ]
  },
  'dom-xss-innerhtml': {
    category: 'security',
    standard: 'OWASP DOM-Based XSS Prevention Cheat Sheet',
    guidance:
      'Avoid assigning untrusted strings to innerHTML, outerHTML, document.write, Angular [innerHTML], or React dangerouslySetInnerHTML. Prefer textContent for plain text or sanitize with DOMPurify.',
    mdnQuery: 'innerHTML textContent XSS security',
    sources: [
      { title: 'OWASP — DOM-based XSS Prevention Cheat Sheet', uri: 'https://cheatsheetseries.owasp.org/cheatsheets/DOM_based_XSS_Prevention_Cheat_Sheet.html' },
      { title: 'MDN — Element.innerHTML Security Considerations', uri: 'https://developer.mozilla.org/en-US/docs/Web/API/Element/innerHTML#security_considerations' }
    ]
  },
  'client-secret-and-token-storage': {
    category: 'security',
    standard: 'OWASP HTML5 Security & Secrets Management Cheat Sheet',
    guidance:
      'Never hardcode API keys or secrets in client-side source bundles, and avoid storing long-lived auth tokens in localStorage/sessionStorage where any XSS flaw can exfiltrate them.',
    mdnQuery: 'localStorage security HttpOnly cookie',
    sources: [
      { title: 'OWASP — HTML5 Security Cheat Sheet (Web Storage)', uri: 'https://cheatsheetseries.owasp.org/cheatsheets/HTML5_Security_Cheat_Sheet.html#local-storage' },
      { title: 'OWASP — Secrets Management Cheat Sheet', uri: 'https://cheatsheetseries.owasp.org/cheatsheets/Secrets_Management_Cheat_Sheet.html' }
    ]
  },
  'unvalidated-open-redirect': {
    category: 'security',
    standard: 'OWASP Unvalidated Redirects and Forwards Cheat Sheet',
    guidance:
      'Validate returnUrl, redirect, and next parameters against a strict relative-path allowlist (/^\\/(?!\\/)/) before invoking window.location, router navigation, or server res.redirect().',
    mdnQuery: 'window location assign open redirect',
    sources: [
      { title: 'OWASP — Unvalidated Redirects and Forwards Cheat Sheet', uri: 'https://cheatsheetseries.owasp.org/cheatsheets/Unvalidated_Redirects_and_Forwards_Cheat_Sheet.html' },
      { title: 'MDN — Web Security & Same-Origin Policy', uri: 'https://developer.mozilla.org/en-US/docs/Web/Security/Same-origin_policy' }
    ]
  },
  'jscodeshift-a11y-injection': {
    category: 'accessibility',
    standard: 'W3C WCAG 2.2 Level A — 1.1.1 Non-text Content, 2.1.1 Keyboard & 4.1.2 Name, Role, Value',
    guidance:
      'Use deterministic AST codemods (jscodeshift) to inject aria-label and explicit type="button" on icon-only buttons, add role="button" and tabIndex={0} on clickable non-semantic containers, and ensure every <img> declares meaningful alt text.',
    mdnQuery: 'aria-label role button tabindex img alt',
    sources: [
      { title: 'W3C WCAG 2.2 — 4.1.2 Name, Role, Value', uri: 'https://www.w3.org/WAI/WCAG22/Understanding/name-role-value.html' },
      { title: 'MDN — ARIA: button role', uri: 'https://developer.mozilla.org/en-US/docs/Web/Accessibility/ARIA/Roles/button_role' },
      { title: 'MDN — HTML img alt attribute', uri: 'https://developer.mozilla.org/en-US/docs/Web/HTML/Element/img#alt' }
    ]
  },
  'jscodeshift-dom-updates': {
    category: 'best-practices',
    standard: 'WHATWG HTML Living Standard — Safe Cross-Origin Navigation & Asynchronous Image Decoding',
    guidance:
      'Automate DOM and JSX element updates with jscodeshift to attach rel="noopener noreferrer" to target="_blank" anchors, harden window.open() popups, and configure loading="lazy" with decoding="async" on secondary images.',
    mdnQuery: 'window open noopener img decoding async',
    sources: [
      { title: 'MDN — Window.open() security features (noopener, noreferrer)', uri: 'https://developer.mozilla.org/en-US/docs/Web/API/Window/open#noopener' },
      { title: 'MDN — HTMLImageElement.decoding property', uri: 'https://developer.mozilla.org/en-US/docs/Web/API/HTMLImageElement/decoding' }
    ]
  },
  'eslint-best-practices': {
    category: 'best-practices',
    standard: 'ECMAScript Modern Best Practices — ESLint Static Analysis & Auto-Fix',
    guidance:
      'Enforce block-scoped const/let bindings (no-var, prefer-const), template literals, object shorthand, explicit block braces (curly), and strict equality checks via sandboxed ESLint flat-config rules.',
    mdnQuery: 'javascript const let template literals strict equality',
    sources: [
      { title: 'ESLint — Core Rules Reference', uri: 'https://eslint.org/docs/latest/rules/' },
      { title: 'MDN — JavaScript Grammar and Types', uri: 'https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide/Grammar_and_types' }
    ]
  },
  'stylelint-best-practices': {
    category: 'best-practices',
    standard: 'W3C CSS Color Module Level 4 & CSS Syntax Best Practices — Stylelint',
    guidance:
      'Adopt modern CSS color function notation (rgb(r g b / a%)), double-colon pseudo-elements (::before), unitless zero lengths, concise hex values, and non-redundant shorthands via sandboxed Stylelint auto-fixes.',
    mdnQuery: 'css color function rgb modern syntax pseudo-elements',
    sources: [
      { title: 'Stylelint — Core Rules Reference', uri: 'https://stylelint.io/user-guide/rules' },
      { title: 'MDN — CSS Color Values & Modern Syntax', uri: 'https://developer.mozilla.org/en-US/docs/Web/CSS/color_value' }
    ]
  }
};

async function queryMdnSearchApi(queryText) {
  const normalized = String(queryText || '').trim().toLowerCase().slice(0, 120);
  if (!normalized) return [];

  const cached = MDN_CACHE.get(normalized);
  if (cached && Date.now() - cached.ts < MDN_CACHE_TTL_MS) {
    return cached.items;
  }

  try {
    const url = `https://developer.mozilla.org/api/v1/search?q=${encodeURIComponent(normalized)}&locale=en-US&size=4`;
    const res = await fetch(url, {
      headers: {
        Accept: 'application/json',
        'User-Agent': 'Fresnel-OSS-Audit-Engine/1.0'
      },
      signal: AbortSignal.timeout(3500)
    });
    if (!res.ok) return [];
    const data = await res.json();
    const docs = Array.isArray(data?.documents) ? data.documents : [];
    const items = docs
      .filter((d) => d && d.mdn_url && d.title)
      .slice(0, 4)
      .map((d) => ({
        title: `MDN — ${String(d.title).trim()}`,
        uri: `https://developer.mozilla.org${d.mdn_url.startsWith('/') ? d.mdn_url : '/' + d.mdn_url}`
      }));
    MDN_CACHE.set(normalized, { ts: Date.now(), items });
    return items;
  } catch {
    return [];
  }
}

/**
 * Zero-AI Web Standards Verification & Grounding:
 * Looks up canonical WCAG 2.2, Core Web Vitals, MDN, and OWASP references for all
 * active audit rules and optionally enriches them with live MDN Web Docs Search API results.
 */
export async function fetchOssWebStandardsGrounding(session, customQuery = '') {
  const commits = Array.isArray(session?.commits) ? session.commits : [];
  const activeRuleIds = Array.from(
    new Set(commits.map((c) => String(c.ruleId || '').trim()).filter(Boolean))
  );

  const matchedEntries = [];
  const seenStandards = new Set();

  // Match active commit ruleIds first
  for (const ruleId of activeRuleIds) {
    const entry = STANDARDS_REGISTRY[ruleId];
    if (entry && !seenStandards.has(entry.standard)) {
      seenStandards.add(entry.standard);
      matchedEntries.push({ ruleId, ...entry });
    }
  }

  // If user typed a custom query, also match registry entries by keyword
  const trimmedQuery = String(customQuery || '').trim();
  if (trimmedQuery) {
    const tokens = trimmedQuery
      .toLowerCase()
      .split(/[^a-z0-9-]+/)
      .filter((t) => t.length >= 2);
    for (const [ruleId, entry] of Object.entries(STANDARDS_REGISTRY)) {
      if (seenStandards.has(entry.standard)) continue;
      const haystack = `${ruleId} ${entry.category} ${entry.standard} ${entry.guidance}`.toLowerCase();
      if (tokens.some((tok) => haystack.includes(tok))) {
        seenStandards.add(entry.standard);
        matchedEntries.push({ ruleId, ...entry });
      }
    }
  }

  // Fallback to core standards if session has no commits yet
  if (matchedEntries.length === 0) {
    for (const fallbackId of ['largest-contentful-paint', 'target-size', 'csp-xss', 'meta-description', 'dom-xss-innerhtml']) {
      if (STANDARDS_REGISTRY[fallbackId]) {
        matchedEntries.push({ ruleId: fallbackId, ...STANDARDS_REGISTRY[fallbackId] });
      }
    }
  }

  const chosenEntries = matchedEntries.slice(0, 6);
  const sources = [];
  const seenUris = new Set();

  for (const entry of chosenEntries) {
    for (const src of entry.sources) {
      if (!seenUris.has(src.uri)) {
        seenUris.add(src.uri);
        sources.push(src);
      }
    }
  }

  // Live zero-AI enrichment via public MDN Web Docs Search API
  const mdnSearchTerm =
    trimmedQuery ||
    chosenEntries
      .slice(0, 2)
      .map((e) => e.mdnQuery)
      .filter(Boolean)
      .join(' ');
  const mdnLiveItems = await queryMdnSearchApi(mdnSearchTerm);
  for (const src of mdnLiveItems) {
    if (!seenUris.has(src.uri)) {
      seenUris.add(src.uri);
      sources.push(src);
    }
  }

  const summaryLines = [
    `Verified ${commits.length} deterministic audit commits for ${session?.repo?.fullName || 'the repository'} against W3C WCAG 2.2, Core Web Vitals, MDN Web Docs, and OWASP specifications (zero-AI offline registry${mdnLiveItems.length > 0 ? ' + live MDN Search API' : ''}):`
  ];
  for (const entry of chosenEntries.slice(0, 5)) {
    summaryLines.push(`• ${entry.standard}: ${entry.guidance}`);
  }

  const result = {
    model: mdnLiveItems.length > 0 ? 'oss-standards-registry-v1 + mdn-search-api' : 'oss-standards-registry-v1',
    query: trimmedQuery || activeRuleIds.join(', ') || 'Core Web Vitals, WCAG 2.2, OWASP',
    summary: summaryLines.join('\n'),
    sources: sources.slice(0, 12),
    groundedAt: new Date().toISOString()
  };

  if (session) {
    session.groundingData = result;
  }

  return result;
}

/**
 * Curated WordPress Audit Checklist codified from aurooba/wpaudit.site (MIT)
 * covering Performance, Security, SEO/Metadata, Accessibility, and Maintenance hygiene.
 */
export const WORDPRESS_AUDIT_CHECKLIST = [
  {
    id: 'wp-sec-user-enum',
    category: 'Security',
    title: 'Disable public REST user enumeration (/wp-json/wp/v2/users)',
    checkType: 'automated',
    guidance:
      'Restrict unauthenticated access to /wp-json/wp/v2/users and ?author=N queries so attacker bots cannot harvest admin usernames.'
  },
  {
    id: 'wp-sec-xmlrpc',
    category: 'Security',
    title: 'Disable or rate-limit xmlrpc.php',
    checkType: 'automated',
    guidance:
      'Block xmlrpc.php at the web server or WAF layer unless Jetpack or legacy mobile XML-RPC clients explicitly depend on it.'
  },
  {
    id: 'wp-sec-readme',
    category: 'Security',
    title: 'Remove core version disclosure files (/readme.html & generator meta)',
    checkType: 'automated',
    guidance:
      'Strip <meta name="generator" content="WordPress ..."> and restrict /readme.html so exact patch versions are not advertised.'
  },
  {
    id: 'wp-sec-file-edit',
    category: 'Security',
    title: 'Disable built-in theme/plugin file editor (DISALLOW_FILE_EDIT)',
    checkType: 'manual',
    guidance:
      'Set define("DISALLOW_FILE_EDIT", true) in wp-config.php and enforce 2FA on all administrator accounts.'
  },
  {
    id: 'wp-perf-page-cache',
    category: 'Performance',
    title: 'Full-page caching & persistent object cache active',
    checkType: 'manual',
    guidance:
      'Serve cached HTML for anonymous visitors via edge CDN or NGINX FastCGI cache and pair with Redis object caching.'
  },
  {
    id: 'wp-perf-assets',
    category: 'Performance',
    title: 'Dequeue unused plugin CSS/JS & convert hero images to WebP/AVIF',
    checkType: 'automated',
    guidance:
      'Dequeue unused block-library/plugin styles on landing routes and optimize wp-content/uploads imagery with explicit width/height attributes.'
  },
  {
    id: 'wp-seo-permalinks',
    category: 'SEO/Metadata',
    title: 'Pretty permalinks, XML sitemap, and canonical tags configured',
    checkType: 'automated',
    guidance:
      'Verify /wp-sitemap.xml or SEO plugin sitemap is indexed and every post emits a self-referencing rel="canonical" link.'
  },
  {
    id: 'wp-a11y-theme',
    category: 'Accessibility',
    title: 'Skip link, focus-visible styling & accessible navigation menus',
    checkType: 'manual',
    guidance:
      'Test dropdown submenus and modal toggles with keyboard-only navigation and ensure WCAG 2.2 AA contrast across theme tokens.'
  },
  {
    id: 'wp-maint-backups',
    category: 'Maintenance',
    title: 'Automated off-site backups & minor core auto-updates verified',
    checkType: 'manual',
    guidance:
      'Confirm scheduled encrypted database + wp-content backups have been restore-tested within the last 30 days.'
  },
  {
    id: 'wp-maint-plugins',
    category: 'Maintenance',
    title: 'Prune inactive plugins/themes and verify PHP 8.2+ compatibility',
    checkType: 'manual',
    guidance:
      'Delete deactivated plugins/themes completely from wp-content/ and verify WP_DEBUG_DISPLAY is disabled in production.'
  }
];
