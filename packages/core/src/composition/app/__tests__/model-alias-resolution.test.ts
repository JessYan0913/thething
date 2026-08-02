// ============================================================
// Model Alias Resolution Behavior Tests
// ============================================================
// 验收清单：
// 1. fast/smart/default 别名能被稳定解析成真实模型
// 2. 语义收敛:isInheritAlias / buildModelAliases(见 docs/model-config-redesign.md)
// 3. 未知别名不会产生静默错误映射
// 4. 单测覆盖别名命中和回退场景
// ============================================================

import { describe, expect, it } from 'vitest';
import { resolveModelAlias, isInheritAlias, buildModelAliases } from '../../../services/model';
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

  it('returns empty string for missing aliases', () => {
    const aliases = { fast: { model: 'gpt-4o-mini' }, smart: { model: '' }, default: { model: '' } };
    expect(resolveModelAlias('fast', aliases)).toBe('gpt-4o-mini');
    expect(resolveModelAlias('smart', aliases)).toBe('');
    expect(resolveModelAlias('default', aliases)).toBe('');
  });
});

// ============================================================
// 2. 语义收敛:isInheritAlias / buildModelAliases
// ============================================================

describe('2. Two-tier semantics (main model + background model)', () => {
  it('isInheritAlias treats smart/default/inherit/undefined as "follow main model"', () => {
    expect(isInheritAlias(undefined)).toBe(true);
    expect(isInheritAlias('inherit')).toBe(true);
    expect(isInheritAlias('smart')).toBe(true);
    expect(isInheritAlias('default')).toBe(true);
  });

  it('isInheritAlias treats fast and concrete names as overrides', () => {
    expect(isInheritAlias('fast')).toBe(false);
    expect(isInheritAlias('gpt-4o')).toBe(false);
  });

  it('buildModelAliases maps fast to backgroundModel', () => {
    const aliases = buildModelAliases({
      defaultModel: 'big-model',
      backgroundModel: 'small-model',
      backgroundContextLimit: 128_000,
    });
    expect(aliases.fast).toEqual({ model: 'small-model', contextLimit: 128_000 });
    expect(aliases.smart.model).toBe('big-model');
    expect(aliases.default.model).toBe('big-model');
  });

  it('buildModelAliases falls back fast to main model when no backgroundModel', () => {
    const aliases = buildModelAliases({ defaultModel: 'big-model' });
    expect(aliases.fast.model).toBe('big-model');
    expect(aliases.smart.model).toBe('big-model');
    expect(aliases.default.model).toBe('big-model');
  });

  it('BehaviorConfig.modelAliases uses provided values', () => {
    const behavior = buildBehaviorConfig({
      modelAliases: { fast: { model: 'gpt-4o-mini' }, smart: { model: 'gpt-4o' }, default: { model: 'gpt-4o' } },
    });
    expect(behavior.modelAliases.fast.model).toBe('gpt-4o-mini');
    expect(behavior.modelAliases.smart.model).toBe('gpt-4o');
    expect(behavior.modelAliases.default.model).toBe('gpt-4o');
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
});

// ============================================================
// 4. 回退场景测试
// ============================================================

describe('4. Fallback scenarios', () => {
  it('resolveModelAlias returns the keyword unchanged when no aliases provided', () => {
    // 无 aliases 时,关键词原样返回(由调用方决定如何处理)
    expect(resolveModelAlias('fast', undefined)).toBe('fast');
    expect(resolveModelAlias('smart', undefined)).toBe('smart');
    expect(resolveModelAlias('default', undefined)).toBe('default');
  });

  it('createLanguageModel throws when modelName omitted', () => {
    expect(() => createLanguageModel({
      apiKey: 'test-key',
      baseURL: 'https://test.example',
    })).toThrow('modelName is required but was not provided');
  });
});
