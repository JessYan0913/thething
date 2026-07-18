import { tool } from 'ai';
import { spawn, type ChildProcess } from 'child_process';
import { z } from 'zod';
import { checkPermissionRules } from '../../modules/permissions';
import { consumeReviewerDenial } from '../agent-control/reviewer-feedback';
import type { PermissionRule } from '../../modules/permissions/types';
import fs from 'fs';
import path from 'path';
import os from 'os';

// ============================================================
// Safety constants
// ============================================================

const BASH_MAX_BUFFER = 200_000;

const DANGEROUS_PATTERNS = [
  /^\s*rm\s+(-rf?|--recursive)\s+\/?/i,
  /^\s*rmdir\s+\/?/i,
  /^\s*>\s*\/(dev\/|etc\/|usr\/)/i,
  /^\s*dd\s+/i,
  /^\s*mkfs/i,
  /^\s*fdisk/i,
  /^\s*wget\s/i,
  /^\s*nc\s/i,
  /^\s*ncat\s/i,
  /^\s*nmap\s/i,
  /^\s*chmod\s+[0-7]*777/i,
  /^\s*chown\s/i,
  /^\s*su(\s|$)/i,
  /^\s*sudo\s/i,
  /^\s*user(add|del|mod)\s/i,
  /\|\s*(nc|ncat|bash\s*-i|python.*-c.*socket|perl.*Socket)/i,
];

const SAFE_COMMANDS = [
  'git status', 'git log', 'git diff', 'git branch', 'git show',
  'git add', 'git commit', 'git stash', 'git checkout', 'git switch', 'git restore', 'git tag',
  'ls', 'ls -la', 'ls -l', 'dir', 'pwd', 'cat', 'head', 'tail', 'wc', 'echo', 'which',
  'file', 'stat', 'du', 'df', 'env', 'printenv', 'type',
  'node --version', 'npm --version', 'pnpm --version', 'yarn --version',
  'python --version', 'python3 --version', 'java --version', 'go version',
  'cargo --version', 'rustc --version',
  'mkdir', 'touch', 'cp', 'mv', 'ln',
  'npm run build', 'npm run lint', 'npm run test', 'npm test', 'npm install', 'npm ci',
  'pnpm run', 'pnpm build', 'pnpm lint', 'pnpm test', 'pnpm install', 'pnpm add',
  'yarn run', 'yarn build', 'yarn lint', 'yarn test', 'yarn install', 'yarn add',
  'npx tsc --noEmit', 'tsc --noEmit', 'npx tsc', 'tsc', 'eslint',
  'prettier --check', 'prettier --write', 'tsx',
  'python -m pytest', 'python3 -m pytest', 'pip install', 'pip3 install',
  'cargo build', 'cargo check', 'cargo test', 'cargo clippy', 'cargo fmt',
  'go build', 'go test', 'go vet', 'go fmt',
];

const DEFAULT_TIMEOUT_MS = 30_000;

// ============================================================
// Pluggable operations interface
// ============================================================

export interface BashSpawnContext {
  command: string;
  cwd: string;
  timeout: number;
  shell: string;
  env?: Record<string, string>;
}

export type BashSpawnHook = (command: string, context: BashSpawnContext) => BashSpawnContext | Promise<BashSpawnContext>;

export interface BashOperations {
  exec: (
    command: string,
    options: {
      cwd: string;
      timeout: number;
      signal?: AbortSignal;
      onStdout?: (chunk: string) => void;
      onStderr?: (chunk: string) => void;
    },
  ) => Promise<{ stdout: string; stderr: string; exitCode: number | null; outputFile?: string }>;
}

export interface BashToolOptions {
  cwd: string;
  permissionRules?: readonly PermissionRule[];
  operations?: BashOperations;
  spawnHook?: BashSpawnHook;
}

// ============================================================
// Safety checks
// ============================================================

export function isCommandDangerous(command: string): { dangerous: boolean; reason?: string } {
  for (const pattern of DANGEROUS_PATTERNS) {
    if (pattern.test(command)) {
      return { dangerous: true, reason: `Command matches security blacklist: "${pattern.source}"` };
    }
  }
  return { dangerous: false };
}

