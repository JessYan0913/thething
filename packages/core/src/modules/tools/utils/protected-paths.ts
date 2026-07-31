import * as path from 'path';

export interface ProtectedPathMatch {
  protectedPath: string;
}

function normalizeAbsolutePath(value: string): string {
  return path.resolve(value);
}

export function findProtectedPathMatch(
  candidatePath: string,
  protectedWritePaths: readonly string[] | undefined,
): ProtectedPathMatch | undefined {
  if (!protectedWritePaths?.length) return undefined;

  const candidate = normalizeAbsolutePath(candidatePath);
  for (const protectedPath of protectedWritePaths) {
    const normalizedProtectedPath = normalizeAbsolutePath(protectedPath);
    const relative = path.relative(normalizedProtectedPath, candidate);
    if (relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))) {
      return { protectedPath: normalizedProtectedPath };
    }
  }

  return undefined;
}

function commandPathVariants(protectedPath: string): string[] {
  const normalized = normalizeAbsolutePath(protectedPath);
  const variants = new Set([normalized, protectedPath]);
  const home = process.env.HOME;
  if (home && (normalized === home || normalized.startsWith(`${home}${path.sep}`))) {
    variants.add(`~${normalized.slice(home.length)}`);
    variants.add(`$HOME${normalized.slice(home.length)}`);
    variants.add(`\${HOME}${normalized.slice(home.length)}`);
  }
  return [...variants].filter(Boolean);
}

function referencesProtectedPath(command: string, protectedPath: string): boolean {
  return commandPathVariants(protectedPath).some((variant) => command.includes(variant));
}

const READ_ONLY_SHELL_COMMANDS = new Set([
  'cat', 'head', 'tail', 'wc', 'less', 'more', 'file', 'stat', 'du',
  'grep', 'rg', 'ag', 'ack', 'find', 'ls', 'pwd', 'realpath', 'readlink',
]);

function isReadOnlyShellSegment(segment: string): boolean {
  const trimmed = segment.trim();
  if (!trimmed) return true;
  if (/[><]/.test(trimmed) || /\b(-delete|-exec|-execdir)\b/.test(trimmed)) return false;

  const withoutEnv = trimmed.replace(/^(?:[A-Za-z_][A-Za-z0-9_]*=[^\s]+\s+)*/, '');
  const executable = withoutEnv.match(/^(?:command\s+)?(?:\/[^\s]+\/)?([^\s]+)/)?.[1];
  return executable ? READ_ONLY_SHELL_COMMANDS.has(executable) : false;
}

function isReadOnlyProtectedPathCommand(command: string): boolean {
  return command
    .split(/(?:&&|\|\||[;|\n])/)
    .every(isReadOnlyShellSegment);
}

export function findProtectedShellWriteMatch(
  command: string,
  protectedWritePaths: readonly string[] | undefined,
): ProtectedPathMatch | undefined {
  if (!protectedWritePaths?.length || isReadOnlyProtectedPathCommand(command)) return undefined;

  for (const protectedPath of protectedWritePaths) {
    if (referencesProtectedPath(command, protectedPath)) {
      return { protectedPath: normalizeAbsolutePath(protectedPath) };
    }
  }

  return undefined;
}

export function protectedPathWriteMessage(protectedPath: string): string {
  return (
    `Managed Wiki path cannot be modified by general-purpose tools: ${protectedPath}. ` +
    'Use save_wiki, ingest_wiki_source, or restore_wiki_revision so revisions, index, source relations, and log stay consistent.'
  );
}
