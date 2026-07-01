import { tool } from 'ai';
import * as fs from 'fs/promises';
import { z } from 'zod';
import { checkPermissionRules, validatePath } from '../../modules/permissions';
import type { PermissionRule } from '../../modules/permissions/types';
import type { PathValidationOptions } from '../../modules/permissions';
import { detectImageMimeType } from './utils/image';

export interface FileToolOptions {
  cwd?: string;
  extraSensitivePaths?: readonly string[];
  permissionRules?: readonly PermissionRule[];
}

// ============================================================
// Pluggable operations interface
// ============================================================

export interface ReadFileOperations {
  /** Read file contents as a Buffer */
  readFile: (absolutePath: string) => Promise<Buffer>;
  /** Check if file is readable (throw if not) */
  access: (absolutePath: string) => Promise<void>;
  /** Detect image MIME type from file. Return null for non-image files. */
  detectImageMimeType?: (absolutePath: string) => Promise<string | null>;
}

const defaultReadFileOperations: ReadFileOperations = {
  readFile: (path) => fs.readFile(path),
  access: (path) => fs.access(path),
  detectImageMimeType,
};

// ============================================================
// Truncation
// ============================================================

const TRUNCATION_CONFIG = {
  MAX_LINES: 500,
  MAX_BYTES: 50 * 1024,
  LINE_BYTE_LIMIT: 1000,
};

interface TruncationResult {
  truncated: boolean;
  reason?: 'lines' | 'bytes' | 'single_line';
  originalLines?: number;
  shownLines?: number;
  originalBytes?: number;
  shownBytes?: number;
}

function truncateContent(
  content: string,
  startLine: number,
  totalLines: number,
  userLimit?: number,
): { text: string; truncation: TruncationResult } {
  const lines = content.split('\n');
  const truncation: TruncationResult = { truncated: false };

  // Apply user limit
  let selectedLines: string[];
  if (userLimit !== undefined) {
    selectedLines = lines.slice(0, userLimit);
    truncation.originalLines = totalLines;
    truncation.shownLines = selectedLines.length;
  } else {
    selectedLines = lines;
  }

  // Check single line byte limit
  for (let i = 0; i < selectedLines.length; i++) {
    const lineBytes = Buffer.byteLength(selectedLines[i]!, 'utf-8');
    if (lineBytes > TRUNCATION_CONFIG.LINE_BYTE_LIMIT) {
      truncation.truncated = true;
      truncation.reason = 'single_line';
      selectedLines[i] = selectedLines[i]!.slice(0, TRUNCATION_CONFIG.LINE_BYTE_LIMIT) + '... [truncated]';
    }
  }

  // Check line count limit
  if (selectedLines.length > TRUNCATION_CONFIG.MAX_LINES) {
    truncation.truncated = true;
    truncation.reason = 'lines';
    truncation.originalLines = truncation.originalLines ?? totalLines;
    truncation.shownLines = TRUNCATION_CONFIG.MAX_LINES;
    selectedLines = selectedLines.slice(0, TRUNCATION_CONFIG.MAX_LINES);
  }

  // Check byte limit
  let contentText = selectedLines.join('\n');
  const contentBytes = Buffer.byteLength(contentText, 'utf-8');
  if (contentBytes > TRUNCATION_CONFIG.MAX_BYTES) {
    truncation.truncated = true;
    truncation.reason = 'bytes';
    truncation.originalBytes = contentBytes;

    let bytes = 0;
    let lineIndex = 0;
    for (let i = 0; i < selectedLines.length; i++) {
      const lineBytes = Buffer.byteLength(selectedLines[i]!, 'utf-8') + 1;
      if (bytes + lineBytes > TRUNCATION_CONFIG.MAX_BYTES) break;
      bytes += lineBytes;
      lineIndex = i + 1;
    }
    selectedLines = selectedLines.slice(0, lineIndex);
    truncation.shownLines = selectedLines.length;
    truncation.shownBytes = bytes;
    contentText = selectedLines.join('\n');
  }

  // Add line numbers
  const numberedLines = selectedLines
    .map((line, i) => `${startLine + i + 1}: ${line}`)
    .join('\n');

  return { text: numberedLines, truncation };
}

