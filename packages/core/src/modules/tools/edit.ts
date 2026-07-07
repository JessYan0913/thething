import { tool } from 'ai';
import * as fs from 'fs/promises';
import { z } from 'zod';
import { checkPermissionRules, validateWritePath } from '../../modules/permissions';
import type { PathValidationOptions } from '../../modules/permissions';
import type { FileToolOptions } from './read';
import { stripBom, detectLineEnding, normalizeToLF, restoreLineEndings } from './utils/text';
import { withFileMutationQueue } from './utils/file-mutation-queue';
import { generateUnifiedDiff, summarizeChanges } from './utils/diff';

// ============================================================
// Schema
// ============================================================

const singleEditSchema = z.object({
  oldText: z.string().describe('Exact text to find and replace (must exactly match the file content, case-sensitive)'),
  newText: z.string().describe('Replacement text'),
});

const editSchema = z.object({
  filePath: z.string().describe('Path to the file to edit (relative to working directory)'),
  edits: z.array(singleEditSchema).min(1).describe(
    'One or more targeted replacements. Each edit is matched against the original file, not incrementally. ' +
    'Do not include overlapping edits. If two changes touch nearby lines, merge them into one edit instead.',
  ),
});

// ============================================================
// Operations interface (pluggable I/O)
// ============================================================

export interface EditOperations {
  readFile: (absolutePath: string) => Promise<Buffer>;
  writeFile: (absolutePath: string, content: string) => Promise<void>;
  access: (absolutePath: string) => Promise<void>;
}

const defaultEditOperations: EditOperations = {
  readFile: (path: string) => fs.readFile(path),
  writeFile: (path: string, content: string) => fs.writeFile(path, content, 'utf-8'),
  access: async (path: string) => {
    // R_OK (4) | W_OK (2) = 6
    await fs.access(path, 6);
  },
};

export interface EditFileToolOptions extends FileToolOptions {
  operations?: EditOperations;
}

// ============================================================
// Edit matching and application
// ============================================================

interface EditOperation {
  oldText: string;
  newText: string;
}

interface EditPosition {
  start: number;
  end: number;
}

/**
 * Validate edits against normalized content.
 * Checks that each oldText exists uniquely and no edits overlap.
 */
function validateEdits(
  content: string,
  edits: EditOperation[],
  filePath: string,
): Array<{ edit: EditOperation; position: EditPosition }> {
  const positions: Array<{ edit: EditOperation; position: EditPosition }> = [];

  for (let i = 0; i < edits.length; i++) {
    const edit = edits[i]!;

    // Find ALL occurrences
    const occurrences: number[] = [];
    let searchStart = 0;
    while (true) {
      const idx = content.indexOf(edit.oldText, searchStart);
      if (idx === -1) break;
      occurrences.push(idx);
      searchStart = idx + edit.oldText.length;
    }

    if (occurrences.length === 0) {
      throw new Error(
        `Edit ${i + 1}: oldText not found in "${filePath}".\n` +
        `The text to replace must match the file content exactly.\n` +
        `Check for spacing, line endings, or encoding differences.` +
        `\nMissing text (first 80 chars): "${truncate(edit.oldText, 80)}"`,
      );
    }

    if (occurrences.length > 1) {
      throw new Error(
        `Edit ${i + 1}: oldText appears ${occurrences.length} times in "${filePath}".\n` +
        `Each edit must match uniquely. Provide more context in oldText to target the specific location.\n` +
        `Text: "${truncate(edit.oldText, 80)}"`,
      );
    }

    positions.push({
      edit,
      position: { start: occurrences[0]!, end: occurrences[0]! + edit.oldText.length },
    });
  }

  // Check for overlapping edits (based on original positions)
  for (let i = 0; i < positions.length; i++) {
    for (let j = i + 1; j < positions.length; j++) {
      const a = positions[i]!.position;
      const b = positions[j]!.position;
      if (a.start < b.end && b.start < a.end) {
        throw new Error(
          `Edits ${i + 1} and ${j + 1} are overlapping in "${filePath}".\n` +
          `Merge nearby changes into one edit instead.\n` +
          `Edit ${i + 1}: "${truncate(positions[i]!.edit.oldText, 40)}"\n` +
          `Edit ${j + 1}: "${truncate(positions[j]!.edit.oldText, 40)}"`,
        );
      }
    }
  }

  return positions;
}

