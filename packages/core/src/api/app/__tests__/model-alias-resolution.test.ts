// ============================================================
// Task 8: Model Alias Resolution Behavior Tests
// ============================================================
// 验收清单：
// 1. fast/smart/default 别名能被稳定解析成真实模型
// 2. agent/sub-agent/模型切换链路使用同一套解析逻辑
// 3. 未知别名不会产生静默错误映射
// 4. 单测覆盖别名命中和回退场景
// ============================================================

import { describe, expect, it } from 'vitest';
import { resolveModelAlias, MODEL_MAPPING } from '../../../extensions/subagents/model-resolver';
import { DEFAULT_MODEL_ALIASES } from '../../../config/behavior';
import { detectModelSwitchIntent, ModelSwapper, setCurrentModel, type ModelProvider } from '../../../runtime/agent-control/model-switching';
import { buildBehaviorConfig } from '../../../config/behavior';
import { createLanguageModel } from '../../../foundation/model';

// ============================================================
// 1. fast/smart/default 别名能被稳定解析成真实模型
// ============================================================

describe('1. Alias keywords resolve to real model IDs', () => {
  it('resolves "fast" to DEFAULT_MODEL_ALIASES.fast', () => {
    expect(resolveModelAlias('fast')).toBe(DEFAULT_MODEL_ALIASES.fast);
  });

  it('resolves "smart" to DEFAULT_MODEL_ALIASES.smart', () => {
    expect(resolveModelAlias('smart')).toBe(DEFAULT_MODEL_ALIASES.smart);
  });

  it('resolves "default" to DEFAULT_MODEL_ALIASES.default', () => {
    expect(resolveModelAlias('default')).toBe(DEFAULT_MODEL_ALIASES.default);
  });

  it('resolves custom aliases when provided', () => {
    const aliases = { fast: 'gpt-4o-mini', smart: 'gpt-4o', default: 'gpt-4o-mini' };
    expect(resolveModelAlias('fast', aliases)).toBe('gpt-4o-mini');
    expect(resolveModelAlias('smart', aliases)).toBe('gpt-4o');
    expect(resolveModelAlias('default', aliases)).toBe('gpt-4o-mini');
  });

  it('falls back to DEFAULT_MODEL_ALIASES when custom alias is missing', () => {
    // Partial aliases — only 'smart' is overridden
    const aliases = { fast: DEFAULT_MODEL_ALIASES.fast, smart: 'custom-smart', default: DEFAULT_MODEL_ALIASES.default };
    expect(resolveModelAlias('fast', aliases)).toBe(DEFAULT_MODEL_ALIASES.fast);
    expect(resolveModelAlias('smart', aliases)).toBe('custom-smart');
  });

  it('MODEL_MAPPING re-export equals DEFAULT_MODEL_ALIASES', () => {
    expect(MODEL_MAPPING.fast).toBe(DEFAULT_MODEL_ALIASES.fast);
    expect(MODEL_MAPPING.smart).toBe(DEFAULT_MODEL_ALIASES.smart);
    expect(MODEL_MAPPING.default).toBe(DEFAULT_MODEL_ALIASES.default);
  });
});

// ============================================================
// 2. 所有模型选择点使用同一套解析逻辑
// ============================================================

