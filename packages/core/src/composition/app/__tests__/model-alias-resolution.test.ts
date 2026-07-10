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
import { resolveModelAlias } from '../../../services/model';
import { detectModelSwitchIntent, ModelSwapper, type ModelProvider } from '../../../modules/session/model-switching';
import { buildBehaviorConfig } from '../../../services/config/behavior';
import { createLanguageModel } from '../../../services/model';

// ============================================================
// 1. fast/smart/default 别名能被稳定解析成真实模型
// ============================================================

describe('1. Alias keywords resolve to real model IDs', () => {
  const customAliases = { fast: { model: 'gpt-4o-mini' }, smart: { model: 'gpt-4o' }, default: { model: 'gpt-4o' } };

  it('resolves "fast" to provided alias', () => {
    expect(resolveModelAlias('fast', customAliases)).toBe('gpt-4o-mini');
  });

  it('resolves "smart" to provided alias', () => {
    expect(resolveModelAlias('smart', customAliases)).toBe('gpt-4o');
  });

  it('resolves "default" to provided alias', () => {
    expect(resolveModelAlias('default', customAliases)).toBe('gpt-4o');
  });

  it('resolves custom aliases when provided', () => {
    const aliases = { fast: { model: 'gpt-4o-mini' }, smart: { model: 'gpt-4o' }, default: { model: 'gpt-4o-mini' } };
    expect(resolveModelAlias('fast', aliases)).toBe('gpt-4o-mini');
    expect(resolveModelAlias('smart', aliases)).toBe('gpt-4o');
    expect(resolveModelAlias('default', aliases)).toBe('gpt-4o-mini');
  });

  it('returns empty string for missing aliases', () => {
    const aliases = { fast: { model: 'gpt-4o-mini' }, smart: { model: '' }, default: { model: '' } };
    expect(resolveModelAlias('fast', aliases)).toBe('gpt-4o-mini');
    expect(resolveModelAlias('smart', aliases)).toBe('');
    expect(resolveModelAlias('default', aliases)).toBe('');
  });
});

// ============================================================
// 2. 所有模型选择点使用同一套解析逻辑
// ============================================================

describe('2. All model selection points use unified alias resolution', () => {
  it('createLanguageModel throws when modelName is not provided', () => {
    expect(() => createLanguageModel({
      apiKey: 'test-key',
      baseURL: 'https://test.example',
    })).toThrow('modelName is required but was not provided');
  });

  it('BehaviorConfig.modelAliases uses provided values', () => {
    const behavior = buildBehaviorConfig({
      modelAliases: { fast: { model: 'gpt-4o-mini' }, smart: { model: 'gpt-4o' }, default: { model: 'gpt-4o' } },
    });
    expect(behavior.modelAliases.fast).toBe('gpt-4o-mini');
    expect(behavior.modelAliases.smart).toBe('gpt-4o');
    expect(behavior.modelAliases.default).toBe('gpt-4o');
  });

  it('custom modelAliases override defaults in BehaviorConfig', () => {
    const behavior = buildBehaviorConfig({
      modelAliases: { fast: { model: 'gpt-4o-mini' }, smart: { model: 'gpt-4o' }, default: { model: 'gpt-4o-mini' } },
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
    const customAliases = { fast: { model: 'gpt-4o-mini' }, smart: { model: 'gpt-4o' }, default: { model: 'gpt-4o-mini-2' } };

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

    it('returns no switch when modelAliases not provided', () => {
      const swapper = new ModelSwapper({
        availableModels,
        currentModel: 'gpt-4o',
      });
      const result = swapper.checkUserIntent(
        [{ role: 'user', content: '使用 fast' }] as any,
      );
      expect(result.switched).toBe(false);
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
      { id: 'gpt-4o', name: 'GPT-4o', costMultiplier: 1.0, capabilityTier: 3 },
    ];
    const swapper = new ModelSwapper({
      availableModels: models,
      currentModel: 'gpt-4o',
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
      modelAliases: { fast: { model: 'other-model' }, smart: { model: 'another-model' }, default: { model: 'third-model' } },
    });
    // "fast" resolves to 'other-model' but that model isn't in availableModels
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
  it('resolveModelAlias returns empty string when no aliases provided', () => {
    expect(resolveModelAlias('fast', undefined)).toBe('');
    expect(resolveModelAlias('smart', undefined)).toBe('');
    expect(resolveModelAlias('default', undefined)).toBe('');
  });

  it('createLanguageModel throws when modelName omitted', () => {
    expect(() => createLanguageModel({
      apiKey: 'test-key',
      baseURL: 'https://test.example',
    })).toThrow('modelName is required but was not provided');
  });
});
