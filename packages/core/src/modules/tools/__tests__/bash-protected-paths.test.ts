import { describe, expect, it, vi } from 'vitest';
import { createBashTool, type BashOperations } from '../bash';

async function execute(tool: any, command: string): Promise<any> {
  return tool.execute(
    { command, timeoutMs: 30_000, background: false },
    { toolCallId: 'test', messages: [] },
  );
}

function operations(): BashOperations & { exec: ReturnType<typeof vi.fn> } {
  return {
    exec: vi.fn(async () => ({ stdout: 'ok', stderr: '', exitCode: 0 })),
  };
}

describe('bash managed Wiki path protection', () => {
  const wikiDir = '/tmp/thething-managed/wiki';

  it.each([
    `rm "${wikiDir}/page.md"`,
    `mv /tmp/page.md "${wikiDir}/page.md"`,
    `printf test > "${wikiDir}/page.md"`,
    `python -c "open('${wikiDir}/page.md','w').write('x')"`,
  ])('blocks commands that can mutate the Wiki directory: %s', async (command) => {
    const ops = operations();
    const tool = createBashTool({
      cwd: '/tmp',
      protectedWritePaths: [wikiDir],
      operations: ops,
    });

    const result = await execute(tool, command);

    expect(result.error).toBe(true);
    expect(result.message).toContain('Managed Wiki path');
    expect(ops.exec).not.toHaveBeenCalled();
  });

  it.each([
    `cat "${wikiDir}/page.md"`,
    `rg provenance "${wikiDir}"`,
    `find "${wikiDir}" -name '*.md'`,
    `ls -la "${wikiDir}"`,
  ])('allows explicit read-only commands for the Wiki directory: %s', async (command) => {
    const ops = operations();
    const tool = createBashTool({
      cwd: '/tmp',
      protectedWritePaths: [wikiDir],
      operations: ops,
    });

    const result = await execute(tool, command);

    expect(result.error).not.toBe(true);
    expect(result.exitCode).toBe(0);
    expect(ops.exec).toHaveBeenCalledOnce();
  });
});
