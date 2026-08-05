import { describe, it, expect } from 'vitest';
import type { SystemPromptSection, ConversationMeta } from '../types';
import { buildSimpleSystemPrompt, buildSystemPrompt, buildTitleGenerationPrompt, getAvailableSections } from '../builder';

// ============================================================
// System Prompt Tests
// ============================================================
describe('system-prompt', () => {
  describe('types', () => {
    describe('SystemPromptSection', () => {
      it('should have required fields', () => {
        const section: SystemPromptSection = {
          name: 'test-section',
          content: 'Test content',
          cacheStrategy: 'static',
          priority: 10,
        };
        expect(section.name).toBeDefined();
        expect(section.content).toBeDefined();
        expect(section.cacheStrategy).toBeDefined();
        expect(section.priority).toBeDefined();
      });

      it('should allow null content', () => {
        const section: SystemPromptSection = {
          name: 'empty-section',
          content: null,
          cacheStrategy: 'dynamic',
          priority: 5,
        };
        expect(section.content).toBeNull();
      });

      it('should have valid cache strategies', () => {
        const strategies = ['static', 'session', 'dynamic'] as const;
        strategies.forEach((strategy) => {
          const section: SystemPromptSection = {
            name: 'test',
            content: 'content',
            cacheStrategy: strategy,
            priority: 1,
          };
          expect(section.cacheStrategy).toBe(strategy);
        });
      });
    });

    describe('ConversationMeta', () => {
      it('should have required fields', () => {
        const meta: ConversationMeta = {
          messageCount: 5,
          conversationStartTime: Date.now(),
          isNewConversation: false,
        };
        expect(meta.messageCount).toBeDefined();
        expect(meta.conversationStartTime).toBeDefined();
        expect(meta.isNewConversation).toBeDefined();
      });
    });
  });

  describe('builder', () => {
    describe('buildSimpleSystemPrompt', () => {
      it('should return non-empty string', () => {
        const prompt = buildSimpleSystemPrompt();
        expect(prompt.length).toBeGreaterThan(0);
      });

      it('should contain identity section', () => {
        const prompt = buildSimpleSystemPrompt();
        expect(prompt).toContain('TheThing');
      });

      it('should contain capabilities section', () => {
        const prompt = buildSimpleSystemPrompt();
        expect(prompt.length).toBeGreaterThan(100);
      });
    });

    describe('buildTitleGenerationPrompt', () => {
      it('should return title generation prompt', () => {
        const prompt = buildTitleGenerationPrompt();
        expect(prompt).toContain('标题');
        expect(prompt).toContain('生成');
      });
    });

    describe('skill creation guidance', () => {
      it('explains the canonical skill format even when no skills are loaded', async () => {
        const { prompt } = await buildSystemPrompt({ skills: [], includeProjectContext: false });
        expect(prompt).toContain('SKILL.md');
        expect(prompt).toContain('不是 .py 脚本');
        expect(prompt).toContain('不是 Wiki 页面');
        expect(prompt).toContain('create-skill');
        expect(prompt).toContain('name 和 description');
        expect(prompt).toContain('启动时只索引');
        expect(prompt).toContain('按需加载正文和资源');
      });
    });

    describe('agent identity (custom agent)', () => {
      it('places agent instructions at the top and drops identity/capabilities', async () => {
        const agentInstructions = '你是一个AI产品经理，擅长需求梳理、PRD撰写。';
        const { prompt, includedSections } = await buildSystemPrompt({
          skills: [],
          includeProjectContext: false,
          agentIdentity: agentInstructions,
          excludeSections: ['identity', 'capabilities'],
        });
        // Agent 身份出现在提示词开头
        expect(prompt.startsWith(agentInstructions)).toBe(true);
        // 默认身份/能力声明被排除
        expect(includedSections).not.toContain('identity');
        expect(includedSections).not.toContain('capabilities');
        expect(prompt).not.toContain('通用智能助手');
        // 价值观底线（rules section）保留
        expect(prompt).toContain('核心价值');
      });

      it('keeps default behavior when no agentIdentity is provided', async () => {
        const { includedSections } = await buildSystemPrompt({
          skills: [],
          includeProjectContext: false,
        });
        expect(includedSections).not.toContain('agent-identity');
        expect(includedSections).toContain('capabilities');
      });
    });

    describe('getAvailableSections', () => {
      it('should return all section names', () => {
        const sections = getAvailableSections();
        expect(sections.length).toBeGreaterThan(0);
        expect(sections).toContain('identity');
        expect(sections).toContain('capabilities');
        expect(sections).toContain('rules');
      });
    });

    describe('cache-friendly ordering', () => {
      it('places byte-stable sections before the dynamic boundary', async () => {
        const customInstructions = 'BE_CONCISE';
        const { includedSections } = await buildSystemPrompt({
          skills: [],
          includeProjectContext: false,
          customInstructions,
        });
        // dynamic-boundary marker must exist
        expect(includedSections).toContain('dynamic-boundary');
        const boundaryIdx = includedSections.indexOf('dynamic-boundary');
        // All session-level / static sections should be before the boundary
        const cacheable = ['identity', 'capabilities', 'rules', 'actions', 'error-handling',
                           'project-context', 'skill-matching', 'mcp-tools',
                           'permissions', 'wiki-guidelines', 'custom-instructions'];
        for (const name of cacheable) {
          if (!includedSections.includes(name)) continue;
          expect(includedSections.indexOf(name)).toBeLessThan(boundaryIdx);
        }
        // Per-turn sections (todo-overview) must be after the boundary
        if (includedSections.includes('todo-overview')) {
          expect(includedSections.indexOf('todo-overview')).toBeGreaterThan(boundaryIdx);
        }
        // dynamic section (session meta) must be after the boundary
        if (includedSections.includes('session')) {
          expect(includedSections.indexOf('session')).toBeGreaterThan(boundaryIdx);
        }
      });

      it('places customInstructions before dynamic sections', async () => {
        const customInstructions = 'TEST_CUSTOM_INSTR';
        const { prompt } = await buildSystemPrompt({
          skills: [],
          includeProjectContext: false,
          customInstructions,
        });
        // customInstructions should appear before the DYNAMIC_BOUNDARY marker
        const customIdx = prompt.indexOf('TEST_CUSTOM_INSTR');
        const boundaryIdx = prompt.indexOf('__DYNAMIC_CONTENT_BOUNDARY__');
        expect(customIdx).toBeGreaterThan(-1);
        expect(boundaryIdx).toBeGreaterThan(-1);
        expect(customIdx).toBeLessThan(boundaryIdx);
      });
    });
  });
});