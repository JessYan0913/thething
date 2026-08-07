import { describe, it, expect, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import os from 'os';
import path from 'path';
import type { Tool } from 'ai';
import { createRegistryBoundMcpTool } from '../tool-wrapper';
import type { McpRegistry } from '../registry';

// ============================================================
// createRegistryBoundMcpTool — registry 绑定工具测试
//
// 核心：execute 委托给 registry.callToolSafe（而非创建时闭包里绑死的 client），
// 半死连接时由 callToolSafe 的重连重试自愈（治 -32001）。
// ============================================================

const SERVER = 'test-server';
const TOOL = 'do_something';

function makeToolDef(): Tool {
  return {
    description: 'A test MCP tool',
    inputSchema: { type: 'object', properties: {} },
    execute: vi.fn(),
  } as unknown as Tool;
}

function makeOptions(dataDir: string) {
  return {
    sessionId: 'session-1',
    dataDir,
    contentReplacementState: { seenIds: new Set<string>(), replacements: new Map<string, string>() },
    toolOutputConfig: {
      maxResultSizeChars: 1_000,
      maxToolResultTokens: 5_000,
      messageBudget: 24_000,
      previewSizeChars: 200,
    },
    qualifiedName: `mcp__${SERVER}__${TOOL}`,
  };
}

function makeFakeRegistry(impl: (name: string, tool: string, args: Record<string, unknown>) => unknown) {
  return { callToolSafe: vi.fn(impl) } as unknown as McpRegistry;
}

describe('createRegistryBoundMcpTool', () => {
  it('delegates execute to registry.callToolSafe with server/tool/args', async () => {
    const registry = makeFakeRegistry(async () => ({
      content: [{ type: 'text', text: 'ok' }],
      isError: false,
    }));
    const tool = createRegistryBoundMcpTool(makeToolDef(), SERVER, TOOL, registry, makeOptions(mkdtempSync(path.join(os.tmpdir(), 'mcp-wrapper-'))));

    const result = await (tool.execute as (input: unknown) => Promise<unknown>)({ query: 'x' });

    expect(registry.callToolSafe).toHaveBeenCalledWith(SERVER, TOOL, { query: 'x' });
    expect(result).toEqual({ content: [{ type: 'text', text: 'ok' }], isError: false });
  });

  it('keeps {content:[...]} structure and preserves non-text parts', async () => {
    const dataDir = mkdtempSync(path.join(os.tmpdir(), 'mcp-wrapper-'));
    const registry = makeFakeRegistry(async () => ({
      content: [
        { type: 'image', data: 'abc', mimeType: 'image/png' },
        { type: 'text', text: 'short text' },
      ],
      isError: false,
    }));
    const tool = createRegistryBoundMcpTool(makeToolDef(), SERVER, TOOL, registry, makeOptions(dataDir));

    const result = (await (tool.execute as (input: unknown) => Promise<unknown>)({})) as {
      content: Array<{ type: string; text?: string; data?: string }>;
    };

    expect(result.content).toHaveLength(2);
    expect(result.content[0]).toEqual({ type: 'image', data: 'abc', mimeType: 'image/png' });
    expect(result.content[1]?.type).toBe('text');
    expect(result.content[1]?.text).toBe('short text');
    rmSync(dataDir, { recursive: true, force: true });
  });

  it('passes through non-text result unchanged', async () => {
    const registry = makeFakeRegistry(async () => ({ content: [{ type: 'image', data: 'x' }] }));
    const tool = createRegistryBoundMcpTool(makeToolDef(), SERVER, TOOL, registry, makeOptions(mkdtempSync(path.join(os.tmpdir(), 'mcp-wrapper-'))));

    const result = await (tool.execute as (input: unknown) => Promise<unknown>)({});
    expect(result).toEqual({ content: [{ type: 'image', data: 'x' }] });
  });

  it('propagates errors from callToolSafe (retry exhausted → error to model)', async () => {
    const registry = makeFakeRegistry(async () => {
      throw new Error('MCP connection failed');
    });
    const tool = createRegistryBoundMcpTool(makeToolDef(), SERVER, TOOL, registry, makeOptions(mkdtempSync(path.join(os.tmpdir(), 'mcp-wrapper-'))));

    await expect((tool.execute as (input: unknown) => Promise<unknown>)({})).rejects.toThrow('MCP connection failed');
  });

  it('keeps original execute for structured-output tools (outputSchema present)', async () => {
    const originalExecute = vi.fn().mockResolvedValue({ some: 'structured' });
    const toolDef = {
      description: 'structured tool',
      inputSchema: {},
      outputSchema: {},
      execute: originalExecute,
    } as unknown as Tool;
    const registry = makeFakeRegistry(async () => ({ content: [] }));

    const wrapped = createRegistryBoundMcpTool(toolDef, SERVER, TOOL, registry, makeOptions(mkdtempSync(path.join(os.tmpdir(), 'mcp-wrapper-'))));

    const result = await (wrapped.execute as (input: unknown) => Promise<unknown>)({ a: 1 });
    expect(originalExecute).toHaveBeenCalled();
    expect(registry.callToolSafe).not.toHaveBeenCalled();
    expect(result).toEqual({ some: 'structured' });
  });
});
