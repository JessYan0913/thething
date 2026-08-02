import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock createOpenAICompatible 以捕获凭据并返回可识别的假 provider
const createCalls: { baseURL: string; apiKey: string }[] = [];
vi.mock('@ai-sdk/openai-compatible', () => ({
  createOpenAICompatible: vi.fn((opts: { baseURL: string; apiKey: string }) => {
    createCalls.push({ baseURL: opts.baseURL, apiKey: opts.apiKey });
    return (modelName: string) => ({ modelId: modelName, config: opts });
  }),
}));

import { createModelProvider } from '../provider';

describe('createModelProvider (registry)', () => {
  beforeEach(() => {
    createCalls.length = 0;
  });

  it('无 models 列表时用默认凭据(旧行为)', () => {
    const provider = createModelProvider({ apiKey: 'default-key', baseURL: 'https://default.com' });
    const model = provider('some-model') as unknown as { modelId: string; config: { apiKey: string } };
    expect(model.modelId).toBe('some-model');
    expect(createCalls).toEqual([{ baseURL: 'https://default.com', apiKey: 'default-key' }]);
  });

  it('命中 models 条目时用条目自带凭据', () => {
    const provider = createModelProvider({
      apiKey: 'default-key',
      baseURL: 'https://default.com',
      models: [
        { id: 'glm-5.2', baseURL: 'https://glm.com', apiKey: 'glm-key' },
        { id: 'ds-flash', baseURL: 'https://ark.com', apiKey: 'ark-key' },
      ],
    });

    const m1 = provider('glm-5.2') as unknown as { config: { baseURL: string; apiKey: string } };
    const m2 = provider('ds-flash') as unknown as { config: { baseURL: string; apiKey: string } };

    expect(m1.config).toMatchObject({ baseURL: 'https://glm.com', apiKey: 'glm-key' });
    expect(m2.config).toMatchObject({ baseURL: 'https://ark.com', apiKey: 'ark-key' });
  });

  it('未命中条目回落默认凭据,不抛错', () => {
    const provider = createModelProvider({
      apiKey: 'default-key',
      baseURL: 'https://default.com',
      models: [{ id: 'glm-5.2', baseURL: 'https://glm.com', apiKey: 'glm-key' }],
    });
    const model = provider('unknown-model') as unknown as { config: { baseURL: string } };
    expect(model.config.baseURL).toBe('https://default.com');
  });

  it('相同凭据的 provider 实例被缓存复用', () => {
    const provider = createModelProvider({
      apiKey: 'default-key',
      baseURL: 'https://default.com',
      models: [
        { id: 'a-model', baseURL: 'https://same.com', apiKey: 'same-key' },
        { id: 'b-model', baseURL: 'https://same.com', apiKey: 'same-key' },
      ],
    });
    provider('a-model');
    provider('b-model');
    provider('a-model');
    // 同凭据只创建一次
    expect(createCalls).toHaveLength(1);
  });
});
