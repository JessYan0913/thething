import { tool } from 'ai';
import { exec as execCallback, ChildProcess } from 'child_process';
import { z } from 'zod';
import { checkPermissionRules } from '../../modules/permissions';
import type { PermissionRule } from '../../modules/permissions/types';

// Node.js maxBuffer 保护（防止进程内存溢出）
const BASH_MAX_BUFFER = 200_000;

// 危险命令黑名单 - 直接拒绝执行
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

// 安全命令白名单 - 不需要审批
const SAFE_COMMANDS = [
  // Git 只读
  'git status',
  'git log',
  'git diff',
  'git branch',
  'git show',
  // Git 安全写入（本地操作，可撤销）
  'git add',
  'git commit',
  'git stash',
  'git checkout',
  'git switch',
  'git restore',
  'git tag',
  // 文件查看
  'ls',
  'ls -la',
  'ls -l',
  'dir',
  'pwd',
  'cat',
  'head',
  'tail',
  'wc',
  'echo',
  'which',
  'file',
  'stat',
  'du',
  'df',
  'env',
  'printenv',
  'type',
  // 环境检查
  'node --version',
  'npm --version',
  'pnpm --version',
  'yarn --version',
  'python --version',
  'python3 --version',
  'java --version',
  'go version',
  'cargo --version',
  'rustc --version',
  // 文件操作（安全，不删除）
  'mkdir',
  'touch',
  'cp',
  'mv',
  'ln',
  // npm/pnpm/yarn 构建和测试
  'npm run build',
  'npm run lint',
  'npm run test',
  'npm test',
  'npm install',
  'npm ci',
  'pnpm run',
  'pnpm build',
  'pnpm lint',
  'pnpm test',
  'pnpm install',
  'pnpm add',
  'yarn run',
  'yarn build',
  'yarn lint',
  'yarn test',
  'yarn install',
  'yarn add',
  // 类型检查和代码质量
  'npx tsc --noEmit',
  'tsc --noEmit',
  'npx tsc',
  'tsc',
  'eslint',
  'prettier --check',
  'prettier --write',
  'tsx',
  // Python
  'python -m pytest',
  'python3 -m pytest',
  'pip install',
  'pip3 install',
  // Rust
  'cargo build',
  'cargo check',
  'cargo test',
  'cargo clippy',
  'cargo fmt',
  // Go
  'go build',
  'go test',
  'go vet',
  'go fmt',
];

const DEFAULT_TIMEOUT_MS = 30_000;

export interface BashToolOptions {
  cwd: string;
  permissionRules?: readonly PermissionRule[];
}

/**
 * 检查命令是否匹配危险模式
 */
function isCommandDangerous(command: string): { dangerous: boolean; reason?: string } {
  for (const pattern of DANGEROUS_PATTERNS) {
    if (pattern.test(command)) {
      return {
        dangerous: true,
        reason: `命令匹配安全黑名单: "${pattern.source}"`,
      };
    }
  }
  return { dangerous: false };
}

/**
 * 检查命令是否在白名单中
 */
function isCommandSafe(command: string): boolean {
  const trimmed = command.trim();

  // 精确匹配白名单命令
  for (const safeCmd of SAFE_COMMANDS) {
    if (trimmed === safeCmd || trimmed.startsWith(safeCmd + ' ') || trimmed.startsWith(safeCmd + ' --')) {
      return true;
    }
  }

  // 模式匹配：git 安全操作（带参数）
  if (/^git (log|diff|show|status|branch|add|commit|stash|checkout|switch|restore|tag)(\s+|$)/.test(trimmed)) {
    return true;
  }

  // 模式匹配：文件查看命令（带参数）
  if (/^(cat|head|tail|wc|less|more|file|stat|du|df|env|printenv|type)(\s+-\w+\s+|\s+)\S+/.test(trimmed)) {
    // 但不允许查看敏感文件
    if (!/\.(env|secret|key|pem|password)/i.test(trimmed)) {
      return true;
    }
  }

  // 模式匹配：grep/ripgrep/ag/ack 搜索
  if (/^(grep|rg|ag|ack)(\s+-\w+)*\s+\S/.test(trimmed)) {
    return true;
  }

  // 模式匹配：find 搜索（仅查找，不执行）
  if (/^find\s/.test(trimmed) && !/-exec/.test(trimmed) && !/-delete/.test(trimmed)) {
    return true;
  }

  // 模式匹配：mkdir/touch/cp/mv（项目内操作）
  if (/^(mkdir|touch|cp|mv)(\s+|$)/.test(trimmed)) {
    // 不允许操作敏感路径
    if (!/\.(env|secret|key|pem|password)/i.test(trimmed) && !/^\//.test(trimmed.replace(/^(mkdir|touch|cp|mv)\s+/, ''))) {
      return true;
    }
  }

  // 模式匹配：npm/pnpm/yarn 常见命令
  if (/^(npm|pnpm|yarn|npx)\s+(install|ci|run |test|lint|build|add|exec|list|outdated|audit)(\s+|$)/.test(trimmed)) {
    return true;
  }

  // 模式匹配：cargo 构建和测试
  if (/^cargo\s+(build|check|test|clippy|fmt|doc|publish --dry-run)(\s+|$)/.test(trimmed)) {
    return true;
  }

  // 模式匹配：go 构建和测试
  if (/^go\s+(build|test|vet|fmt|mod tidy|list)(\s+|$)/.test(trimmed)) {
    return true;
  }

  // 模式匹配：python pytest
  if (/^(python3?)(\s+-m\s+pytest)(\s+|$)/.test(trimmed)) {
    return true;
  }

  return false;
}

