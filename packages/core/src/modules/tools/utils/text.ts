/**
 * Text processing utilities for file operations.
 *
 * Handles BOM stripping, line ending detection and normalization.
 */

/** Strip UTF-8 BOM from content, returning both the BOM and clean text */
export function stripBom(content: string): { bom: string; text: string } {
  if (content.length > 0 && content.charCodeAt(0) === 0xFEFF) {
    return { bom: '﻿', text: content.slice(1) };
  }
  return { bom: '', text: content };
}

type LineEnding = '\n' | '\r\n';

/** Detect the dominant line ending in content */
export function detectLineEnding(content: string): LineEnding {
  const crlfCount = (content.match(/\r\n/g) || []).length;
  const lfOnlyCount = (content.match(/(?<!\r)\n/g) || []).length;
  if (crlfCount > lfOnlyCount) return '\r\n';
  return '\n';
}

/** Normalize all line endings to LF */
export function normalizeToLF(content: string): string {
  return content.replace(/\r\n/g, '\n');
}

/** Restore original line endings after normalization */
export function restoreLineEndings(content: string, ending: LineEnding): string {
  if (ending === '\r\n') {
    return content.replace(/\n/g, '\r\n');
  }
  return content;
}

/** Convert Windows-style path separators to POSIX */
export function toPosixPath(filePath: string): string {
  return filePath.replace(/\\/g, '/');
}
