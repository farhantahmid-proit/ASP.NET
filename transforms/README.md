# Fresnel `jscodeshift` Codemod Transforms

Deterministic, zero-AI AST transformation scripts executed with [`jscodeshift`](https://github.com/facebook/jscodeshift).

## Available Transforms

### `inject-icon-button-aria-label.js`
Automatically detects icon-only `<button>` elements missing an accessible name (`aria-label`, `aria-labelledby`, or `title`) and injects:
- `aria-label="..."` inferred deterministically from `onClick` handlers, child `*Icon` component names, `data-testid`/`id`/`className`, or a fallback label.
- `type="button"` when missing on native `<button>` elements.

#### CLI Usage

```bash
# Dry-run with diff output on TSX/JSX files
npx jscodeshift -d -p -t transforms/inject-icon-button-aria-label.js src/ --extensions=tsx,jsx --parser=tsx

# Apply in-place
npx jscodeshift -t transforms/inject-icon-button-aria-label.js src/ --extensions=tsx,jsx --parser=tsx
```
