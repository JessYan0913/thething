import { describe, it, expect } from 'vitest';
import { resolveModelForAgent, MODEL_MAPPING } from '../model-resolver';
import type { AgentDefinition, AgentExecutionContext, LanguageModel } from '../types';

// Helper: extract modelId from a LanguageModel result (test-only)
function getModelId(model: LanguageModel): string {
  if (typeof model === 'string') return model;
  return model.modelId;
}

describe('subagents/model-resolver', () => {
  // Create mock LanguageModel - use `as unknown as` to avoid union type issues
  const createMockModel = (modelId: string): LanguageModel => ({
    modelId,
    provider: 'test',
    specificationVersion: 'v1',
    supportedUrls: {},
    doGenerate: async () => ({ raw: {}, text: '', usage: {} }),
    doStream: async () => ({} as any),
  } as unknown as LanguageModel);

  // Create mock provider function
  const createMockProvider = () => (modelName: string): LanguageModel => createMockModel(modelName);

  // Create mock execution context
  const createMockContext = (overrides?: Partial<AgentExecutionContext>): AgentExecutionContext => ({
    parentTools: {},
    parentModel: createMockModel('parent-model'),
    parentSystemPrompt: '',
    parentMessages: [],
    writerRef: { current: null },
    abortSignal: new AbortController().signal,
    toolCallId: 'test',
    recursionDepth: 0,
    provider: createMockProvider(),
    ...overrides,
  });

  describe('MODEL_MAPPING', () => {
    it('should have fast and smart model mappings', () => {
      expect(MODEL_MAPPING.fast).toBeDefined();
      expect(MODEL_MAPPING.smart).toBeDefined();
    });
  });

  describe('resolveModelForAgent', () => {
    describe('inherit behavior', () => {
      it('should return parent model when model is not specified', () => {
        const definition: AgentDefinition = {
          agentType: 'test',
          description: 'Test agent',
          instructions: 'Test instructions',
          source: 'builtin',
        };
        const context = createMockContext();

        const result = resolveModelForAgent(definition, context);

        expect(getModelId(result)).toBe('parent-model');
      });

      it('should return parent model when model is "inherit"', () => {
        const definition: AgentDefinition = {
          agentType: 'test',
          description: 'Test',
          instructions: 'Test',
          model: 'inherit',
          source: 'builtin',
        };
        const context = createMockContext();

        const result = resolveModelForAgent(definition, context);

        expect(getModelId(result)).toBe('parent-model');
      });
    });

    describe('LanguageModel object', () => {
      it('should return the model object if definition.model is a LanguageModel', () => {
        const customModel = createMockModel('custom-model');
        const definition: AgentDefinition = {
          agentType: 'test',
          description: 'Test',
          instructions: 'Test',
          model: customModel,
          source: 'builtin',
        };
        const context = createMockContext();

        const result = resolveModelForAgent(definition, context);

        expect(getModelId(result)).toBe('custom-model');
      });
    });

    describe('model shortcuts', () => {
      it('should resolve "fast" to fast model via provider', () => {
        const definition: AgentDefinition = {
          agentType: 'test',
          description: 'Test',
          instructions: 'Test',
          model: 'fast',
          source: 'builtin',
        };
        const context = createMockContext();

        const result = resolveModelForAgent(definition, context);

        expect(getModelId(result)).toBe(MODEL_MAPPING.fast);
      });

      it('should resolve "smart" to smart model via provider', () => {
        const definition: AgentDefinition = {
          agentType: 'test',
          description: 'Test',
          instructions: 'Test',
          model: 'smart',
          source: 'builtin',
        };
        const context = createMockContext();

        const result = resolveModelForAgent(definition, context);

        expect(getModelId(result)).toBe(MODEL_MAPPING.smart);
      });
    });

    describe('specific model name', () => {
      it('should resolve specific model name via provider', () => {
        const definition: AgentDefinition = {
          agentType: 'test',
          description: 'Test',
          instructions: 'Test',
          model: 'claude-3-opus',
          source: 'builtin',
        };
        const context = createMockContext();

        const result = resolveModelForAgent(definition, context);

        expect(getModelId(result)).toBe('claude-3-opus');
      });
    });

    describe('provider fallback', () => {
      it('should fallback to parent model when provider is missing for "fast"', () => {
        const definition: AgentDefinition = {
          agentType: 'test',
          description: 'Test',
          instructions: 'Test',
          model: 'fast',
          source: 'builtin',
        };
        const context = createMockContext({ provider: undefined });

        const result = resolveModelForAgent(definition, context);

        expect(getModelId(result)).toBe('parent-model');
      });

      it('should fallback to parent model when provider is missing for "smart"', () => {
        const definition: AgentDefinition = {
          agentType: 'test',
          description: 'Test',
          instructions: 'Test',
          model: 'smart',
          source: 'builtin',
        };
        const context = createMockContext({ provider: undefined });

        const result = resolveModelForAgent(definition, context);

        expect(getModelId(result)).toBe('parent-model');
      });

      it('should fallback to parent model when provider is missing for specific model', () => {
        const definition: AgentDefinition = {
          agentType: 'test',
          description: 'Test',
          instructions: 'Test',
          model: 'some-model',
          source: 'builtin',
        };
        const context = createMockContext({ provider: undefined });

        const result = resolveModelForAgent(definition, context);

        expect(getModelId(result)).toBe('parent-model');
      });
    });

    describe('priority order', () => {
      it('should prioritize LanguageModel object over parent', () => {
        const customModel = createMockModel('explicit-model');
        const definition: AgentDefinition = {
          agentType: 'test',
          description: 'Test',
          instructions: 'Test',
          model: customModel,
          source: 'builtin',
        };
        const context = createMockContext();

        const result = resolveModelForAgent(definition, context);

        // Should use the explicit LanguageModel, not parent
        expect(getModelId(result)).toBe('explicit-model');
      });

      it('should use provider for "fast" even when parent model exists', () => {
        const definition: AgentDefinition = {
          agentType: 'test',
          description: 'Test',
          instructions: 'Test',
          model: 'fast',
          source: 'builtin',
        };
        const context = createMockContext();

        const result = resolveModelForAgent(definition, context);

        // Should use fast model, not parent
        expect(getModelId(result)).toBe(MODEL_MAPPING.fast);
        expect(getModelId(result)).not.toBe('parent-model');
      });
    });
  });
});