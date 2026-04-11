import { tool } from 'ai';
import { exec as execCallback } from 'child_process';
import { promisify } from 'util';
import { z } from 'zod';

const exec = promisify(execCallback);

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

const MAX_OUTPUT_CHARS = 50_000;
const DEFAULT_TIMEOUT_MS = 30_000;

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

export const bashTool = tool({
  description:
    '在沙箱中执行 shell 命令。适用于运行构建、测试、git 操作或其他命令行任务。命令在隔离环境中运行，危险操作（如 rm -rf /、curl、wget）会被拒绝。',
  inputSchema: z.object({
    command: z.string().describe('要执行的 shell 命令'),
    timeoutMs: z.number().min(1000).max(120000).optional().default(30000).describe('超时时间（毫秒），默认 30 秒'),
  }),
  execute: async ({ command, timeoutMs = DEFAULT_TIMEOUT_MS }) => {
    const safety = isCommandDangerous(command);
    if (safety.dangerous) {
      throw new Error(`安全阻止: ${safety.reason}\n\n该命令包含危险操作，已被安全策略拒绝。`);
    }

    try {
      const { stdout, stderr } = await exec(command, {
        encoding: 'utf-8',
        timeout: timeoutMs,
        maxBuffer: MAX_OUTPUT_CHARS * 10,
      });

      const truncatedStdout =
        stdout.length > MAX_OUTPUT_CHARS
          ? stdout.slice(0, MAX_OUTPUT_CHARS) + '\n\n... (输出被截断，超过 50,000 字符) ...'
          : stdout;

      const truncatedStderr =
        stderr.length > MAX_OUTPUT_CHARS
          ? stderr.slice(0, MAX_OUTPUT_CHARS) + '\n\n... (输出被截断，超过 50,000 字符) ...'
          : stderr;

      return {
        stdout: truncatedStdout,
        stderr: truncatedStderr,
        exitCode: 0,
        command,
        timedOut: false,
      };
    } catch (error: any) {
      if (error.killed || error.code === 'ETIMEDOUT') {
        throw new Error(`命令执行超时 (${timeoutMs}ms)。请增加 timeoutMs 或优化命令。`);
      }

      if (error.code === 'E2BIG' || error.stdout?.length + error.stderr?.length > MAX_OUTPUT_CHARS * 10) {
        throw new Error(`命令输出过大。请重定向到文件或缩小输出范围。`);
      }

      const stdout = (error.stdout || '').toString();
      const stderr = (error.stderr || '').toString();
      const exitCode = error.code || error.status || 1;

      return {
        stdout: stdout.slice(0, MAX_OUTPUT_CHARS),
        stderr: stderr.slice(0, MAX_OUTPUT_CHARS),
        exitCode,
        command,
        timedOut: false,
      };
    }
  },
});