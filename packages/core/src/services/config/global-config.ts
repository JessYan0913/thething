import fs from 'fs'
import path from 'path'

import type { ModelAliases } from '../model';

export interface GlobalConfig {
  apiKey?: string
  baseURL?: string
  /** 模型别名映射（default 用作默认模型） */
  modelAliases?: Partial<ModelAliases>
}

const DOT_AGENTS_MODELS_FILENAME = 'models.json'

/**
 * 获取 ~/.agents/models.json 路径（Dot Agents 协议标准）
 */
function getDotAgentsModelsPath(configDir?: string): string {
  if (!configDir) return '';
  const homeDir = path.dirname(configDir);
  return path.join(homeDir, '.agents', DOT_AGENTS_MODELS_FILENAME);
}

function ensureDir(dir: string): void {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }
}

/**
 * 加载模型配置（Dot Agents 协议：.agents/models.json）
 *
 * 优先级：项目级 ././.agents/models.json > 用户级 ~/.agents/models.json
 */
export function loadGlobalConfig(configDir?: string, cwd?: string): GlobalConfig | null {
  const resolvedCwd = cwd ?? process.cwd();

  // 项目级优先，用户级次之
  const candidates: string[] = [
    path.join(resolvedCwd, '.agents', DOT_AGENTS_MODELS_FILENAME),
  ];

  const userModelsPath = getDotAgentsModelsPath(configDir);
  if (userModelsPath) candidates.push(userModelsPath);

  for (const candidate of candidates) {
    if (!fs.existsSync(candidate)) continue;
    try {
      const content = fs.readFileSync(candidate, 'utf-8');
      return JSON.parse(content) as GlobalConfig;
    } catch {
      // 解析失败，尝试下一个候选项
    }
  }

  return null;
}

/**
 * 保存模型配置到用户级 .agents/models.json
 */
export function saveGlobalConfig(config: GlobalConfig, configDir?: string): void {
  const modelsPath = getDotAgentsModelsPath(configDir);
  if (!modelsPath) return;
  ensureDir(path.dirname(modelsPath));
  fs.writeFileSync(modelsPath, JSON.stringify(config, null, 2))
}

/**
 * 获取用户级 .agents/models.json 路径
 */
export function getGlobalConfigPath(configDir?: string): string {
  return getDotAgentsModelsPath(configDir)
}