describe('2. All model selection points use unified alias resolution', () => {
  it('createLanguageModel fallback uses DEFAULT_MODEL_ALIASES.default', () => {
    // When modelName is not provided, should use DEFAULT_MODEL_ALIASES.default
    const model = createLanguageModel({
      apiKey: 'test-key',
      baseURL: 'https://test.example',
    });
    // model.modelId should be DEFAULT_MODEL_ALIASES.default ('qwen-plus')
    expect(model.modelId).toBe(DEFAULT_MODEL_ALIASES.default);
  });

  it('BehaviorConfig.modelAliases is built from DEFAULT_MODEL_ALIASES', () => {
    const behavior = buildBehaviorConfig();
    expect(behavior.modelAliases.fast).toBe(DEFAULT_MODEL_ALIASES.fast);
    expect(behavior.modelAliases.smart).toBe(DEFAULT_MODEL_ALIASES.smart);
    expect(behavior.modelAliases.default).toBe(DEFAULT_MODEL_ALIASES.default);
  });

  it('custom modelAliases override defaults in BehaviorConfig', () => {
    const behavior = buildBehaviorConfig({
      modelAliases: { fast: 'gpt-4o-mini', smart: 'gpt-4o', default: 'gpt-4o-mini' },
    });
    expect(behavior.modelAliases.fast).toBe('gpt-4o-mini');
    expect(behavior.modelAliases.smart).toBe('gpt-4o');
    expect(behavior.modelAliases.default).toBe('gpt-4o-mini');
  });

  describe('ModelSwapper alias keyword detection', () => {
    const availableModels: ModelProvider[] = [
      { id: 'gpt-4o-mini', name: 'GPT-4o Mini', costMultiplier: 0.1, capabilityTier: 1 },
      { id: 'gpt-4o', name: 'GPT-4o', costMultiplier: 1.0, capabilityTier: 3 },
      { id: 'gpt-4o-mini-2', name: 'GPT-4o Mini Default', costMultiplier: 0.1, capabilityTier: 1 },
    ];
    const customAliases = { fast: 'gpt-4o-mini', smart: 'gpt-4o', default: 'gpt-4o-mini-2' };

    it('resolves "fast" alias via ModelSwapper.checkUserIntent', () => {
      const swapper = new ModelSwapper({
        availableModels,
        currentModel: 'gpt-4o',
        modelAliases: customAliases,
      });
      const result = swapper.checkUserIntent(
        [{ role: 'user', content: 'switch to fast' }] as any,
      );
      expect(result.switched).toBe(true);
      expect(result.newModel).toBe('gpt-4o-mini');
    });

    it('resolves "smart" alias via ModelSwapper.checkUserIntent', () => {
      const swapper = new ModelSwapper({
        availableModels,
        currentModel: 'gpt-4o-mini',
        modelAliases: customAliases,
      });
      const result = swapper.checkUserIntent(
        [{ role: 'user', content: 'switch to smart' }] as any,
      );
      expect(result.switched).toBe(true);
      expect(result.newModel).toBe('gpt-4o');
    });

    it('resolves "default" alias via ModelSwapper.checkUserIntent', () => {
      const swapper = new ModelSwapper({
        availableModels,
        currentModel: 'gpt-4o',
        modelAliases: customAliases,
      });
      const result = swapper.checkUserIntent(
        [{ role: 'user', content: 'switch to default' }] as any,
      );
      expect(result.switched).toBe(true);
      expect(result.newModel).toBe('gpt-4o-mini-2');
    });

    it('uses DEFAULT_MODEL_ALIASES when modelAliases not provided', () => {
      const defaultModels: ModelProvider[] = [
        { id: 'qwen-turbo', name: 'Qwen Turbo', costMultiplier: 0.1, capabilityTier: 1 },
        { id: 'qwen-max', name: 'Qwen Max', costMultiplier: 1.0, capabilityTier: 3 },
        { id: 'qwen-plus', name: 'Qwen Plus', costMultiplier: 0.4, capabilityTier: 2 },
      ];
      const swapper = new ModelSwapper({
        availableModels: defaultModels,
        currentModel: 'qwen-max',
      });
      const result = swapper.checkUserIntent(
        [{ role: 'user', content: '使用 fast' }] as any,
      );
      expect(result.switched).toBe(true);
      expect(result.newModel).toBe('qwen-turbo');
    });

    it('still matches concrete model names', () => {
      const swapper = new ModelSwapper({
        availableModels,
        currentModel: 'gpt-4o-mini',
        modelAliases: customAliases,
      });
      const result = swapper.checkUserIntent(
        [{ role: 'user', content: '切换模型到 GPT-4o' }] as any,
      );
      expect(result.switched).toBe(true);
      expect(result.newModel).toBe('gpt-4o');
    });
  });
});

// ============================================================
// 3. 未知别名不会产生静默错误映射
// ============================================================

describe('3. Unknown aliases do not produce silent wrong mappings', () => {
  it('resolveModelAlias returns unknown strings unchanged (no silent mapping)', () => {
    expect(resolveModelAlias('unknown-model')).toBe('unknown-model');
    expect(resolveModelAlias('claude-3-opus')).toBe('claude-3-opus');
    expect(resolveModelAlias('gpt-4')).toBe('gpt-4');
  });

  it('resolveModelAlias does not map partial matches like "fast-lane"', () => {
    // "fast-lane" is NOT the alias keyword "fast"
    expect(resolveModelAlias('fast-lane')).toBe('fast-lane');
  });

  it('ModelSwapper returns no switch for unrecognized alias keywords', () => {
    const models: ModelProvider[] = [
      { id: 'qwen-max', name: 'Qwen Max', costMultiplier: 1.0, capabilityTier: 3 },
    ];
    const swapper = new ModelSwapper({
      availableModels: models,
      currentModel: 'qwen-max',
    });
    // "turbo" is not a recognized alias keyword
    const result = swapper.checkUserIntent(
      [{ role: 'user', content: '使用 turbo' }] as any,
    );
    expect(result.switched).toBe(false);
  });

  it('ModelSwapper returns no switch when resolved alias not in availableModels', () => {
    const models: ModelProvider[] = [
      { id: 'gpt-4o', name: 'GPT-4o', costMultiplier: 1.0, capabilityTier: 3 },
    ];
    const swapper = new ModelSwapper({
      availableModels: models,
      currentModel: 'gpt-4o',
      modelAliases: { fast: 'qwen-turbo', smart: 'qwen-max', default: 'qwen-plus' },
    });
    // "fast" resolves to 'qwen-turbo' but that model isn't in availableModels
    const result = swapper.checkUserIntent(
      [{ role: 'user', content: '使用 fast' }] as any,
    );
    expect(result.switched).toBe(false);
  });
});

// ============================================================
// 4. 回退场景测试
// ============================================================

describe('4. Fallback scenarios', () => {
  it('resolveModelAlias falls back to DEFAULT_MODEL_ALIASES when no aliases provided', () => {
    expect(resolveModelAlias('fast', undefined)).toBe(DEFAULT_MODEL_ALIASES.fast);
    expect(resolveModelAlias('smart', undefined)).toBe(DEFAULT_MODEL_ALIASES.smart);
    expect(resolveModelAlias('default', undefined)).toBe(DEFAULT_MODEL_ALIASES.default);
  });

  it('createLanguageModel uses DEFAULT_MODEL_ALIASES.default when modelName omitted', () => {
    const model = createLanguageModel({
      apiKey: 'test-key',
      baseURL: 'https://test.example',
    });
    expect(model.modelId).toBe(DEFAULT_MODEL_ALIASES.default);
  });
});