/**
 * 杀死进程树（包括所有子进程）
 */
function killProcessTree(pid: number): void {
  try {
    // 尝试杀死进程组
    process.kill(-pid, 'SIGTERM');
  } catch {
    // 如果进程组杀死失败，尝试直接杀死进程
    try {
      process.kill(pid, 'SIGTERM');
    } catch {
      // 进程可能已经退出
    }
  }

  // 给进程一些时间来清理，然后强制杀死
  setTimeout(() => {
    try {
      process.kill(-pid, 'SIGKILL');
    } catch {
      try {
        process.kill(pid, 'SIGKILL');
      } catch {
        // 进程可能已经退出
      }
    }
  }, 2000);
}

function execWithAbort(
  command: string,
  options: { timeout: number; maxBuffer: number; encoding: string; signal?: AbortSignal },
  cwd: string,
): Promise<{ stdout: string; stderr: string; exitCode: number | null }> {
  return new Promise((resolve, reject) => {
    const child: ChildProcess = execCallback(command, {
      encoding: options.encoding as BufferEncoding,
      timeout: options.timeout,
      maxBuffer: options.maxBuffer,
      cwd,
    }, (error, stdout, stderr) => {
      if (error) {
        reject(error);
      } else {
        resolve({ stdout, stderr, exitCode: 0 });
      }
    });

    if (options.signal) {
      options.signal.addEventListener('abort', () => {
        const pid = child.pid;
        if (pid) {
          killProcessTree(pid);
        } else if (child.kill) {
          child.kill('SIGTERM');
        }
        reject(new DOMException('The operation was aborted.', 'AbortError'));
      }, { once: true });
    }
  });
}

export function createBashTool(options: BashToolOptions) {
  return tool({
    description:
      '在沙箱中执行 shell 命令。适用于运行构建、测试、git 操作或其他命令行任务。命令在隔离环境中运行，危险操作（如 rm -rf /、sudo、curl、wget）会被拒绝。安全操作（git commit、npm test、文件查看等）会自动执行，灰色地带的操作需要用户审批。',
    inputSchema: z.object({
      command: z.string().describe('要执行的 shell 命令'),
      timeoutMs: z.number().min(1000).max(300000).optional().default(30000).describe('超时时间（毫秒），默认 30 秒，最大 5 分钟'),
    }),
    needsApproval: async ({ command }) => {
      const matchedRule = checkPermissionRules('bash', { command }, options.permissionRules);
      if (matchedRule?.behavior === 'allow') {
        return false;
      }
      if (matchedRule?.behavior === 'deny') {
        return true;
      }
      const dangerCheck = isCommandDangerous(command);
      if (dangerCheck.dangerous) {
        return true;
      }
      if (isCommandSafe(command)) {
        return false;
      }
      return true;
    },
    execute: async ({ command, timeoutMs = DEFAULT_TIMEOUT_MS }, execOptions) => {
      const safety = isCommandDangerous(command);
      if (safety.dangerous) {
        return {
          error: true,
          command,
          message: `安全阻止: ${safety.reason}\n\n该命令包含危险操作，已被安全策略拒绝。`,
        };
      }

      const matchedRule = checkPermissionRules('bash', { command }, options.permissionRules);
      if (matchedRule?.behavior === 'deny') {
        return {
          error: true,
          command,
          message: `操作被拒绝: ${matchedRule.pattern}`,
        };
      }

      const startTime = Date.now();

      try {
        const { stdout, stderr, exitCode } = await execWithAbort(command, {
          encoding: 'utf-8',
          timeout: timeoutMs,
          maxBuffer: BASH_MAX_BUFFER,
          signal: execOptions.abortSignal,
        }, options.cwd);

        const duration = Date.now() - startTime;

        return {
          stdout,
          stderr,
          exitCode,
          command,
          timedOut: false,
          duration,
        };
      } catch (error: unknown) {
        const execError = error as Error & { killed?: boolean; code?: string | number; status?: number; stdout?: string; stderr?: string };
        if (execError?.name === 'AbortError') {
          throw new Error('命令执行被用户中止。');
        }

        if (execError.killed || execError.code === 'ETIMEDOUT') {
          throw new Error(`命令执行超时 (${timeoutMs}ms)。请增加 timeoutMs 或优化命令。`);
        }

        if (execError.code === 'E2BIG' || (execError.stdout?.length ?? 0) + (execError.stderr?.length ?? 0) > BASH_MAX_BUFFER) {
          throw new Error(`命令输出过大（超过 ${BASH_MAX_BUFFER / 1024}KB 限制）。请重定向到文件或缩小输出范围。`);
        }

        const stdout = (execError.stdout || '').toString();
        const stderr = (execError.stderr || '').toString();
        const exitCode = execError.code || execError.status || 1;
        const duration = Date.now() - startTime;

        return {
          stdout,
          stderr,
          exitCode,
          command,
          timedOut: false,
          duration,
        };
      }
    },
  });
}
