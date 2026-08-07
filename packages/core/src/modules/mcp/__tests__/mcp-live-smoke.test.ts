// 临时冒烟：验证 registry.callToolSafe 返回形状与原 SDK tool.execute 等价
import { describe, it, expect } from 'vitest';
import { fileURLToPath } from 'node:url';
import { createMcpRegistry } from '../registry';
import { createRegistryBoundMcpTool } from '../tool-wrapper';

describe('mcp live shape smoke', () => {
  it('callToolSafe shape equals original execute shape', async () => {
    const serverPath = fileURLToPath(new URL('./mcp-live-server.mjs', import.meta.url));
    const config = {
      name: 'shape-check',
      transport: { type: 'stdio' as const, command: 'node', args: [serverPath] },
      enabled: true,
    };

    const registry = createMcpRegistry([config]);
    await registry.connectAll();

    console.log('SNAPSHOT:', JSON.stringify(registry.snapshot()));
    const tools = registry.getServerTools('shape-check');
    console.log('TOOLS KEYS:', Object.keys(tools));
    const rawTool = tools['echo'] as any;

    // 原始 SDK execute
    const rawResult = await rawTool.execute({ text: 'hello' }, {});
    // callToolSafe
    const safeResult = await registry.callToolSafe('shape-check', 'echo', { text: 'hello' });

    console.log('RAW :', JSON.stringify(rawResult));
    console.log('SAFE:', JSON.stringify(safeResult));
    expect(JSON.stringify(rawResult)).toBe(JSON.stringify(safeResult));

    // registry-bound tool（agent 路径）
    const boundTool = createRegistryBoundMcpTool(rawTool, 'shape-check', 'echo', registry, {
      sessionId: 'smoke',
      dataDir: '/tmp/mcp-shape-check/data',
      contentReplacementState: { seenIds: new Set<string>(), replacements: new Map<string, string>() },
      qualifiedName: 'mcp__shape-check__echo',
    });
    const boundResult = await (boundTool as any).execute({ text: 'hello' }, {});
    console.log('BOUND:', JSON.stringify(boundResult));
    expect(boundResult).toMatchObject({ content: [{ type: 'text', text: 'echo: hello' }] });

    // mixed 工具非文本 part 保留
    const safeMixed = (await registry.callToolSafe('shape-check', 'mixed', {})) as {
      content: Array<{ type?: string }>;
    };
    console.log('MIXED:', JSON.stringify(safeMixed));
    expect(safeMixed.content.some((p: any) => p.type === 'image')).toBe(true);
    expect(safeMixed.content.some((p: any) => p.type === 'text')).toBe(true);

    await registry.disconnectAll();
  });
});