export function isCommandSafe(command: string): boolean {
  const trimmed = command.trim();

  // Exact match
  for (const safeCmd of SAFE_COMMANDS) {
    if (trimmed === safeCmd || trimmed.startsWith(safeCmd + ' ') || trimmed.startsWith(safeCmd + ' --')) {
      return true;
    }
  }

  // Pattern-based checks
  if (/^git (log|diff|show|status|branch|add|commit|stash|checkout|switch|restore|tag)(\s+|$)/.test(trimmed)) return true;
  if (/^(cat|head|tail|wc|less|more|file|stat|du|df|env|printenv|type)(\s+-\w+\s+|\s+)\S+/.test(trimmed) && !/\.(env|secret|key|pem|password)/i.test(trimmed)) return true;
  if (/^(grep|rg|ag|ack)(\s+-\w+)*\s+\S/.test(trimmed)) return true;
  if (/^find\s/.test(trimmed) && !/-exec/.test(trimmed) && !/-delete/.test(trimmed)) return true;
  if (/^(mkdir|touch|cp|mv)(\s+|$)/.test(trimmed) && !/\.(env|secret|key|pem|password)/i.test(trimmed) && !/^\//.test(trimmed.replace(/^(mkdir|touch|cp|mv)\s+/, ''))) return true;
  if (/^(npm|pnpm|yarn|npx)\s+(install|ci|run |test|lint|build|add|exec|list|outdated|audit)(\s+|$)/.test(trimmed)) return true;
  if (/^cargo\s+(build|check|test|clippy|fmt|doc|publish --dry-run)(\s+|$)/.test(trimmed)) return true;
  if (/^go\s+(build|test|vet|fmt|mod tidy|list)(\s+|$)/.test(trimmed)) return true;
  if (/^(python3?)(\s+-m\s+pytest)(\s+|$)/.test(trimmed)) return true;

  return false;
}

// ============================================================
// Background process redirect warning
// ============================================================

/**
 * Detects lines that put a process in the background (&) without redirecting output.
 * Without redirect the background process holds the pipe open, preventing the
 * spawn close event and causing the command to hang until the fallback timeout.
 */
function checkBgWarning(command: string): string | null {
  const suspicious: string[] = [];

  for (const line of command.split('\n')) {
    const code = line.replace(/#.*$/, '').trim();
    if (!code) continue;

    // Line ends with & (background operator, not &> redirect)
    if (!/&\s*$/.test(code)) continue;

    // Check for any output redirect on this line (before the trailing &)
    const beforeBg = code.replace(/\s*&\s*$/, '');
    if (/>/.test(beforeBg)) continue;

    suspicious.push(code);
  }

  if (suspicious.length === 0) return null;

  return (
    '⚠️  Background process without output redirect detected:\n' +
    suspicious.map((l) => `     ${l}`).join('\n') +
    '\n   Add > file.log 2>&1 before & so the pipe closes when the main process exits.\n'
  );
}

// ============================================================
// Process management
// ============================================================

function killProcessTree(pid: number): void {
  try { process.kill(-pid, 'SIGTERM'); } catch { /* ignore */ }
  setTimeout(() => {
    try { process.kill(-pid, 'SIGKILL'); } catch { /* ignore */ }
  }, 2000);
}

// ============================================================
// Background process spawning
// ============================================================

const BG_LOG_DIR = path.join(os.tmpdir(), '.thething', 'bash-logs');

/**
 * Spawn a command in the background (detached process).
 * Returns immediately with PID and log file path.
 * The process continues running after this function returns.
 */
function spawnBackground(
  command: string,
  cwd: string,
): { pid: number; logFile: string } {
  // Ensure log directory exists
  fs.mkdirSync(BG_LOG_DIR, { recursive: true });

  const logFile = path.join(
    BG_LOG_DIR,
    `bg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.log`,
  );
  const logStream = fs.createWriteStream(logFile);

  const child = spawn(command, [], {
    cwd,
    shell: true,
    detached: true,
    stdio: ['ignore', logStream, logStream],
  });

  // Unref so the parent process can exit independently
  child.unref();
  logStream.close();

  return { pid: child.pid!, logFile };
}

/**
 * Check if a log file exists and is readable
 */
function checkBgLogExists(logFile: string): boolean {
  try {
    fs.accessSync(logFile, fs.constants.R_OK);
    return true;
  } catch {
    return false;
  }
}

// ============================================================
// Default operations: local spawn-based execution
// ============================================================

const defaultBashOperations: BashOperations = {
  exec: (command, { cwd, timeout, signal, onStdout, onStderr }) => {
    return new Promise((resolve, reject) => {
      let stdout = '';
      let stderr = '';
      let timedOut = false;

      const child: ChildProcess = spawn(command, [], {
        cwd,
        shell: true,
        stdio: ['pipe', 'pipe', 'pipe'],
        timeout,
        signal,
      });

      // 超过 buffer 限制后不再杀进程,改为把后续输出溢出到磁盘文件,
      // 内存里只保留前 BASH_MAX_BUFFER 字节作为预览(见工具文档 #4)。
      let totalOutput = 0;
      let overflowFile: string | undefined;
      let overflowStream: fs.WriteStream | undefined;
      const openOverflow = (): void => {
        if (overflowStream) return;
        fs.mkdirSync(BG_LOG_DIR, { recursive: true });
        overflowFile = path.join(
          BG_LOG_DIR,
          `overflow-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.log`,
        );
        overflowStream = fs.createWriteStream(overflowFile);
        // 已缓冲的内容先落盘,保证文件是完整输出
        overflowStream.write(stdout);
        overflowStream.write(stderr);
      };

      // 记录输出:未超限时进内存缓冲;超限后进磁盘文件
      const record = (text: string, buffer: 'stdout' | 'stderr'): void => {
        const bytes = Buffer.byteLength(text, 'utf-8');
        if (totalOutput <= BASH_MAX_BUFFER && totalOutput + bytes > BASH_MAX_BUFFER) {
          openOverflow();
        }
        totalOutput += bytes;
        if (overflowStream) {
          overflowStream.write(text);
        } else if (buffer === 'stdout') {
          stdout += text;
        } else {
          stderr += text;
        }
      };

      child.stdout?.on('data', (chunk: Buffer) => {
        const text = chunk.toString('utf-8');
        record(text, 'stdout');
        onStdout?.(text);
      });

      child.stderr?.on('data', (chunk: Buffer) => {
        const text = chunk.toString('utf-8');
        record(text, 'stderr');
        onStderr?.(text);
      });

      child.on('error', (err: NodeJS.ErrnoException) => {
        if (err.code === 'ETIMEDOUT') {
          timedOut = true;
        }
        overflowStream?.end();
        reject(err);
      });

      child.on('close', (exitCode) => {
        overflowStream?.end();
        if (timedOut) {
          reject(Object.assign(new Error('Command timed out'), {
            killed: true, code: 'ETIMEDOUT', stdout, stderr, exitCode,
          }));
        } else {
          resolve({ stdout, stderr, exitCode, outputFile: overflowFile });
        }
      });

      // Abort handling
      if (signal) {
        signal.addEventListener('abort', () => {
          const pid = child.pid;
          if (pid) killProcessTree(pid);
          reject(Object.assign(new Error('Command execution aborted by user.'),
            { name: 'AbortError' }));
        }, { once: true });
      }
    });
  },
};

// ============================================================
// Bash execute entry point
// ============================================================

async function bashExecute({
  command,
  timeoutMs,
  background,
  execOptions,
  ops,
  options,
}: {
  command: string;
  timeoutMs: number;
  background: boolean;
  execOptions: { abortSignal?: AbortSignal };
  ops: BashOperations;
  options: BashToolOptions;
}) {
  // Re-check safety at execution time
  const safety = isCommandDangerous(command);
  if (safety.dangerous) {
    return {
      error: true,
      command,
      message: `Security block: ${safety.reason}`,
    };
  }

  const denialReason = consumeReviewerDenial('bash', command);
  if (denialReason) {
    return {
      error: true,
      command,
      message: `Operation denied by reviewer: ${denialReason}`,
    };
  }

  const matchedRule = checkPermissionRules('bash', { command }, options.permissionRules);
  if (matchedRule?.behavior === 'deny') {
    return {
      error: true,
      command,
      message: `Operation denied: ${matchedRule.pattern}`,
    };
  }

  // Background mode: spawn detached process and return immediately
  if (background) {
    let resolvedCwd = options.cwd;
    if (options.spawnHook) {
      const ctx = await options.spawnHook(command, {
        command,
        cwd: options.cwd,
        timeout: timeoutMs,
        shell: '/bin/bash',
      });
      resolvedCwd = ctx.cwd;
    }

    try {
      const { pid, logFile } = spawnBackground(command, resolvedCwd);
      return {
        pid,
        logFile,
        command,
        background: true,
        message: `Process started in background (PID: ${pid}). Use \`cat ${logFile}\` to check output, \`kill ${pid}\` to stop.`,
      };
    } catch (err) {
      return {
        error: true,
        command,
        message: `Failed to start background process: ${String(err)}`,
      };
    }
  }

  // Normal mode: execute and wait for result (original behavior)
  const startTime = Date.now();

  let resolvedCwd = options.cwd;
  let resolvedTimeout = timeoutMs;
  if (options.spawnHook) {
    const ctx = await options.spawnHook(command, {
      command,
      cwd: options.cwd,
      timeout: timeoutMs,
      shell: '/bin/bash',
    });
    resolvedCwd = ctx.cwd;
    resolvedTimeout = ctx.timeout;
  }

  try {
    const { stdout, stderr, exitCode, outputFile } = await ops.exec(command, {
      cwd: resolvedCwd,
      timeout: resolvedTimeout,
      signal: execOptions.abortSignal,
    });

    const duration = Date.now() - startTime;
    const bgWarning = checkBgWarning(command);
    let finalStderr = bgWarning ? bgWarning + stderr : stderr;

    // 输出超过 buffer 上限,已溢出到磁盘:提示完整输出的文件路径
    if (outputFile) {
      finalStderr =
        `⚠️  Output exceeded ${BASH_MAX_BUFFER} bytes; full output saved to: ${outputFile}\n` +
        `Read it with the read_file tool if you need more than the preview above.\n` +
        finalStderr;
    }

    return {
      stdout,
      stderr: finalStderr,
      exitCode,
      command,
      timedOut: false,
      duration,
      ...(outputFile ? { outputFile } : {}),
    };
  } catch (error: unknown) {
    const execError = error as Error & {
      killed?: boolean; code?: string | number; status?: number;
      stdout?: string; stderr?: string; exitCode?: number | null;
    };

    if (execError.name === 'AbortError') {
      throw new Error('Command execution aborted by user.');
    }

    if (execError.killed || execError.code === 'ETIMEDOUT') {
      throw new Error(
        `Command timed out after ${resolvedTimeout}ms. ` +
        `Increase timeoutMs or optimize the command.\n` +
        `Partial stdout: ${(execError.stdout || '').slice(-500)}`,
      );
    }

    const stdout = (execError.stdout || '').toString();
    const stderr = (execError.stderr || '').toString();

    if (stdout || stderr) {
      const exitCode = execError.exitCode ?? execError.code ?? 1;
      const bgWarning = checkBgWarning(command);
      const finalStderr = bgWarning ? bgWarning + stderr : stderr;
      return {
        stdout,
        stderr: finalStderr,
        exitCode: typeof exitCode === 'number' ? exitCode : 1,
        command,
        timedOut: false,
        duration: Date.now() - startTime,
      };
    }

    throw error;
  }
}

// ============================================================
// Tool factory
// ============================================================

export function createBashTool(options: BashToolOptions) {
  const ops = options.operations ?? defaultBashOperations;

  return tool({
    description:
      'Execute shell commands in the project environment. ' +
      'Useful for running builds, tests, git operations, and other command-line tasks. ' +
      'Dangerous operations (rm -rf /, sudo, wget, reverse shells) are blocked. ' +
      'Safe operations (git commit, npm test, file viewing) run automatically. ' +
      'Other operations require user approval.\n' +
      'IMPORTANT: Processes put in the background with & MUST redirect their output (> file 2>&1). ' +
      'Without redirect the pipe never closes, causing the command to hang until timeout.\n' +
      'To start a long-running process (server, dev server), set background: true. ' +
      'The command runs detached and returns immediately with pid and logFile. ' +
      'Use `cat <logFile>` to check output, `kill <pid>` to stop.',

    inputSchema: z.object({
      command: z.string().describe('The shell command to execute'),
      timeoutMs: z
        .number()
        .min(1000)
        .max(300000)
        .optional()
        .default(DEFAULT_TIMEOUT_MS)
        .describe('Timeout in milliseconds (default 30s, max 5min)'),
      background: z
        .boolean()
        .optional()
        .default(false)
        .describe(
          'Run command in background (detached process). ' +
          'Use for long-running processes like servers. Returns immediately with pid and logFile.',
        ),
    }),

    execute: ({ command, timeoutMs = DEFAULT_TIMEOUT_MS, background = false }, execOptions) => {
      return bashExecute({ command, timeoutMs, background, execOptions, ops, options });
    },

    // 以纯文本形式发送给模型,避免 stdout/stderr 经 JSON 序列化时的转义开销。
    // 结构化字段仍保留给 UI 渲染层。见 docs/built-in-tools-compaction-analysis.md 三.A。
    toModelOutput: ({ output }) => {
      if (!output || typeof output !== 'object') {
        return { type: 'text' as const, value: '' };
      }
      const r = output as Record<string, unknown>;

      // 错误 / 安全拦截分支
      if (r.error === true) {
        const message = typeof r.message === 'string' ? r.message : 'command failed';
        return { type: 'text' as const, value: `❌ ${message}` };
      }

      // 后台启动分支
      if (r.background === true) {
        return { type: 'text' as const, value: typeof r.message === 'string' ? r.message : 'Process started in background.' };
      }

      // 正常执行分支:拼接为纯文本
      const parts: string[] = [];
      const stdout = typeof r.stdout === 'string' ? r.stdout : '';
      const stderr = typeof r.stderr === 'string' ? r.stderr : '';
      const exitCode = typeof r.exitCode === 'number' ? r.exitCode : null;
      if (stdout) parts.push(stdout);
      if (stderr) parts.push(stderr.startsWith('⚠') || stderr.trim() ? `[stderr]\n${stderr}` : stderr);
      if (exitCode !== null && exitCode !== 0) parts.push(`[exit code: ${exitCode}]`);
      const value = parts.join('\n').trim();
      return { type: 'text' as const, value: value || '(no output)' };
    },
  });
}

