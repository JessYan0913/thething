import { describe, it, expect } from 'vitest';
import { resolveToolsForAgent, filterToolNames } from '../tool-resolver';
import type { AgentDefinition, AgentExecutionContext } from '../types';

// ============================================================
// 子 Agent 工具解析测试（递归防护 + 白名单/开关过滤）
//
// 白名单语义：tools 白名单只约束系统工具，MCP/connector 工具
// 由 mcp/connectors 能力开关独立控制。
// ============================================================

const CONNECTOR_TOOLS = new Set(['some_connector_tool']);

function makeContext(toolNames: string[]): AgentExecutionContext {
  return {
    parentTools: Object.fromEntries(toolNames.map((n) => [n, {}])),
    connectorToolNames: CONNECTOR_TOOLS,
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
  'agent', 'parallel_agent',
  'skill', 'find_skills', 'mcp__server__tool', 'some_connector_tool',
];

describe('resolveToolsForAgent', () => {
  describe('sub-agent denied tools (single-level nesting guard)', () => {
    it('always removes agent/parallel_agent', () => {
      const result = resolveToolsForAgent(makeDefinition(), makeContext(FULL_TOOLSET));
      expect(result).not.toContain('agent');
      expect(result).not.toContain('parallel_agent');
      expect(result).toContain('read_file');
      expect(result).toContain('bash');
    });

    it('denied tools cannot be re-enabled via explicit whitelist', () => {
      const result = resolveToolsForAgent(
        makeDefinition({ tools: ['agent', 'parallel_agent', 'read_file'] }),
        makeContext(FULL_TOOLSET),
      );
      expect(result).not.toContain('agent');
      expect(result).not.toContain('parallel_agent');
      expect(result).toContain('read_file');
    });

    it('denied tools cannot be re-enabled via wildcard', () => {
      const result = resolveToolsForAgent(
        makeDefinition({ tools: ['*'] }),
        makeContext(FULL_TOOLSET),
      );
      expect(result).not.toContain('agent');
      expect(result).not.toContain('parallel_agent');
    });
  });

  describe('whitelist (system tools only) and toggles', () => {
    it('whitelist restricts system tools but keeps mcp/connector tools', () => {
      const result = resolveToolsForAgent(
        makeDefinition({ tools: ['read_file', 'grep'] }),
        makeContext(FULL_TOOLSET),
      );
      // 系统工具：只剩白名单内的
      expect(result).toContain('read_file');
      expect(result).toContain('grep');
      expect(result).not.toContain('bash');
      expect(result).not.toContain('glob');
      expect(result).not.toContain('skill');
      // MCP/connector 工具不受白名单约束（默认开关全开）
      expect(result).toContain('mcp__server__tool');
      expect(result).toContain('some_connector_tool');
    });

    it('whitelist + mcp:false removes mcp tools', () => {
      const result = resolveToolsForAgent(
        makeDefinition({ tools: ['read_file'], mcp: false }),
        makeContext(FULL_TOOLSET),
      );
      expect(result).not.toContain('mcp__server__tool');
      expect(result).toContain('read_file');
      expect(result).toContain('some_connector_tool');
    });

    it('whitelist + connectors:false removes connector tools', () => {
      const result = resolveToolsForAgent(
        makeDefinition({ tools: ['read_file'], connectors: false }),
        makeContext(FULL_TOOLSET),
      );
      expect(result).not.toContain('some_connector_tool');
      expect(result).toContain('mcp__server__tool');
    });

    it('whitelist matching no system tools still keeps mcp/connector tools', () => {
      const result = resolveToolsForAgent(
        makeDefinition({ tools: ['nonexistent_tool'] }),
        makeContext(FULL_TOOLSET),
      );
      expect(result).toEqual(['mcp__server__tool', 'some_connector_tool']);
    });

    it('returns empty array (not undefined) when nothing survives', () => {
      // 返回 undefined 会被 SDK 视为"启用全部工具"，正好与白名单意图相反
      const result = resolveToolsForAgent(
        makeDefinition({ tools: ['nonexistent_tool'], mcp: false, connectors: false }),
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

    it('skills:false removes skill and find_skills tools', () => {
      const result = resolveToolsForAgent(
        makeDefinition({ skills: false }),
        makeContext(FULL_TOOLSET),
      );
      expect(result).not.toContain('skill');
      expect(result).not.toContain('find_skills');
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

    it('connectors:false does not strip system tools absent from any hardcoded list (find_skills regression)', () => {
      // 回归：旧实现按硬编码 SYSTEM_TOOLS 判定，find_skills/context_pin
      // 不在名单内被误判为连接器工具剥掉
      const result = resolveToolsForAgent(
        makeDefinition({ connectors: false }),
        makeContext(FULL_TOOLSET),
      );
      expect(result).toContain('find_skills');
    });
  });
});

describe('filterToolNames (shared main/sub agent filter)', () => {
  it('denySubAgentTools:false keeps agent/parallel_agent (main agent path)', () => {
    const result = filterToolNames(FULL_TOOLSET, {
      tools: ['read_file', 'agent', 'parallel_agent'],
      connectorToolNames: CONNECTOR_TOOLS,
      denySubAgentTools: false,
    });
    expect(result).toContain('agent');
    expect(result).toContain('parallel_agent');
    expect(result).not.toContain('bash');
  });

  it('no options means no filtering', () => {
    const result = filterToolNames(FULL_TOOLSET, {});
    expect(result).toEqual(FULL_TOOLSET);
  });

  it('empty whitelist means no whitelist filtering', () => {
    // serializeAgentMarkdown 默认写 tools: []，语义为"不限制"
    const result = filterToolNames(FULL_TOOLSET, { tools: [] });
    expect(result).toEqual(FULL_TOOLSET);
  });
});
