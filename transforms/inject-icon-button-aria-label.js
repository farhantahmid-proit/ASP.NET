/**
 * Fresnel Root jscodeshift Transform: `inject-icon-button-aria-label`
 *
 * Automates accessibility remediation for icon-only `<button>` controls by:
 * 1. Detecting `<button>` JSX elements (and optionally `<IconButton>` elements)
 *    that have no visible text nodes and lack `aria-label`, `aria-labelledby`, or `title`.
 * 2. Injecting a deterministic, human-readable `aria-label` inferred from:
 *    - Event handlers (`onClick={handleClose}` -> `"Close"`, `onClick={onDismiss}` -> `"Dismiss"`)
 *    - Icon component tags (`<SearchIcon />` -> `"Search"`, `<MenuIcon />` -> `"Menu"`)
 *    - Element metadata (`data-testid`, `id`, `name`, or `className`)
 *    - Configurable `options.defaultLabel` fallback (`"Action button"`).
 * 3. Ensuring native `<button>` elements define `type="button"` when missing.
 *
 * CLI usage:
 *   npx jscodeshift -t transforms/inject-icon-button-aria-label.js src/ --extensions=tsx,jsx --parser=tsx
 */

export const parser = 'tsx';

const ICON_TAG_NAMES = new Set(['svg', 'path', 'circle', 'rect', 'line', 'polygon', 'polyline', 'img', 'i', 'mat-icon']);

function getJsxTagName(openingElement) {
  if (!openingElement || !openingElement.name) return '';
  if (openingElement.name.type === 'JSXIdentifier') {
    return openingElement.name.name;
  }
  return '';
}

function findJsxAttr(openingElement, attrName) {
  const target = attrName.toLowerCase();
  const attrs = openingElement?.attributes || [];
  return attrs.find(
    (attr) =>
      attr &&
      attr.type === 'JSXAttribute' &&
      attr.name &&
      attr.name.type === 'JSXIdentifier' &&
      attr.name.name.toLowerCase() === target
  );
}

function getJsxStringAttrValue(attr) {
  if (!attr || !attr.value) return '';
  if (attr.value.type === 'StringLiteral' || attr.value.type === 'Literal') {
    return String(attr.value.value ?? '');
  }
  if (
    attr.value.type === 'JSXExpressionContainer' &&
    attr.value.expression &&
    (attr.value.expression.type === 'StringLiteral' || attr.value.expression.type === 'Literal')
  ) {
    return String(attr.value.expression.value ?? '');
  }
  return '';
}

function humanizeToken(raw = '') {
  const cleaned = String(raw || '')
    .replace(/^(handle|on|btn|icon|action)/i, '')
    .replace(/(Btn|Button|Icon|Action|Trigger)$/i, '')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/[-_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!cleaned) return '';
  return cleaned.charAt(0).toUpperCase() + cleaned.slice(1).toLowerCase();
}

export function hasVisibleJsxText(jsxElement) {
  const children = jsxElement?.children || [];
  for (const child of children) {
    if (child.type === 'JSXText' && child.value && child.value.trim().length > 0) {
      return true;
    }
    if (child.type === 'JSXExpressionContainer' && child.expression?.type !== 'JSXEmptyExpression') {
      if (child.expression?.type === 'StringLiteral' || child.expression?.type === 'Literal') {
        if (String(child.expression.value || '').trim().length > 0) return true;
      } else if (child.expression?.type === 'Identifier') {
        return true;
      }
    }
    if (child.type === 'JSXElement') {
      const tag = getJsxTagName(child.openingElement).toLowerCase();
      const isIconComponent = tag.endsWith('icon') || ICON_TAG_NAMES.has(tag);
      if (!isIconComponent && hasVisibleJsxText(child)) {
        return true;
      }
    }
  }
  return false;
}

export function inferIconButtonLabel(jsxElement, defaultLabel = 'Action button') {
  const opening = jsxElement?.openingElement;
  if (!opening) return defaultLabel;

  // 1. Check onClick handler identifier or arrow call expression
  const clickAttr = findJsxAttr(opening, 'onClick');
  if (clickAttr?.value?.type === 'JSXExpressionContainer') {
    const expr = clickAttr.value.expression;
    let raw = '';
    if (expr?.type === 'Identifier') {
      raw = expr.name;
    } else if (expr?.type === 'MemberExpression' && expr.property?.type === 'Identifier') {
      raw = expr.property.name;
    } else if (
      (expr?.type === 'ArrowFunctionExpression' || expr?.type === 'FunctionExpression') &&
      expr.body?.type === 'CallExpression'
    ) {
      const callee = expr.body.callee;
      if (callee?.type === 'Identifier') raw = callee.name;
      else if (callee?.type === 'MemberExpression' && callee.property?.type === 'Identifier') {
        raw = callee.property.name;
      }
    }
    const label = humanizeToken(raw);
    if (label) return label;
  }

  // 2. Check child icon component name (e.g. <CloseIcon />, <TrashIcon />)
  for (const child of jsxElement?.children || []) {
    if (child.type === 'JSXElement') {
      const childTag = getJsxTagName(child.openingElement);
      if (childTag && childTag.toLowerCase().endsWith('icon')) {
        const label = humanizeToken(childTag);
        if (label) return label;
      }
    }
  }

  // 3. Check data-testid, id, name, or className tokens
  for (const attrKey of ['data-testid', 'id', 'name', 'className']) {
    const val = getJsxStringAttrValue(findJsxAttr(opening, attrKey));
    if (val) {
      const firstMeaningful = val
        .split(/\s+/)
        .map((token) => humanizeToken(token))
        .find(Boolean);
      if (firstMeaningful) return firstMeaningful;
    }
  }

  return defaultLabel;
}

/**
 * Standard jscodeshift transformer entry point.
 */
export default function transformer(fileInfo, api, options = {}) {
  const j = api.jscodeshift;
  const root = j(fileInfo.source);
  const defaultLabel = typeof options.defaultLabel === 'string' && options.defaultLabel.trim()
    ? options.defaultLabel.trim()
    : 'Action button';
  const targetTags = options.includeIconButtonComponents
    ? new Set(['button', 'IconButton'])
    : new Set(['button']);

  let mutated = false;
  let ariaLabelsInjected = 0;
  let buttonTypesInjected = 0;

  root.find(j.JSXElement).forEach((path) => {
    const opening = path.node.openingElement;
    const tag = getJsxTagName(opening);
    if (!targetTags.has(tag)) return;

    if (tag === 'button' && !findJsxAttr(opening, 'type')) {
      opening.attributes.push(
        j.jsxAttribute(j.jsxIdentifier('type'), j.stringLiteral('button'))
      );
      buttonTypesInjected++;
      mutated = true;
    }

    const hasAccessibleName =
      Boolean(findJsxAttr(opening, 'aria-label')) ||
      Boolean(findJsxAttr(opening, 'aria-labelledby')) ||
      Boolean(findJsxAttr(opening, 'title'));

    if (!hasAccessibleName && !hasVisibleJsxText(path.node)) {
      const label = inferIconButtonLabel(path.node, defaultLabel);
      opening.attributes.push(
        j.jsxAttribute(j.jsxIdentifier('aria-label'), j.stringLiteral(label))
      );
      ariaLabelsInjected++;
      mutated = true;
    }
  });

  if (!mutated) {
    return null;
  }

  if (typeof options.onMetrics === 'function') {
    options.onMetrics({ ariaLabelsInjected, buttonTypesInjected });
  }

  return root.toSource({ quote: 'double', trailingComma: false });
}