/**
 * Apply edits to produce new content.
 * Edits are assumed to be validated (unique, non-overlapping).
 * Modifications are applied sorted by position to preserve offsets.
 */
function applyEdits(
  content: string,
  positions: Array<{ edit: EditOperation; position: EditPosition }>,
): string {
  // Sort by position descending so earlier positions aren't shifted
  const sorted = [...positions].sort((a, b) => b.position.start - a.position.start);

  let result = content;
  for (const { edit, position } of sorted) {
    result = result.slice(0, position.start) + edit.newText + result.slice(position.end);
  }

  return result;
}

/**
 * Get the line number (1-indexed) for a character position in content.
 */
function getLineFromPosition(content: string, position: number): number {
  const before = content.slice(0, Math.min(position, content.length));
  return before.split('\n').length;
}

function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength) + '...';
}

// ============================================================
// Tool factory
// ============================================================

export function createEditFileTool(options: EditFileToolOptions = {}) {
  const pathValidationOptions: PathValidationOptions = {
    workingDir: options.cwd,
    extraSensitivePaths: options.extraSensitivePaths,
  };

  const ops = options.operations ?? defaultEditOperations;

  return tool({
    description:
      'Edit a file using exact text replacement. ' +
      'Supports multiple simultaneous edits in one call (all edits are based on the original file content, not incremental). ' +
      'Each edits[].oldText must match a unique, non-overlapping region of the file. ' +
      'Returns a unified diff of the changes made.',

    inputSchema: editSchema,

    execute: async ({ filePath, edits }, execOptions) => {
      // Path safety
      const pathCheck = validateWritePath(filePath, pathValidationOptions);
      if (!pathCheck.allowed) {
        return {
          error: true,
          path: filePath,
          message: `Path security blocked: ${pathCheck.reason}`,
        };
      }

      const matchedRule = checkPermissionRules('edit_file', { filePath }, options.permissionRules);
      if (matchedRule?.behavior === 'deny') {
        return {
          error: true,
          path: filePath,
          message: `Operation denied: ${matchedRule.pattern}`,
        };
      }

      const absolutePath = pathCheck.resolvedPath;

      return withFileMutationQueue(absolutePath, async () => {
        // 1. Read and normalize
        const buffer = await ops.readFile(absolutePath);
        const rawContent = buffer.toString('utf-8');
        const { bom, text: strippedContent } = stripBom(rawContent);
        const originalEnding = detectLineEnding(strippedContent);
        const normalizedContent = normalizeToLF(strippedContent);
        const throwIfAborted = () => {
          if (execOptions.abortSignal?.aborted) {
            throw new Error('Operation aborted');
          }
        };

        throwIfAborted();

        // 2. Validate edits against normalized content
        const validated = validateEdits(normalizedContent, edits, filePath);

        throwIfAborted();

        // 3. Apply edits
        const newNormalized = applyEdits(normalizedContent, validated);

        // 4. Safety check
        if (newNormalized === normalizedContent) {
          throw new Error('All edits completed but file content did not change. This is likely a matching issue.');
        }

        // 5. Restore line endings + BOM
        const finalContent = bom + restoreLineEndings(newNormalized, originalEnding);

        // 6. Write file
        await ops.writeFile(absolutePath, finalContent);

        throwIfAborted();

        // 7. Generate diff
        const diffResult = generateUnifiedDiff(
          filePath,
          filePath,
          bom + normalizeToLF(strippedContent),
          bom + newNormalized,
        );

        // Simplified return: only essential fields for rendering
        return {
          path: filePath,
          diff: diffResult.diff,
          summary: summarizeChanges(diffResult),
        };
      });
    },
  });
}

// Re-export for backward compatibility
export { editSchema };
