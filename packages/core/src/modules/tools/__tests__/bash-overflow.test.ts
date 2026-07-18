import { describe, it, expect } from 'vitest';
import { readFileSync, rmSync } from 'fs';
import { createBashTool } from '../bash';

// ============================================================
// 步骤 7 验收:bash 超 buffer 从杀进程改为落盘
// 见 docs/compaction-execution-plan.md 步骤 7
// ============================================================

// 直接调用工具的 execute(走真实 defaultBashOperations / spawn)
function runBash(command: string): Promise<any> {
  const tool = createBashTool({ cwd: process.cwd() });
  // @ts-expect-error execute 的第二参数在测试里不需要
  return tool.execute!({ command, timeoutMs: 30000, background: false }, {});
}

describe('bash 超 buffer 落盘', () => {
  it('completes a huge-output command and returns a file path instead of killing it', async () => {
    // 生成远超 200k 的输出:每行 ~100 字节 × 5000 行 ≈ 500KB
    const result = await runBash(
      `node -e "for(let i=0;i<5000;i++){process.stdout.write('x'.repeat(100)+'\\n')}"`,
    );

    // 进程正常跑完(未被杀),退出码 0
    expect(result.exitCode).toBe(0);
    expect(result.timedOut).toBe(false);

    // 溢出到磁盘,返回文件路径
    expect(result.outputFile).toBeTruthy();
    expect(result.stderr).toContain('saved to:');

    // 完整输出在文件里(≈500KB),内存预览被限制
    const saved = readFileSync(result.outputFile, 'utf-8');
    expect(saved.length).toBeGreaterThan(400_000);

    rmSync(result.outputFile, { force: true });
  });

  it('does not create an overflow file for small output', async () => {
    const result = await runBash(`echo hello`);
    expect(result.exitCode).toBe(0);
    expect(result.outputFile).toBeUndefined();
    expect(result.stdout.trim()).toBe('hello');
  });
});
