import path from 'path';
import os from 'os';
import { NextResponse } from 'next/server';
import {
  loadGlobalConfig,
  createLanguageModel,
  getPrimaryMemoryDir,
  extractMemoriesFromHistory,
} from '@the-thing/core';
import { getServerRuntime } from '@/lib/runtime';

export const runtime = 'nodejs';

const GLOBAL_CONFIG_DIR = path.join(os.homedir(), '.agents');

// 从全局配置取默认模型，构造用于记忆提取的 model 实例。
function createExtractionModel() {
  const config = loadGlobalConfig(GLOBAL_CONFIG_DIR);
  const entry = config?.models?.find(m => m.id === config?.defaultModel) ?? config?.models?.[0];
  if (!entry) throw new Error('No model configured');
  return createLanguageModel({
    apiKey: entry.apiKey || '',
    baseURL: entry.baseURL || '',
    modelName: config?.defaultModel || entry.id,
    models: config?.models,
  });
}

export async function POST() {
  try {
    const rt = await getServerRuntime();
    const memoryBaseDir = getPrimaryMemoryDir(rt.layout);
    const model = createExtractionModel();

    const result = await extractMemoriesFromHistory({
      memoryBaseDir,
      dataStore: rt.dataStore,
      model,
    });

    return NextResponse.json(result);
  } catch (error) {
    console.error('[Memory API] extract error:', error);
    return NextResponse.json({ error: 'Failed to extract memories' }, { status: 500 });
  }
}
