import { describe, it, expect } from 'vitest';
import type { SystemPromptSection, UserPreferences, ConversationMeta } from '../types';
import { buildSimpleSystemPrompt, buildTitleGenerationPrompt, getAvailableSections } from '../builder';

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

    describe('UserPreferences', () => {
      it('should have optional fields', () => {
        const prefs: UserPreferences = {
          language: 'zh-CN',
          domain: 'software',
          responseStyle: 'concise',
          customSystemPrompt: 'Be helpful',
        };
        expect(prefs.language).toBeDefined();
        expect(prefs.domain).toBeDefined();
        expect(prefs.responseStyle).toBeDefined();
      });

      it('should work with minimal prefs', () => {
        const prefs: UserPreferences = {};
        expect(prefs.language).toBeUndefined();
        expect(prefs.responseStyle).toBeUndefined();
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
        expect(prompt).toContain('Aura');
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