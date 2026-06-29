/**
 * Line-based diff utilities for generating unified-diff output.
 *
 * Uses a simple LCS (Longest Common Subsequence) algorithm to produce
 * human-readable unified diffs. Lightweight — no external dependencies.
 */

export interface UnifiedDiff {
  /** Human-readable unified diff string */
  diff: string;
  /** 1-based line number of the first changed line in the new file */
  firstChangedLine: number | undefined;
  /** Number of hunks in the diff */
  hunkCount: number;
}

interface DiffLine {
  type: 'equal' | 'insert' | 'delete';
  text: string;
  lineNumberOld: number;
  lineNumberNew: number;
}

/**
 * Compute the LCS table for two arrays of lines.
 * Uses dynamic programming O(n*m) time, O(min(n,m)) space for the length table.
 */
function computeLCSTable(a: string[], b: string[]): number[][] {
  const n = a.length;
  const m = b.length;
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));

  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      dp[i][j] = a[i - 1] === b[j - 1]
        ? dp[i - 1][j - 1] + 1
        : Math.max(dp[i - 1][j], dp[i][j - 1]);
    }
  }

  return dp;
}

/**
 * Backtrack through the LCS table to produce a diff.
 */
function backtrackDiff(a: string[], b: string[], dp: number[][]): DiffLine[] {
  const result: DiffLine[] = [];
  let i = a.length;
  let j = b.length;
  const temp: DiffLine[] = [];

  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && a[i - 1] === b[j - 1]) {
      temp.push({
        type: 'equal',
        text: a[i - 1],
        lineNumberOld: i,
        lineNumberNew: j,
      });
      i--;
      j--;
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      temp.push({
        type: 'insert',
        text: b[j - 1],
        lineNumberOld: i + 1,
        lineNumberNew: j,
      });
      j--;
    } else {
      temp.push({
        type: 'delete',
        text: a[i - 1],
        lineNumberOld: i,
        lineNumberNew: j + 1,
      });
      i--;
    }
  }

  // Reverse to get chronological order
  for (let k = temp.length - 1; k >= 0; k--) {
    result.push(temp[k]);
  }

  return result;
}

/**
 * Format diff lines into a unified diff string.
 * Groups hunks with context lines (3 lines context).
 */
function formatUnifiedDiff(
  diffLines: DiffLine[],
  oldPath: string,
  newPath: string,
): UnifiedDiff {
  const CONTEXT_LINES = 3;
  const output: string[] = [];
  let firstChangedLine: number | undefined;

  output.push(`--- ${oldPath}`);
  output.push(`+++ ${newPath}`);

  let hunkStartOld = 0;
  let hunkStartNew = 0;
  let hunkLines: string[] = [];
  let contextBefore: string[] = [];
  let inHunk = false;
  let hunkCount = 0;

  function flushHunk(): void {
    if (hunkLines.length === 0 && contextBefore.length === 0) return;

    // Include trailing context
    const allLines = [...contextBefore, ...hunkLines];

    const oldStart = hunkStartOld;
    const newStart = hunkStartNew;
    const oldLines = allLines.filter(l => l[0] !== '+').length;
    const newLines = allLines.filter(l => l[0] !== '-').length;

    output.push(`@@ -${oldStart},${oldLines} +${newStart},${newLines} @@`);
    output.push(...allLines);
    hunkCount++;
  }

  for (let i = 0; i < diffLines.length; i++) {
    const line = diffLines[i];

    if (line.type === 'equal') {
      if (inHunk || contextBefore.length > 0) {
        contextBefore.push(` ${line.text}`);
        if (contextBefore.length > CONTEXT_LINES) {
          contextBefore.shift();
          if (inHunk) {
            // Shift the hunk start forward
            hunkStartOld++;
            hunkStartNew++;
          }
        }
      }
      continue;
    }

    // We have a change
    if (!inHunk) {
      inHunk = true;
      hunkLines = [];
      // Include context before the change
      hunkStartOld = Math.max(1, (line.type === 'delete' ? line.lineNumberOld : line.lineNumberOld) - CONTEXT_LINES);
      hunkStartNew = Math.max(1, (line.type === 'insert' ? line.lineNumberNew : line.lineNumberNew) - CONTEXT_LINES);

      // Calculate how many context lines we have before
      const availableContext = contextBefore.length;
      const contextToInclude = Math.min(availableContext, CONTEXT_LINES);
      if (contextToInclude > 0) {
        const offset = availableContext - contextToInclude;
        hunkLines.push(...contextBefore.slice(offset));
      }
    }

    if (line.type === 'delete') {
      hunkLines.push(`-${line.text}`);
    } else if (line.type === 'insert') {
      hunkLines.push(`+${line.text}`);
    } else {
      hunkLines.push(` ${line.text}`);
    }

    if (firstChangedLine === undefined && (line.type === 'delete' || line.type === 'insert')) {
      if (line.type === 'insert' && line.lineNumberNew > 0) {
        // For an insert, firstChangedLine is the new file line number
        // Look backwards to find the preceding equal line's new line number
        firstChangedLine = line.lineNumberNew;
      } else if (line.type === 'delete' && line.lineNumberNew > 0) {
        firstChangedLine = line.lineNumberNew;
      } else {
        firstChangedLine = 1;
      }
    }
  }

  // Flush final hunk
  flushHunk();

  return {
    diff: output.join('\n'),
    firstChangedLine,
    hunkCount,
  };
}

/**
 * Generate a unified diff between two strings (line-by-line).
 *
 * @param oldPath - path label for the "before" side
 * @param newPath - path label for the "after" side
 * @param oldContent - original file content
 * @param newContent - new file content
 */
export function generateUnifiedDiff(
  oldPath: string,
  newPath: string,
  oldContent: string,
  newContent: string,
): UnifiedDiff {
  const oldLines = oldContent.split('\n');
  const newLines = newContent.split('\n');

  // Trivial cases
  if (oldContent === newContent) {
    return { diff: '', firstChangedLine: undefined, hunkCount: 0 };
  }

  const dp = computeLCSTable(oldLines, newLines);
  const diffLines = backtrackDiff(oldLines, newLines, dp);
  return formatUnifiedDiff(diffLines, oldPath, newPath);
}

/**
 * Summarize the changes in a human-readable string.
 * Returns a compact description of what changed.
 */
export function summarizeChanges(diff: UnifiedDiff): string {
  if (diff.hunkCount === 0) return 'No changes';
  return `${diff.hunkCount} hunk(s) affected, first change at line ${diff.firstChangedLine ?? '?'}`;
}
