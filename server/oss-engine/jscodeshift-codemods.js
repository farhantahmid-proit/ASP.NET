/**
 * Fresnel jscodeshift Deterministic AST Codemod Engine
 *
 * Uses `jscodeshift` (Recast + Babel/TypeScript/TSX parsers) to perform
 * format-preserving, deterministic AST-based code transformations:
 * 1. Automated Accessibility Property Injection (JSX/TSX + imperative DOM)
 *    - Icon-only <button> aria-label & type="button" injection
 *    - Interactive <div onClick> / <span onClick> role="button" & tabIndex={0}
 *    - <img> alt attribute injection inferred from src filename
 *    - Imperative document.createElement('button') type & aria-label injection
 * 2. Automated DOM Element Updates (JSX/TSX + imperative DOM)
 *    - <a target="_blank"> rel="noopener noreferrer" injection/merging
 *    - <img> loading="lazy" / decoding="async" / hero fetchPriority="high"
 *    - Imperative anchor.target = '_blank' -> anchor.rel = 'noopener noreferrer'
 *    - Imperative document.createElement('img') -> decoding/loading/alt attributes
 *    - window.open(url, '_blank') -> safe 'noopener,noreferrer' windowFeatures
 */

import jscodeshift from 'jscodeshift';
import { applyCommitChangesToFiles, buildCommitRecord } from './ast-rules.js';

/**
 * Selects the appropriate jscodeshift parser for a given file path.
 */
export function getJscodeshiftForFile(relPath = '') {
  const lower = String(relPath).toLowerCase();
  if (lower.endsWith('.tsx') || lower.endsWith('.jsx')) {
    return jscodeshift.withParser('tsx');
  }
  if (lower.endsWith('.ts')) {
    return jscodeshift.withParser('ts');
  }
  return jscodeshift.withParser('babel');
}

/**
 * Runs a pure jscodeshift transform function safely on source code and returns
 * `{ changed, output, stats }` without mutating inputs or throwing on syntax edge cases.
 */
export function applyJscodeshiftTransform(source, relPath, transformFn) {
  try {
    const j = getJscodeshiftForFile(relPath);
    const root = j(source);
    const stats = transformFn(j, root, relPath);
    if (!stats || !stats.mutated) {
      return { changed: false, output: source, stats: stats || { mutated: false } };
    }
    const isJsx = /\.(tsx|jsx)$/i.test(String(relPath || ''));
    const output = root.toSource(
      isJsx ? { quote: 'double', trailingComma: false } : { quote: 'single', trailingComma: false }
    );
    return {
      changed: output !== source,
      output,
      stats
    };
  } catch {
    return { changed: false, output: source, stats: { mutated: false, skippedParse: true } };
  }
}

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

function inferLabelFromHandlerAttr(attr) {
  if (!attr || !attr.value || attr.value.type !== 'JSXExpressionContainer') return 'Action button';
  const expr = attr.value.expression;
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
  if (!raw) return 'Action button';
  const cleaned = raw
    .replace(/^(handle|on)/, '')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .trim();
  if (!cleaned) return 'Action button';
  return cleaned.charAt(0).toUpperCase() + cleaned.slice(1).toLowerCase();
}

function inferAltFromSrc(srcValue = '') {
  const clean = String(srcValue || '')
    .split('?')[0]
    .split('#')[0]
    .split('/')
    .pop();
  if (!clean) return 'Illustration';
  const base = clean.replace(/\.[a-z0-9]+$/i, '').replace(/[-_]+/g, ' ').trim();
  if (!base) return 'Illustration';
  return base.charAt(0).toUpperCase() + base.slice(1);
}

function hasJsxVisibleText(jsxElement) {
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
      if (tag !== 'svg' && tag !== 'path' && tag !== 'circle' && tag !== 'rect' && tag !== 'img') {
        if (hasJsxVisibleText(child)) return true;
      }
    }
  }
  return false;
}

function humanizeVarName(name = '', fallback = 'Interactive control') {
  const cleaned = String(name || '')
    .replace(/(Btn|Button|El|Element|Icon|Img|Image|Link|Anchor)$/i, '')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .trim();
  if (!cleaned) return fallback;
  return cleaned.charAt(0).toUpperCase() + cleaned.slice(1).toLowerCase();
}

