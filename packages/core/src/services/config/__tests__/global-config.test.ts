import { describe, it, expect } from 'vitest';
import { normalizeGlobalConfig, type GlobalConfig } from '../global-config';

describe('normalizeGlobalConfig', () => {
  it('v3 providers 格式:派生摊平 models 视图', () => {
    const config: GlobalConfig = {
      providers: [
        {
          name: '智谱',
          baseURL: 'https://glm.com',
          apiKey: 'glm-key',
          models: [{ id: 'glm-5.2', contextLimit: 200000 }, { id: 'glm-5-air' }],
        },
        {
          name: '火山',
          baseURL: 'https://ark.com',
          apiKey: 'ark-key',
          models: [{ id: 'deepseek-v4-flash' }],
        },
      ],
      defaultModel: 'glm-5.2',
      backgroundModel: 'deepseek-v4-flash',
    };
    const result = normalizeGlobalConfig(config);
    expect(result.models).toEqual([
      { id: 'glm-5.2', baseURL: 'https://glm.com', apiKey: 'glm-key', contextLimit: 200000 },
      { id: 'glm-5-air', baseURL: 'https://glm.com', apiKey: 'glm-key', contextLimit: undefined },
      { id: 'deepseek-v4-flash', baseURL: 'https://ark.com', apiKey: 'ark-key', contextLimit: undefined },
    ]);
    expect(result.providers).toHaveLength(2);
    expect(result.defaultModel).toBe('glm-5.2');
    expect(result.backgroundModel).toBe('deepseek-v4-flash');
  });

  it('v2 摊平 models 格式:按凭据聚合成 providers', () => {
    const config: GlobalConfig = {
      models: [
        { id: 'a-model', baseURL: 'https://same.com', apiKey: 'same-key' },
        { id: 'b-model', baseURL: 'https://same.com', apiKey: 'same-key', contextLimit: 128000 },
        { id: 'c-model', baseURL: 'https://other.com', apiKey: 'other-key' },
      ],
      defaultModel: 'a-model',
    };
    const result = normalizeGlobalConfig(config);
    expect(result.providers).toHaveLength(2);
    const same = result.providers!.find(p => p.baseURL === 'https://same.com')!;
    expect(same.models.map(m => m.id)).toEqual(['a-model', 'b-model']);
    expect(same.models[1].contextLimit).toBe(128000);
    expect(result.models).toHaveLength(3);
    expect(result.defaultModel).toBe('a-model');
  });

  it('v1 旧格式:三别名去重收集,凭据升为单 provider', () => {
    const legacy: GlobalConfig = {
      apiKey: 'ark-key',
      baseURL: 'https://ark.example.com/v3',
      modelAliases: {
        fast: { model: 'deepseek-v4-flash' },
        smart: { model: 'glm-5.2', contextLimit: 200000 },
        default: { model: 'deepseek-v4-flash' },
      },
    };
    const result = normalizeGlobalConfig(legacy);
    expect(result.providers).toHaveLength(1);
    expect(result.providers![0].apiKey).toBe('ark-key');
    expect(result.providers![0].models.map(m => m.id).sort()).toEqual(['deepseek-v4-flash', 'glm-5.2']);
    expect(result.models).toHaveLength(2);
    expect(result.defaultModel).toBe('deepseek-v4-flash');
    // fast === default → 后台跟随主模型,不设 backgroundModel
    expect(result.backgroundModel).toBeUndefined();
  });

  it('v1 旧格式:fast 与 default 不同时设为 backgroundModel', () => {
    const legacy: GlobalConfig = {
      apiKey: 'k',
      baseURL: 'https://x.com',
      modelAliases: {
        fast: { model: 'small-model' },
        smart: { model: 'big-model' },
        default: { model: 'big-model' },
      },
    };
    const result = normalizeGlobalConfig(legacy);
    expect(result.defaultModel).toBe('big-model');
    expect(result.backgroundModel).toBe('small-model');
  });

  it('跨供应商重名模型:先出现者优先,不重复', () => {
    const config: GlobalConfig = {
      providers: [
        { name: 'A', baseURL: 'https://a.com', apiKey: 'ka', models: [{ id: 'dup-model' }] },
        { name: 'B', baseURL: 'https://b.com', apiKey: 'kb', models: [{ id: 'dup-model' }] },
      ],
      defaultModel: 'dup-model',
    };
    const result = normalizeGlobalConfig(config);
    expect(result.models).toHaveLength(1);
    expect(result.models![0].baseURL).toBe('https://a.com');
  });

  it('无别名的 v1 配置原样返回', () => {
    const legacy: GlobalConfig = { apiKey: 'k', baseURL: 'https://x.com' };
    expect(normalizeGlobalConfig(legacy)).toEqual(legacy);
  });
});
