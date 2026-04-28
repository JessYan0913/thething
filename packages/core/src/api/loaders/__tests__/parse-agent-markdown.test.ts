import { describe, it, expect } from 'vitest';
import { parseAgentMarkdown } from '../../../api/loaders/agents';
import { ParseError } from '../../../foundation/parser';

describe('parseAgentMarkdown', () => {
  it('should parse valid markdown content to AgentDefinition', () => {
    const mdContent = `---
name: test-agent
description: A test agent for verification
tools: read, write
model: smart
maxTurns: 30
---

This is the agent instructions.
It should do X, Y, Z.
`;

    const agent = parseAgentMarkdown(mdContent, 'user');

    expect(agent.agentType).toBe('test-agent');
    expect(agent.description).toBe('A test agent for verification');
    expect(agent.tools).toEqual(['read', 'write']);
    expect(agent.model).toBe('smart');
    expect(agent.maxTurns).toBe(30);
    expect(agent.instructions).toBe('This is the agent instructions.\nIt should do X, Y, Z.');
    expect(agent.source).toBe('user');
  });

  it('should parse with array tools', () => {
    const mdContent = `---
name: array-tools-agent
description: Agent with array tools
tools:
  - read_file
  - grep
  - bash
---

Instructions here.
`;

    const agent = parseAgentMarkdown(mdContent);

    expect(agent.agentType).toBe('array-tools-agent');
    expect(agent.tools).toEqual(['read_file', 'grep', 'bash']);
    expect(agent.source).toBe('project');
  });

  it('should use default values for optional fields', () => {
    const mdContent = `---
name: minimal-agent
description: Minimal agent
---

Basic instructions.
`;

    const agent = parseAgentMarkdown(mdContent);

    expect(agent.agentType).toBe('minimal-agent');
    expect(agent.model).toBe('inherit');
    expect(agent.maxTurns).toBe(20);
    expect(agent.tools).toBeUndefined();
    expect(agent.includeParentContext).toBe(false);
    expect(agent.summarizeOutput).toBe(true);
  });

  it('should throw ParseError for invalid frontmatter', () => {
    const mdContent = `---
name: ""
description: missing description
---

Instructions.
`;

    expect(() => parseAgentMarkdown(mdContent)).toThrow(ParseError);
  });

  it('should throw ParseError for missing required fields', () => {
    const mdContent = `---
description: no name field
---

Instructions.
`;

    expect(() => parseAgentMarkdown(mdContent)).toThrow(ParseError);
  });

  it('should parse skills as string', () => {
    const mdContent = `---
name: skills-agent
description: Agent with skills
skills: skill1, skill2, skill3
---

Instructions.
`;

    const agent = parseAgentMarkdown(mdContent);

    expect(agent.skills).toEqual(['skill1', 'skill2', 'skill3']);
  });

  it('should parse skills as array', () => {
    const mdContent = `---
name: skills-array-agent
description: Agent with array skills
skills:
  - skill-a
  - skill-b
---

Instructions.
`;

    const agent = parseAgentMarkdown(mdContent);

    expect(agent.skills).toEqual(['skill-a', 'skill-b']);
  });
});