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

    describe('getAvailableSections', () => {
      it('should return all section names', () => {
        const sections = getAvailableSections();
        expect(sections.length).toBeGreaterThan(0);
        expect(sections).toContain('identity');
        expect(sections).toContain('capabilities');
        expect(sections).toContain('rules');
      });
    });
  });
});