function formatTruncationHint(
  truncation: TruncationResult,
  startLine: number,
  totalLines: number,
  filePath: string,
): string {
  if (!truncation.truncated) return '';

  const endLine = startLine + (truncation.shownLines ?? 0);
  const nextOffset = endLine + 1;

  const hints: string[] = [];

  if (truncation.reason === 'single_line') {
    hints.push('[Note: A very long line was truncated]');
  }

  if (truncation.reason === 'lines' || truncation.reason === 'bytes') {
    const shown = truncation.shownLines ?? 0;
    const total = truncation.originalLines ?? totalLines;
    hints.push(`[Showing lines ${startLine + 1}-${endLine} of ${total}]`);
    hints.push(`[Use offset=${nextOffset} to continue reading]`);
  }

  if (truncation.shownLines !== undefined && truncation.shownLines < totalLines - startLine) {
    const remaining = totalLines - endLine;
    if (remaining > 0) {
      hints.push(`[${remaining} more lines in file; use offset=${nextOffset} to continue]`);
    }
  }

  return hints.length > 0 ? '\n\n' + hints.join('\n') : '';
}

// ============================================================
// Language detection for syntax hints
// ============================================================

const LANGUAGE_MAP: Record<string, string> = {
  '.ts': 'typescript', '.tsx': 'typescript',
  '.js': 'javascript', '.jsx': 'javascript',
  '.py': 'python', '.java': 'java',
  '.go': 'go', '.rs': 'rust',
  '.cpp': 'cpp', '.c': 'c', '.h': 'c',
  '.cs': 'csharp', '.rb': 'ruby',
  '.php': 'php', '.swift': 'swift',
  '.kt': 'kotlin', '.scala': 'scala',
  '.html': 'html', '.css': 'css',
  '.scss': 'scss', '.less': 'less',
  '.json': 'json', '.yaml': 'yaml', '.yml': 'yaml',
  '.toml': 'toml', '.xml': 'xml',
  '.sql': 'sql', '.sh': 'bash',
  '.bash': 'bash', '.zsh': 'bash',
  '.md': 'markdown', '.mdx': 'markdown',
  '.dockerfile': 'dockerfile', '.docker': 'dockerfile',
  '.graphql': 'graphql', '.gql': 'graphql',
  '.svelte': 'svelte', '.vue': 'vue',
};

function getLanguageFromPath(filePath: string): string | undefined {
  const name = filePath.toLowerCase();
  const basename = name.split('/').pop() ?? '';
  const ext = '.' + (basename.split('.').pop() ?? '');

  if (LANGUAGE_MAP[ext]) return LANGUAGE_MAP[ext];
  if (basename === 'dockerfile') return 'dockerfile';
  if (basename === 'makefile') return 'makefile';
  if (basename === 'gemfile') return 'ruby';
  if (basename === 'rakefile') return 'ruby';

  return undefined;
}

// ============================================================
// Tool factory
// ============================================================

