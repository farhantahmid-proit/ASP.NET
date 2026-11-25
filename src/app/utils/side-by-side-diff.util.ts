/**
 * Deterministic Unified Git Diff -> Side-by-Side Visual Diff Parser
 *
 * Parses standard RFC-2822 / `git diff` unified patches into structured file blocks
 * and aligned left/right rows with exact line numbers and intra-line token highlights.
 */

export interface DiffInlineSegment {
  text: string;
  changed: boolean;
}

export interface SideBySideCell {
  lineNumber: number | null;
  type: 'context' | 'del' | 'add' | 'empty';
  content: string;
  segments: DiffInlineSegment[];
}

export interface SideBySideRow {
  kind: 'hunk' | 'pair';
  hunkHeader?: string;
  left?: SideBySideCell;
  right?: SideBySideCell;
}

export interface SideBySideFileDiff {
  id: string;
  filePath: string;
  oldPath: string;
  newPath: string;
  additions: number;
  deletions: number;
  rows: SideBySideRow[];
}

/**
 * Computes character-level common prefix and suffix between a removed line and
 * an added line so modified side-by-side pairs highlight the exact changed slice.
 */
export function computeInlineDiffSegments(
  oldText: string,
  newText: string
): { left: DiffInlineSegment[]; right: DiffInlineSegment[] } {
  if (oldText === newText) {
    return {
      left: [{ text: oldText, changed: false }],
      right: [{ text: newText, changed: false }]
    };
  }

  let prefixLen = 0;
  const minLen = Math.min(oldText.length, newText.length);
  while (prefixLen < minLen && oldText.charCodeAt(prefixLen) === newText.charCodeAt(prefixLen)) {
    prefixLen++;
  }

  let suffixLen = 0;
  while (
    suffixLen < minLen - prefixLen &&
    oldText.charCodeAt(oldText.length - 1 - suffixLen) ===
      newText.charCodeAt(newText.length - 1 - suffixLen)
  ) {
    suffixLen++;
  }

  // If the entire line changed with no meaningful shared anchors, keep subtle full-line highlight
  if (prefixLen === 0 && suffixLen === 0) {
    return {
      left: oldText ? [{ text: oldText, changed: false }] : [],
      right: newText ? [{ text: newText, changed: false }] : []
    };
  }

  const buildSegments = (text: string): DiffInlineSegment[] => {
    const segs: DiffInlineSegment[] = [];
    const pre = text.slice(0, prefixLen);
    const mid = text.slice(prefixLen, text.length - suffixLen);
    const suf = suffixLen > 0 ? text.slice(text.length - suffixLen) : '';
    if (pre) segs.push({ text: pre, changed: false });
    if (mid) segs.push({ text: mid, changed: true });
    if (suf) segs.push({ text: suf, changed: false });
    return segs;
  };

  return {
    left: buildSegments(oldText),
    right: buildSegments(newText)
  };
}

function makeCell(
  type: SideBySideCell['type'],
  lineNumber: number | null,
  content: string,
  segments?: DiffInlineSegment[]
): SideBySideCell {
  return {
    type,
    lineNumber,
    content,
    segments: segments ?? (content ? [{ text: content, changed: false }] : [])
  };
}