function blockContainsPropOrAttr(statements, varName, propNames, setAttrNames = []) {
  for (const stmt of statements) {
    if (stmt?.type !== 'ExpressionStatement') continue;
    const expr = stmt.expression;
    // varName.prop = ...
    if (
      expr?.type === 'AssignmentExpression' &&
      expr.left?.type === 'MemberExpression' &&
      expr.left.object?.type === 'Identifier' &&
      expr.left.object.name === varName &&
      expr.left.property?.type === 'Identifier' &&
      propNames.includes(expr.left.property.name)
    ) {
      return true;
    }
    // varName.setAttribute('attr', ...)
    if (
      expr?.type === 'CallExpression' &&
      expr.callee?.type === 'MemberExpression' &&
      expr.callee.object?.type === 'Identifier' &&
      expr.callee.object.name === varName &&
      expr.callee.property?.type === 'Identifier' &&
      expr.callee.property.name === 'setAttribute' &&
      expr.arguments?.length >= 1
    ) {
      const firstArg = expr.arguments[0];
      if (
        (firstArg.type === 'StringLiteral' || firstArg.type === 'Literal') &&
        setAttrNames.includes(String(firstArg.value).toLowerCase())
      ) {
        return true;
      }
    }
  }
  return false;
}

// ============================================================================
// CODEMOD 1 (Accessibility): Automated JSX/TSX & DOM Accessibility Property Injection
// ============================================================================
export function runJscodeshiftA11yCodemod(files, repoMeta) {
  const codeFiles = files.filter((f) => /\.(tsx|jsx|ts|js|mjs)$/i.test(f.relPath));
  const changes = [];
  const totals = {
    buttonLabelsInjected: 0,
    interactiveRolesInjected: 0,
    imageAltsInjected: 0,
    domButtonsHardened: 0
  };

  for (const file of codeFiles) {
    if (
      !/<(button|div|span|img)\b|createElement\s*\(\s*['"]button['"]\s*\)/i.test(file.content)
    ) {
      continue;
    }

    const { changed, output, stats } = applyJscodeshiftTransform(file.content, file.relPath, (j, root) => {
      let mutated = false;
      const local = {
        buttonLabelsInjected: 0,
        interactiveRolesInjected: 0,
        imageAltsInjected: 0,
        domButtonsHardened: 0
      };

      // 1. JSX <button> accessibility property injection (aria-label + type="button")
      root.find(j.JSXElement).forEach((path) => {
        const opening = path.node.openingElement;
        const tag = getJsxTagName(opening);

        if (tag === 'button') {
          const hasAria =
            findJsxAttr(opening, 'aria-label') ||
            findJsxAttr(opening, 'aria-labelledby') ||
            findJsxAttr(opening, 'title');
          const hasType = findJsxAttr(opening, 'type');

          if (!hasType) {
            opening.attributes.push(
              j.jsxAttribute(j.jsxIdentifier('type'), j.stringLiteral('button'))
            );
            mutated = true;
          }

          if (!hasAria && !hasJsxVisibleText(path.node)) {
            const clickAttr = findJsxAttr(opening, 'onClick');
            const label = inferLabelFromHandlerAttr(clickAttr);
            opening.attributes.push(
              j.jsxAttribute(j.jsxIdentifier('aria-label'), j.stringLiteral(label))
            );
            local.buttonLabelsInjected++;
            mutated = true;
          }
        }

        // 2. Clickable <div onClick> / <span onClick> -> inject role="button" & tabIndex={0}
        if ((tag === 'div' || tag === 'span') && findJsxAttr(opening, 'onClick')) {
          const hasRole = findJsxAttr(opening, 'role');
          const hasTabIndex = findJsxAttr(opening, 'tabIndex');
          if (!hasRole) {
            opening.attributes.push(
              j.jsxAttribute(j.jsxIdentifier('role'), j.stringLiteral('button'))
            );
            local.interactiveRolesInjected++;
            mutated = true;
          }
          if (!hasTabIndex) {
            opening.attributes.push(
              j.jsxAttribute(
                j.jsxIdentifier('tabIndex'),
                j.jsxExpressionContainer(j.numericLiteral(0))
              )
            );
            mutated = true;
          }
        }

        // 3. JSX <img> missing alt -> inject deterministic alt inferred from src
        if (tag === 'img' && !findJsxAttr(opening, 'alt')) {
          const srcAttr = findJsxAttr(opening, 'src');
          const altText = inferAltFromSrc(getJsxStringAttrValue(srcAttr));
          opening.attributes.push(
            j.jsxAttribute(j.jsxIdentifier('alt'), j.stringLiteral(altText))
          );
          local.imageAltsInjected++;
          mutated = true;
        }
      });

      // 4. Imperative DOM: const btn = document.createElement('button')
      root.find(j.BlockStatement).forEach((blockPath) => {
        const body = blockPath.node.body;
        if (!Array.isArray(body)) return;

        for (let i = 0; i < body.length; i++) {
          const stmt = body[i];
          if (stmt.type !== 'VariableDeclaration') continue;
          for (const decl of stmt.declarations) {
            if (decl.id?.type !== 'Identifier') continue;
            const init = decl.init;
            if (
              init?.type !== 'CallExpression' ||
              init.callee?.type !== 'MemberExpression' ||
              init.callee.object?.name !== 'document' ||
              init.callee.property?.name !== 'createElement'
            ) {
              continue;
            }
            const firstArg = init.arguments?.[0];
            if (
              !firstArg ||
              (firstArg.type !== 'StringLiteral' && firstArg.type !== 'Literal') ||
              String(firstArg.value).toLowerCase() !== 'button'
            ) {
              continue;
            }

            const varName = decl.id.name;
            const toInsert = [];

            if (!blockContainsPropOrAttr(body, varName, ['type'], ['type'])) {
              toInsert.push(
                j.expressionStatement(
                  j.assignmentExpression(
                    '=',
                    j.memberExpression(j.identifier(varName), j.identifier('type')),
                    j.stringLiteral('button')
                  )
                )
              );
            }

            if (
              !blockContainsPropOrAttr(
                body,
                varName,
                ['textContent', 'innerText', 'ariaLabel'],
                ['aria-label', 'aria-labelledby', 'title']
              )
            ) {
              const inferred = humanizeVarName(varName, 'Action button');
              toInsert.push(
                j.expressionStatement(
                  j.callExpression(
                    j.memberExpression(j.identifier(varName), j.identifier('setAttribute')),
                    [j.stringLiteral('aria-label'), j.stringLiteral(inferred)]
                  )
                )
              );
            }

            if (toInsert.length > 0) {
              body.splice(i + 1, 0, ...toInsert);
              i += toInsert.length;
              local.domButtonsHardened++;
              mutated = true;
            }
          }
        }
      });

      return { mutated, ...local };
    });

    if (changed) {
      changes.push({ relPath: file.relPath, before: file.content, after: output });
      totals.buttonLabelsInjected += stats.buttonLabelsInjected || 0;
      totals.interactiveRolesInjected += stats.interactiveRolesInjected || 0;
      totals.imageAltsInjected += stats.imageAltsInjected || 0;
      totals.domButtonsHardened += stats.domButtonsHardened || 0;
    }
    if (changes.length >= 4) break;
  }

  if (changes.length === 0) return { commit: null, stats: totals };

  const detailParts = [];
  if (totals.buttonLabelsInjected > 0) {
    detailParts.push(`injected aria-label/type on ${totals.buttonLabelsInjected} JSX icon button(s)`);
  }
  if (totals.interactiveRolesInjected > 0) {
    detailParts.push(`added role="button" + tabIndex={0} to ${totals.interactiveRolesInjected} clickable container(s)`);
  }
  if (totals.imageAltsInjected > 0) {
    detailParts.push(`populated missing alt attributes on ${totals.imageAltsInjected} JSX <img> element(s)`);
  }
  if (totals.domButtonsHardened > 0) {
    detailParts.push(`hardened ${totals.domButtonsHardened} imperative document.createElement('button') node(s)`);
  }

  const commit = buildCommitRecord({
    repoMeta,
    category: 'accessibility',
    ruleId: 'jscodeshift-a11y-injection',
    ruleTitle: 'Inject deterministic ARIA labels, keyboard roles, and alt properties via jscodeshift AST',
    impact: 'High · WCAG 2.2 Level A (1.1.1, 2.1.1, 4.1.2)',
    analyzer: 'jscodeshift (Recast AST)',
    fixConfidence: 'auto-verified',
    title: 'Inject accessibility properties into JSX and imperative DOM controls via jscodeshift',
    commitMessage: 'a11y(jscodeshift): inject aria-label, keyboard role/tabIndex, and alt attributes via AST codemod',
    summary: `Executed deterministic jscodeshift AST transformations across ${changes.length} file(s): ${detailParts.join('; ')}.`,
    fileChanges: changes
  });

  return { commit, stats: totals };
}

// ============================================================================
// CODEMOD 2 (Best Practices): Automated DOM Element Updates via jscodeshift AST
// ============================================================================
export function runJscodeshiftDomUpdatesCodemod(files, repoMeta) {
  const codeFiles = files.filter((f) => /\.(tsx|jsx|ts|js|mjs)$/i.test(f.relPath));
  const changes = [];
  const totals = {
    jsxLinksHardened: 0,
    jsxImagesOptimized: 0,
    domAnchorsHardened: 0,
    domImagesUpdated: 0,
    windowOpensHardened: 0
  };

  for (const file of codeFiles) {
    if (
      !/_blank|createElement\s*\(\s*['"]img['"]\s*\)|window\.open\s*\(|<img\b/i.test(file.content)
    ) {
      continue;
    }

    const { changed, output, stats } = applyJscodeshiftTransform(file.content, file.relPath, (j, root) => {
      let mutated = false;
      const local = {
        jsxLinksHardened: 0,
        jsxImagesOptimized: 0,
        domAnchorsHardened: 0,
        domImagesUpdated: 0,
        windowOpensHardened: 0
      };

      // 1. JSX <a target="_blank"> -> inject or merge rel="noopener noreferrer"
      root.find(j.JSXOpeningElement).forEach((path) => {
        const opening = path.node;
        const tag = getJsxTagName(opening);

        if (tag === 'a') {
          const targetAttr = findJsxAttr(opening, 'target');
          if (getJsxStringAttrValue(targetAttr).toLowerCase() === '_blank') {
            const relAttr = findJsxAttr(opening, 'rel');
            if (!relAttr) {
              opening.attributes.push(
                j.jsxAttribute(j.jsxIdentifier('rel'), j.stringLiteral('noopener noreferrer'))
              );
              local.jsxLinksHardened++;
              mutated = true;
            } else {
              const currentRel = getJsxStringAttrValue(relAttr);
              const tokens = currentRel.toLowerCase().split(/\s+/).filter(Boolean);
              if (currentRel && (!tokens.includes('noopener') || !tokens.includes('noreferrer'))) {
                const merged = Array.from(new Set([...tokens, 'noopener', 'noreferrer'])).join(' ');
                relAttr.value = j.stringLiteral(merged);
                local.jsxLinksHardened++;
                mutated = true;
              }
            }
          }
        }

        // 2. JSX <img> -> add loading="lazy" / decoding="async" if missing
        if (tag === 'img') {
          const classVal = getJsxStringAttrValue(findJsxAttr(opening, 'className'));
          const isHero = /hero|banner|cover/i.test(classVal);
          let imgMutated = false;

          if (!isHero && !findJsxAttr(opening, 'loading')) {
            opening.attributes.push(
              j.jsxAttribute(j.jsxIdentifier('loading'), j.stringLiteral('lazy'))
            );
            imgMutated = true;
          }
          if (!findJsxAttr(opening, 'decoding')) {
            opening.attributes.push(
              j.jsxAttribute(
                j.jsxIdentifier('decoding'),
                j.stringLiteral(isHero ? 'sync' : 'async')
              )
            );
            imgMutated = true;
          }
          if (imgMutated) {
            local.jsxImagesOptimized++;
            mutated = true;
          }
        }
      });

      // 3. Imperative DOM updates inside BlockStatements
      root.find(j.BlockStatement).forEach((blockPath) => {
        const body = blockPath.node.body;
        if (!Array.isArray(body)) return;

        for (let i = 0; i < body.length; i++) {
          const stmt = body[i];

          // 3a. const img = document.createElement('img')
          if (stmt.type === 'VariableDeclaration') {
            for (const decl of stmt.declarations) {
              if (decl.id?.type !== 'Identifier') continue;
              const init = decl.init;
              if (
                init?.type === 'CallExpression' &&
                init.callee?.type === 'MemberExpression' &&
                init.callee.object?.name === 'document' &&
                init.callee.property?.name === 'createElement'
              ) {
                const firstArg = init.arguments?.[0];
                if (
                  firstArg &&
                  (firstArg.type === 'StringLiteral' || firstArg.type === 'Literal') &&
                  String(firstArg.value).toLowerCase() === 'img'
                ) {
                  const varName = decl.id.name;
                  const inserts = [];
                  if (!blockContainsPropOrAttr(body, varName, ['decoding'], ['decoding'])) {
                    inserts.push(
                      j.expressionStatement(
                        j.assignmentExpression(
                          '=',
                          j.memberExpression(j.identifier(varName), j.identifier('decoding')),
                          j.stringLiteral('async')
                        )
                      )
                    );
                  }
                  if (!blockContainsPropOrAttr(body, varName, ['loading'], ['loading'])) {
                    inserts.push(
                      j.expressionStatement(
                        j.assignmentExpression(
                          '=',
                          j.memberExpression(j.identifier(varName), j.identifier('loading')),
                          j.stringLiteral('lazy')
                        )
                      )
                    );
                  }
                  if (!blockContainsPropOrAttr(body, varName, ['alt'], ['alt'])) {
                    inserts.push(
                      j.expressionStatement(
                        j.assignmentExpression(
                          '=',
                          j.memberExpression(j.identifier(varName), j.identifier('alt')),
                          j.stringLiteral(humanizeVarName(varName, 'Graphic'))
                        )
                      )
                    );
                  }
                  if (inserts.length > 0) {
                    body.splice(i + 1, 0, ...inserts);
                    i += inserts.length;
                    local.domImagesUpdated++;
                    mutated = true;
                  }
                }
              }
            }
          }

          // 3b. anchor.target = '_blank' -> insert anchor.rel = 'noopener noreferrer'
          if (
            stmt.type === 'ExpressionStatement' &&
            stmt.expression?.type === 'AssignmentExpression' &&
            stmt.expression.left?.type === 'MemberExpression' &&
            stmt.expression.left.object?.type === 'Identifier' &&
            stmt.expression.left.property?.name === 'target' &&
            (stmt.expression.right?.type === 'StringLiteral' ||
              stmt.expression.right?.type === 'Literal') &&
            String(stmt.expression.right.value).toLowerCase() === '_blank'
          ) {
            const varName = stmt.expression.left.object.name;
            if (!blockContainsPropOrAttr(body, varName, ['rel'], ['rel'])) {
              body.splice(
                i + 1,
                0,
                j.expressionStatement(
                  j.assignmentExpression(
                    '=',
                    j.memberExpression(j.identifier(varName), j.identifier('rel')),
                    j.stringLiteral('noopener noreferrer')
                  )
                )
              );
              i += 1;
              local.domAnchorsHardened++;
              mutated = true;
            }
          }
        }
      });

      // 4. window.open(url, '_blank') -> add 'noopener,noreferrer' features argument
      root.find(j.CallExpression).forEach((callPath) => {
        const callee = callPath.node.callee;
        if (
          callee?.type === 'MemberExpression' &&
          callee.object?.name === 'window' &&
          callee.property?.name === 'open'
        ) {
          const args = callPath.node.arguments || [];
          if (
            args.length === 2 &&
            (args[1].type === 'StringLiteral' || args[1].type === 'Literal') &&
            String(args[1].value).toLowerCase() === '_blank'
          ) {
            args.push(j.stringLiteral('noopener,noreferrer'));
            local.windowOpensHardened++;
            mutated = true;
          }
        }
      });

      return { mutated, ...local };
    });

    if (changed) {
      changes.push({ relPath: file.relPath, before: file.content, after: output });
      totals.jsxLinksHardened += stats.jsxLinksHardened || 0;
      totals.jsxImagesOptimized += stats.jsxImagesOptimized || 0;
      totals.domAnchorsHardened += stats.domAnchorsHardened || 0;
      totals.domImagesUpdated += stats.domImagesUpdated || 0;
      totals.windowOpensHardened += stats.windowOpensHardened || 0;
    }
    if (changes.length >= 4) break;
  }

  if (changes.length === 0) return { commit: null, stats: totals };

  const parts = [];
  if (totals.jsxLinksHardened + totals.domAnchorsHardened > 0) {
    parts.push(
      `injected rel="noopener noreferrer" on ${totals.jsxLinksHardened + totals.domAnchorsHardened} target="_blank" anchor(s)`
    );
  }
  if (totals.jsxImagesOptimized + totals.domImagesUpdated > 0) {
    parts.push(
      `updated ${totals.jsxImagesOptimized + totals.domImagesUpdated} DOM/JSX <img> element(s) with async decoding & lazy loading`
    );
  }
  if (totals.windowOpensHardened > 0) {
    parts.push(`hardened ${totals.windowOpensHardened} window.open(_blank) call(s) with noopener,noreferrer`);
  }

  const commit = buildCommitRecord({
    repoMeta,
    category: 'best-practices',
    ruleId: 'jscodeshift-dom-updates',
    ruleTitle: 'Apply deterministic DOM element security and media updates via jscodeshift AST',
    impact: 'Medium · Cross-Origin Safety & DOM Rendering',
    analyzer: 'jscodeshift (Recast AST)',
    fixConfidence: 'auto-verified',
    title: 'Automate DOM element updates (noopener links, async img decoding) via jscodeshift',
    commitMessage: 'refactor(jscodeshift): apply deterministic DOM element updates for external links and images',
    summary: `Executed jscodeshift AST DOM codemods across ${changes.length} file(s): ${parts.join('; ')}.`,
    fileChanges: changes
  });

  return { commit, stats: totals };
}

/**
 * Runs all enabled jscodeshift AST codemods and returns `{ commits, summary }`.
 */
export function runJscodeshiftCodemods(
  files,
  repoMeta,
  selectedCategories = ['performance', 'accessibility', 'best-practices', 'seo', 'security'],
  onProgress = () => {}
) {
  const enabled = new Set(selectedCategories);
  const workingFiles = files.map((f) => ({ ...f }));
  const commits = [];
  const summary = {
    engine: 'jscodeshift',
    transformsRun: 0,
    commitsGenerated: 0,
    a11yPropertiesInjected: 0,
    domElementsUpdated: 0
  };

  if (enabled.has('accessibility')) {
    summary.transformsRun++;
    onProgress({
      phase: 'jscodeshift AST Codemod',
      category: 'Accessibility',
      headline: 'Inject accessibility properties into JSX & DOM elements via jscodeshift'
    });
    const res = runJscodeshiftA11yCodemod(workingFiles, repoMeta);
    summary.a11yPropertiesInjected =
      res.stats.buttonLabelsInjected +
      res.stats.interactiveRolesInjected +
      res.stats.imageAltsInjected +
      res.stats.domButtonsHardened;
    if (res.commit) {
      commits.push(res.commit);
      applyCommitChangesToFiles(workingFiles, res.commit);
      summary.commitsGenerated++;
    }
  }

  if (enabled.has('best-practices') || enabled.has('performance')) {
    summary.transformsRun++;
    onProgress({
      phase: 'jscodeshift AST Codemod',
      category: 'Best practices',
      headline: 'Apply automated DOM element updates via jscodeshift'
    });
    const res = runJscodeshiftDomUpdatesCodemod(workingFiles, repoMeta);
    summary.domElementsUpdated =
      res.stats.jsxLinksHardened +
      res.stats.jsxImagesOptimized +
      res.stats.domAnchorsHardened +
      res.stats.domImagesUpdated +
      res.stats.windowOpensHardened;
    if (res.commit) {
      commits.push(res.commit);
      applyCommitChangesToFiles(workingFiles, res.commit);
      summary.commitsGenerated++;
    }
  }

  return { commits, summary };
}