export function createReadFileTool(options: FileToolOptions & {
  operations?: ReadFileOperations;
} = {}) {
  const pathValidationOptions: PathValidationOptions = {
    workingDir: options.cwd,
    extraSensitivePaths: options.extraSensitivePaths,
  };

  const ops = options.operations ?? defaultReadFileOperations;

  return tool({
    description:
      `Read the contents of a file. Supports text files and images (jpg, png, gif, webp, bmp, svg, avif). ` +
      `Output is truncated to ${TRUNCATION_CONFIG.MAX_LINES} lines or ${TRUNCATION_CONFIG.MAX_BYTES / 1024}KB ` +
      `(whichever is hit first). Use offset/limit for large files. ` +
      `When truncated, use the suggested offset to continue reading.`,

    inputSchema: z.object({
      filePath: z.string().describe('Path to the file to read (relative to working directory)'),
      offset: z.number().optional().describe('Starting line number (1-indexed, defaults to beginning of file)'),
      limit: z.number().optional().describe('Maximum number of lines to read (no limit by default, subject to smart truncation)'),
    }),

    execute: async ({ filePath, offset, limit }, execOptions) => {
      const pathCheck = validatePath(filePath, pathValidationOptions);
      if (!pathCheck.allowed) {
        return {
          error: true,
          path: filePath,
          message: `Path security blocked: ${pathCheck.reason}`,
        };
      }

      const matchedRule = checkPermissionRules('read_file', { filePath }, options.permissionRules);
      if (matchedRule?.behavior === 'deny') {
        return {
          error: true,
          path: filePath,
          message: `Operation denied: ${matchedRule.pattern}`,
        };
      }

      const absolutePath = pathCheck.resolvedPath;
      const throwIfAborted = () => {
        if (execOptions.abortSignal?.aborted) {
          throw new Error('Operation aborted');
        }
      };

      // Check if it's an image
      const mimeType = ops.detectImageMimeType
        ? await ops.detectImageMimeType(absolutePath)
        : null;
      throwIfAborted();

      if (mimeType) {
        // Image file — return type information and file path
        return {
          path: filePath,
          encoding: 'utf-8',
          mimeType,
          type: 'image' as const,
          content: `[Image: ${filePath} (${mimeType})]`,
          // Image files are not readable as text
          totalLines: 0,
          startLine: 1,
          shownLines: 0,
          truncated: false,
          _imagePath: absolutePath,
        };
      }

      // Text file
      await ops.access(absolutePath);
      throwIfAborted();

      const stat = await fs.stat(absolutePath);
      if (!stat.isFile()) {
        throw new Error(`Path is not a file: ${filePath}`);
      }

      const buffer = await ops.readFile(absolutePath);
      throwIfAborted();

      const content = buffer.toString('utf-8');
      const allLines = content.split('\n');
      const totalLines = allLines.length;

      // Handle offset (1-indexed to 0-indexed)
      const startLine = offset ? Math.max(0, offset - 1) : 0;

      if (startLine >= totalLines) {
        throw new Error(`Offset ${offset} is beyond end of file (${totalLines} lines total)`);
      }

      // Select range
      let selectedContent: string;
      if (limit !== undefined) {
        const endLine = Math.min(startLine + limit, totalLines);
        selectedContent = allLines.slice(startLine, endLine).join('\n');
      } else {
        selectedContent = allLines.slice(startLine).join('\n');
      }

      // Smart truncation
      const { text: numberedContent, truncation } = truncateContent(
        selectedContent,
        startLine,
        totalLines,
        limit,
      );

      throwIfAborted();

      // Build result
      const language = getLanguageFromPath(filePath);

      // Wrap in code fence if language detected (helps AI parse the content)
      const contentOutput = language
        ? `\`\`\`${language}\n${numberedContent}\n\`\`\``
        : numberedContent;

      const result: Record<string, unknown> = {
        path: filePath,
        content: contentOutput + formatTruncationHint(truncation, startLine, totalLines, filePath),
        totalLines,
        startLine: startLine + 1,
        shownLines: truncation.shownLines ?? Math.min(totalLines - startLine, limit ?? totalLines),
        encoding: 'utf-8',
        truncated: truncation.truncated,
        type: 'text',
      };

      if (language) {
        result.language = language;
      }

      if (truncation.truncated) {
        result.truncationInfo = {
          reason: truncation.reason,
          ...(truncation.originalLines !== undefined && { originalLines: truncation.originalLines }),
          ...(truncation.shownLines !== undefined && { shownLines: truncation.shownLines }),
          ...(truncation.originalBytes !== undefined && { originalBytes: truncation.originalBytes }),
          ...(truncation.shownBytes !== undefined && { shownBytes: truncation.shownBytes }),
        };
      }

      const endLine = startLine + (truncation.shownLines ?? allLines.length - startLine);
      if (endLine < totalLines) {
        result.nextOffset = endLine + 1;
        result.hasMore = true;
      }

      return result;
    },
  });
}

