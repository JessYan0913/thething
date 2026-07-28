import { describe, expect, it, vi } from 'vitest';
import type { AgentToolConfig } from '../../agent/types';
import type { Skill, SkillEffort } from '../../skills/types';
import { createSkillTool } from '../skill';

async function execute(tool: any, input: unknown): Promise<any> {
  return tool.execute(input, { toolCallId: 'test', messages: [] });
}

type SkillOverrideState = {
  skillTurnOverride?: {
    skillName: string;
    model?: string;
    effort?: SkillEffort;
  };
};

const modelAliases = {
  fast: { model: 'fast-model' },
  smart: { model: 'smart-model' },
  default: { model: 'default-model' },
};

const agentConfig = {
  parentTools: {},
  parentModel: { modelId: 'parent-model' },
  parentSystemPrompt: '',
  parentMessages: [{ id: 'parent', role: 'user', parts: [] }],
  writerRef: { current: null },
  configDir: '/tmp/.thething',
} as unknown as AgentToolConfig;

function makeSkill(name: string): Skill {
  return {
    name,
    description: `${name} description`,
    whenToUse: 'for tests',
    allowedTools: [],
    effort: 'medium',
    context: 'inline',
    paths: [],
    sourcePath: '',
    source: 'user',
    body: `Instructions for ${name}`,
  };
}

describe('skill tool recovery guidance', () => {
  it('guides unknown skill requests to create-skill', async () => {
    const tool = createSkillTool({ skills: [] });

    const result = await execute(tool, { skill: 'new-skill' });

    expect(result.success).toBe(false);
    expect(result.error).toContain('create-skill');
    expect(result.error).toContain('SKILL.md');
    expect(result.error).toContain('Wiki');
  });

  it('reloads skills from disk after a snapshot miss', async () => {
    const reloadSkills = vi.fn(async () => [makeSkill('fresh-skill')]);
    const tool = createSkillTool({ skills: [], reloadSkills });

    const result = await execute(tool, { skill: '/fresh-skill' });

    expect(reloadSkills).toHaveBeenCalledOnce();
    expect(result).toMatchObject({ success: true, skillName: 'fresh-skill' });
  });

  it('applies resolved model and effort overrides for the current request', async () => {
    const sessionState: SkillOverrideState = {};
    const skill = {
      ...makeSkill('smart-skill'),
      model: 'smart',
      effort: 'xhigh' as const,
    };
    const tool = createSkillTool({
      skills: [skill],
      sessionState,
      modelAliases,
      availableModels: ['smart-model'],
    });

    await execute(tool, { skill: 'smart-skill' });

    expect(sessionState.skillTurnOverride).toEqual({
      skillName: 'smart-skill',
      model: 'smart-model',
      effort: 'xhigh',
    });
  });

  it('keeps the current model for inherit or unavailable model overrides', async () => {
    const inheritState: SkillOverrideState = {};
    const inheritTool = createSkillTool({
      skills: [{ ...makeSkill('inherit-skill'), model: 'inherit', effort: undefined }],
      sessionState: inheritState,
    });
    await execute(inheritTool, { skill: 'inherit-skill' });
    expect(inheritState.skillTurnOverride).toBeUndefined();

    const unavailableState: SkillOverrideState = {};
    const unavailableTool = createSkillTool({
      skills: [{ ...makeSkill('blocked-skill'), model: 'blocked-model', effort: undefined }],
      sessionState: unavailableState,
      availableModels: ['allowed-model'],
    });
    await execute(unavailableTool, { skill: 'blocked-skill' });
    expect(unavailableState.skillTurnOverride).toBeUndefined();
  });

  it('does not apply parent-turn overrides for fork skills', async () => {
    const sessionState: SkillOverrideState = {};
    const tool = createSkillTool({
      skills: [{ ...makeSkill('fork-skill'), context: 'fork', model: 'smart' }],
      sessionState,
      modelAliases,
    });

    await execute(tool, { skill: 'fork-skill' });

    expect(sessionState.skillTurnOverride).toBeUndefined();
  });

  it('runs fork skills synchronously without parent messages', async () => {
    const executeFork = vi.fn(async () => ({
      success: true,
      summary: 'fork result',
      durationMs: 1,
      stepsExecuted: 1,
      toolsUsed: ['read_file'],
      status: 'completed' as const,
    }));
    const tool = createSkillTool({
      skills: [{
        ...makeSkill('fork-skill'),
        context: 'fork',
        agent: 'general-purpose',
        background: false,
        model: 'smart',
      }],
      modelAliases,
      agentConfig,
      executeFork,
    });

    const result = await execute(tool, { skill: 'fork-skill', args: 'input' });

    expect(result).toMatchObject({
      success: true,
      forked: true,
      background: false,
      summary: 'fork result',
    });
    expect(executeFork).toHaveBeenCalledWith(expect.objectContaining({
      agentType: 'general-purpose',
      includeParentMessages: false,
      modelOverride: 'smart-model',
      task: expect.stringContaining('Instructions for fork-skill'),
    }));
  });

  it('rejects background fork until a persistent run handle exists', async () => {
    const executeFork = vi.fn();
    const tool = createSkillTool({
      skills: [{ ...makeSkill('background-skill'), context: 'fork', background: true }],
      agentConfig,
      executeFork,
    });

    const result = await execute(tool, { skill: 'background-skill' });

    expect(result.success).toBe(false);
    expect(result.error).toContain('Background fork execution is not available');
    expect(executeFork).not.toHaveBeenCalled();
  });

  it('keeps unknown-skill guidance when reload fails', async () => {
    const tool = createSkillTool({
      skills: [],
      reloadSkills: vi.fn(async () => { throw new Error('scan failed'); }),
    });

    const result = await execute(tool, { skill: 'still-missing' });

    expect(result.success).toBe(false);
    expect(result.error).toContain('create-skill');
  });
});