function cleanDiffPath(raw: string): string {
  return String(raw || '')
    .trim()
    .replace(/^[ab]\//, '')
    .replace(/^"|"$/g, '');
}

/**
 * Parses a unified git diff string into structured side-by-side file diffs.
 */
export function parseUnifiedDiffToSideBySide(rawDiff: string | null | undefined): SideBySideFileDiff[] {
  const text = String(rawDiff || '').replace(/\r\n/g, '\n').trim();
  if (!text) return [];

  const lines = text.split('\n');
  const files: SideBySideFileDiff[] = [];

  let currentFile: SideBySideFileDiff | null = null;
  let oldLine = 1;
  let newLine = 1;
  let pendingDels: { lineNumber: number; text: string }[] = [];
  let pendingAdds: { lineNumber: number; text: string }[] = [];

  const ensureFile = (fallbackName = 'patch.diff'): SideBySideFileDiff => {
    if (!currentFile) {
      currentFile = {
        id: `file-${files.length}`,
        filePath: fallbackName,
        oldPath: fallbackName,
        newPath: fallbackName,
        additions: 0,
        deletions: 0,
        rows: []
      };
      files.push(currentFile);
    }
    return currentFile;
  };

  const flushPending = () => {
    if (pendingDels.length === 0 && pendingAdds.length === 0) return;
    const file = ensureFile();
    const maxLen = Math.max(pendingDels.length, pendingAdds.length);

    for (let i = 0; i < maxLen; i++) {
      const delItem = pendingDels[i];
      const addItem = pendingAdds[i];

      if (delItem && addItem) {
        const inline = computeInlineDiffSegments(delItem.text, addItem.text);
        file.rows.push({
          kind: 'pair',
          left: makeCell('del', delItem.lineNumber, delItem.text, inline.left),
          right: makeCell('add', addItem.lineNumber, addItem.text, inline.right)
        });
      } else if (delItem) {
        file.rows.push({
          kind: 'pair',
          left: makeCell('del', delItem.lineNumber, delItem.text),
          right: makeCell('empty', null, '')
        });
      } else if (addItem) {
        file.rows.push({
          kind: 'pair',
          left: makeCell('empty', null, ''),
          right: makeCell('add', addItem.lineNumber, addItem.text)
        });
      }
    }

    pendingDels = [];
    pendingAdds = [];
  };

  for (const line of lines) {
    if (line.startsWith('diff --git ')) {
      flushPending();
      const match = line.match(/^diff --git a\/(.+?) b\/(.+)$/);
      const oldPath = match ? cleanDiffPath(match[1]) : 'file';
      const newPath = match ? cleanDiffPath(match[2]) : oldPath;
      currentFile = {
        id: `file-${files.length}`,
        filePath: newPath || oldPath,
        oldPath,
        newPath,
        additions: 0,
        deletions: 0,
        rows: []
      };
      files.push(currentFile);
      oldLine = 1;
      newLine = 1;
      continue;
    }

    if (
      line.startsWith('index ') ||
      line.startsWith('new file mode ') ||
      line.startsWith('deleted file mode ') ||
      line.startsWith('old mode ') ||
      line.startsWith('new mode ') ||
      line.startsWith('===')
    ) {
      continue;
    }

    if (line.startsWith('--- ')) {
      const rawOld = cleanDiffPath(line.slice(4));
      if (!currentFile && rawOld && rawOld !== '/dev/null') {
        ensureFile(rawOld);
      } else if (currentFile && rawOld && rawOld !== '/dev/null') {
        currentFile.oldPath = rawOld;
      }
      continue;
    }

    if (line.startsWith('+++ ')) {
      const rawNew = cleanDiffPath(line.slice(4));
      if (!currentFile && rawNew && rawNew !== '/dev/null') {
        ensureFile(rawNew);
      } else if (currentFile && rawNew && rawNew !== '/dev/null') {
        currentFile.newPath = rawNew;
        currentFile.filePath = rawNew;
      }
      continue;
    }

    if (line.startsWith('@@')) {
      flushPending();
      const file = ensureFile();
      const hunkMatch = line.match(/^@@\s+-(\d+)(?:,\d+)?\s+\+(\d+)(?:,\d+)?\s+@@(.*)$/);
      if (hunkMatch) {
        oldLine = Number(hunkMatch[1]) || 1;
        newLine = Number(hunkMatch[2]) || 1;
      }
      file.rows.push({
        kind: 'hunk',
        hunkHeader: line
      });
      continue;
    }

    if (line.startsWith('\\ No newline at end of file')) {
      continue;
    }

    if (line.startsWith('-')) {
      const file = ensureFile();
      file.deletions++;
      pendingDels.push({ lineNumber: oldLine++, text: line.slice(1) });
      continue;
    }

    if (line.startsWith('+')) {
      const file = ensureFile();
      file.additions++;
      pendingAdds.push({ lineNumber: newLine++, text: line.slice(1) });
      continue;
    }

    // Context line (strip leading space if standard unified diff prefix)
    flushPending();
    const file = ensureFile();
    const ctxText = line.startsWith(' ') ? line.slice(1) : line;
    file.rows.push({
      kind: 'pair',
      left: makeCell('context', oldLine++, ctxText),
      right: makeCell('context', newLine++, ctxText)
    });
  }

  flushPending();
  return files;
}
