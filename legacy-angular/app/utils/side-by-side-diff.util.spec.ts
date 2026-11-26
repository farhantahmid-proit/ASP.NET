import {
  computeInlineDiffSegments,
  parseUnifiedDiffToSideBySide
} from './side-by-side-diff.util';

describe('side-by-side-diff.util', () => {
  const sampleSingleFileDiff = [
    'diff --git a/src/styles.scss b/src/styles.scss',
    'index 1111111..2222222 100644',
    '--- a/src/styles.scss',
    '+++ b/src/styles.scss',
    '@@ -10,5 +10,6 @@',
    ' .hero-caption {',
    '-  padding: 12px 12px 12px 12px;',
    '+  padding: 12px;',
    '+  color: #1e293b;',
    '   font-size: 14px;',
    ' }'
  ].join('\n');

  const sampleMultiFileDiff = [
    'diff --git a/src/index.html b/src/index.html',
    'index aaa1111..bbb2222 100644',
    '--- a/src/index.html',
    '+++ b/src/index.html',
    '@@ -3,3 +3,4 @@',
    ' <head>',
    '-  <title>App</title>',
    '+  <title>Fresnel — Web Application</title>',
    '+  <meta name="description" content="Fast web app">',
    ' </head>',
    '',
    'diff --git a/src/app/core/dom.ts b/src/app/core/dom.ts',
    'index ccc1111..ddd2222 100644',
    '--- a/src/app/core/dom.ts',
    '+++ b/src/app/core/dom.ts',
    '@@ -1,3 +1,3 @@',
    ' export function boot() {',
    '-  var ready = true;',
    '+  const ready = true;',
    ' }'
  ].join('\n');

  it('returns an empty list for empty or null diff inputs', () => {
    expect(parseUnifiedDiffToSideBySide('')).toEqual([]);
    expect(parseUnifiedDiffToSideBySide('   \n  ')).toEqual([]);
    expect(parseUnifiedDiffToSideBySide(null)).toEqual([]);
    expect(parseUnifiedDiffToSideBySide(undefined)).toEqual([]);
  });

  it('parses file headers, line counters, hunks, and aligned side-by-side pairs accurately', () => {
    const files = parseUnifiedDiffToSideBySide(sampleSingleFileDiff);
    expect(files.length).toBe(1);

    const file = files[0];
    expect(file.filePath).toBe('src/styles.scss');
    expect(file.additions).toBe(2);
    expect(file.deletions).toBe(1);

    // Row 0: hunk header
    expect(file.rows[0].kind).toBe('hunk');
    expect(file.rows[0].hunkHeader).toContain('@@ -10,5 +10,6 @@');

    // Row 1: context line 10 on both sides
    expect(file.rows[1].kind).toBe('pair');
    expect(file.rows[1].left?.type).toBe('context');
    expect(file.rows[1].left?.lineNumber).toBe(10);
    expect(file.rows[1].right?.lineNumber).toBe(10);

    // Row 2: modified pair (line 11 del paired with line 11 add)
    expect(file.rows[2].left?.type).toBe('del');
    expect(file.rows[2].left?.lineNumber).toBe(11);
    expect(file.rows[2].right?.type).toBe('add');
    expect(file.rows[2].right?.lineNumber).toBe(11);

    // Row 3: unbalanced addition -> empty spacer cell on left, line 12 add on right
    expect(file.rows[3].left?.type).toBe('empty');
    expect(file.rows[3].left?.lineNumber).toBeNull();
    expect(file.rows[3].right?.type).toBe('add');
    expect(file.rows[3].right?.lineNumber).toBe(12);

    // Row 4: subsequent context line numbers stay synchronized (12 left, 13 right)
    expect(file.rows[4].left?.lineNumber).toBe(12);
    expect(file.rows[4].right?.lineNumber).toBe(13);
  });

  it('splits multi-file unified diffs into independent SideBySideFileDiff sections', () => {
    const files = parseUnifiedDiffToSideBySide(sampleMultiFileDiff);
    expect(files.length).toBe(2);
    expect(files[0].filePath).toBe('src/index.html');
    expect(files[0].additions).toBe(2);
    expect(files[0].deletions).toBe(1);
    expect(files[1].filePath).toBe('src/app/core/dom.ts');
    expect(files[1].additions).toBe(1);
    expect(files[1].deletions).toBe(1);
  });

  it('computes intra-line changed segments for modified pairs deterministically', () => {
    const segs = computeInlineDiffSegments(
      '  var ready = true;',
      '  const ready = true;'
    );
    expect(segs.left).toEqual([
      { text: '  ', changed: false },
      { text: 'var', changed: true },
      { text: ' ready = true;', changed: false }
    ]);
    expect(segs.right).toEqual([
      { text: '  ', changed: false },
      { text: 'const', changed: true },
      { text: ' ready = true;', changed: false }
    ]);
  });

  it('produces identical deterministic structures across repeated parses', () => {
    const runA = parseUnifiedDiffToSideBySide(sampleMultiFileDiff);
    const runB = parseUnifiedDiffToSideBySide(sampleMultiFileDiff);
    expect(runA).toEqual(runB);
  });
});
