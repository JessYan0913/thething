import { tool } from 'ai';
import { exec as execCallback, ChildProcess } from 'child_process';
import { z } from 'zod';
import { checkPermissionRules } from '../../extensions/permissions';

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
  /^\s*curl\s/i,
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
  'git status',
  'git log',
  'git diff',
  'git branch',
  'git show',
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
  'node --version',
  'npm --version',
  'pnpm --version',
  'npm run build',
  'npm run lint',
  'npm run test',
  'npm test',
  'pnpm run',
  'pnpm build',
  'pnpm lint',
  'pnpm test',
  'yarn run',
  'yarn build',
  'yarn lint',
  'yarn test',
  'npx tsc --noEmit',
  'tsc --noEmit',
  'eslint',
  'prettier --check',
  'prettier --write',
  'tsx',
];

const DEFAULT_TIMEOUT_MS = 30_000;

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

  // 模式匹配：git log/diff/show 后面带参数
  if (/^git (log|diff|show|status|branch)(\s+|$)/.test(trimmed)) {
    return true;
  }

  // 模式匹配：简单的文件查看命令
  if (/^(cat|head|tail|wc)(\s+-\w+\s+|\s+)\S+/.test(trimmed)) {
    // 但不允许查看敏感文件
    if (!/\.(env|secret|key|pem|password)/i.test(trimmed)) {
      return true;
    }
  }

  // 模式匹配：grep 搜索
  if (/^grep(\s+-\w+)*\s+\S/.test(trimmed)) {
    return true;
  }

  // 模式匹配：find 搜索（仅查找，不执行）
  if (/^find\s/.test(trimmed) && !/-exec/.test(trimmed) && !/-delete/.test(trimmed)) {
    return true;
  }

  return false;
}

function execWithAbort(
  command: string,
  options: { timeout: number; maxBuffer: number; encoding: string; signal?: AbortSignal },
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child: ChildProcess = execCallback(command, {
      encoding: options.encoding as BufferEncoding,
      timeout: options.timeout,
      maxBuffer: options.maxBuffer,
    }, (error, stdout, stderr) => {
      if (error) {
        reject(error);
      } else {
        resolve({ stdout, stderr });
      }
    });

    if (options.signal) {
      options.signal.addEventListener('abort', () => {
        const pid = child.pid;
        if (pid) {
          try { process.kill(-pid, 'SIGTERM'); } catch {}
          setTimeout(() => {
            if (!child.killed) {
              try { process.kill(-pid, 'SIGKILL'); } catch {}
            }
          }, 2000);
        } else if (child.kill) {
          child.kill('SIGTERM');
        }
        reject(new DOMException('The operation was aborted.', 'AbortError'));
      });
    }
  });
}

export const bashTool = tool({
  description:
    '在沙箱中执行 shell 命令。适用于运行构建、测试、git 操作或其他命令行任务。命令在隔离环境中运行，危险操作（如 rm -rf /、curl、wget）会被拒绝。部分命令需要用户审批后才能执行。',
  inputSchema: z.object({
    command: z.string().describe('要执行的 shell 命令'),
    timeoutMs: z.number().min(1000).max(120000).optional().default(30000).describe('超时时间（毫秒），默认 30 秒'),
  }),
  needsApproval: async ({ command }) => {
    // Step 0: 检查持久化规则（Always allow）
    const matchedRule = checkPermissionRules('bash', { command });
    if (matchedRule?.behavior === 'allow') {
      return false;  // 自动放行
    }
    if (matchedRule?.behavior === 'deny') {
      // 不抛出错误，返回 true 让审批流程处理，或让 execute 返回错误结果
      return true;
    }

    // Step 1: 检查危险命令黑名单 - 需要审批（让 execute 返回错误结果）
    const dangerCheck = isCommandDangerous(command);
    if (dangerCheck.dangerous) {
      return true;
    }

    // Step 2: 检查安全命令白名单 - 自动放行，不需要审批
    if (isCommandSafe(command)) {
      return false;
    }

    // Step 3: 其他命令需要用户审批
    return true;
  },
  execute: async ({ command, timeoutMs = DEFAULT_TIMEOUT_MS }, options) => {
    // Step 1: 检查危险命令黑名单（返回错误结果而非抛出错误）
    const safety = isCommandDangerous(command);
    if (safety.dangerous) {
      return {
        error: true,
        command,
        message: `安全阻止: ${safety.reason}\n\n该命令包含危险操作，已被安全策略拒绝。`,
      };
    }

    // Step 2: 检查 deny 规则
    const matchedRule = checkPermissionRules('bash', { command });
    if (matchedRule?.behavior === 'deny') {
      return {
        error: true,
        command,
        message: `操作被拒绝: ${matchedRule.pattern}`,
      };
    }

    try {
      const { stdout, stderr } = await execWithAbort(command, {
        encoding: 'utf-8',
        timeout: timeoutMs,
        maxBuffer: BASH_MAX_BUFFER,
        signal: options?.abortSignal,
      });

      return {
        stdout,
        stderr,
        exitCode: 0,
        command,
        timedOut: false,
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
        throw new Error(`命令输出过大。请重定向到文件或缩小输出范围。`);
      }

      const stdout = (execError.stdout || '').toString();
      const stderr = (execError.stderr || '').toString();
      const exitCode = execError.code || execError.status || 1;

      return {
        stdout,
        stderr,
        exitCode,
        command,
        timedOut: false,
      };
    }
  },
});