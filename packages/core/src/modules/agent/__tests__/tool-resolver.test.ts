import { describe, it, expect } from 'vitest';
import { resolveToolsForAgent } from '../tool-resolver';
import type { AgentDefinition, AgentExecutionContext } from '../types';

// ============================================================
// 子 Agent 工具解析测试（递归防护 + 白名单/开关过滤）
// ============================================================

function makeContext(toolNames: string[]): AgentExecutionContext {
  return {
    parentTools: Object.fromEntries(toolNames.map((n) => [n, {}])),
  } as unknown as AgentExecutionContext;
}

function makeDefinition(overrides: Partial<AgentDefinition> = {}): AgentDefinition {
  return {
    agentType: 'test',
    instructions: 'test',
    source: 'builtin',
    ...overrides,
  };
}

const FULL_TOOLSET = [
  'read_file', 'bash', 'grep', 'glob', 'web_fetch',
  'agent', 'parallel_agent', 'compact_tool_result',
  'skill', 'mcp__server__tool', 'some_connector_tool',
];

describe('resolveToolsForAgent', () => {
  describe('sub-agent denied tools (single-level nesting guard)', () => {
    it('always removes agent/parallel_agent/compact_tool_result', () => {
      const result = resolveToolsForAgent(makeDefinition(), makeContext(FULL_TOOLSET));
      expect(result).not.toContain('agent');
      expect(result).not.toContain('parallel_agent');
      expect(result).not.toContain('compact_tool_result');
      expect(result).toContain('read_file');
      expect(result).toContain('bash');
    });

    it('denied tools cannot be re-enabled via explicit whitelist', () => {
      const result = resolveToolsForAgent(
        makeDefinition({ tools: ['agent', 'parallel_agent', 'read_file'] }),
        makeContext(FULL_TOOLSET),
      );
      expect(result).toEqual(['read_file']);
    });

    it('denied tools cannot be re-enabled via wildcard', () => {
      const result = resolveToolsForAgent(
        makeDefinition({ tools: ['*'] }),
        makeContext(FULL_TOOLSET),
      );
      expect(result).not.toContain('agent');
      expect(result).not.toContain('parallel_agent');
      expect(result).not.toContain('compact_tool_result');
    });
  });

  describe('whitelist and toggles', () => {
    it('filters by whitelist', () => {
      const result = resolveToolsForAgent(
        makeDefinition({ tools: ['read_file', 'grep'] }),
        makeContext(FULL_TOOLSET),
      );
      expect(result).toEqual(['read_file', 'grep']);
    });

    it('returns empty array (not undefined) when whitelist matches nothing', () => {
      // 返回 undefined 会被 SDK 视为"启用全部工具"，正好与白名单意图相反
      const result = resolveToolsForAgent(
        makeDefinition({ tools: ['nonexistent_tool'] }),
        makeContext(FULL_TOOLSET),
      );
      expect(result).toEqual([]);
    });

    it('mcp:false removes mcp__ tools', () => {
      const result = resolveToolsForAgent(
        makeDefinition({ mcp: false }),
        makeContext(FULL_TOOLSET),
      );
      expect(result).not.toContain('mcp__server__tool');
      expect(result).toContain('read_file');
    });

    it('skills:false removes skill tool', () => {
      const result = resolveToolsForAgent(
        makeDefinition({ skills: false }),
        makeContext(FULL_TOOLSET),
      );
      expect(result).not.toContain('skill');
    });

    it('connectors:false keeps only system and mcp tools', () => {
      const result = resolveToolsForAgent(
        makeDefinition({ connectors: false }),
        makeContext(FULL_TOOLSET),
      );
      expect(result).not.toContain('some_connector_tool');
      expect(result).toContain('read_file');
      expect(result).toContain('mcp__server__tool');
    });
  });
});
