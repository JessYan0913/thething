export type ModelAliases = {
  fast: { model: string; contextLimit?: number };
  smart: { model: string; contextLimit?: number };
  default: { model: string; contextLimit?: number };
};

/**
 * 语义收敛为两档(见 docs/model-config-redesign.md):
 * - 'fast' → 后台任务模型(backgroundModel,未配置时回落主模型)
 * - 'smart' / 'default' → 主模型(等价 inherit,由各消费点直接用父模型)
 *
 * 此函数只做名称映射;'smart'/'default' 的 inherit 语义由
 * model-resolver / skill override / agent override 各消费点实现。
 */
export function resolveModelAlias(modelName: string, aliases?: ModelAliases): string {
  if (modelName === 'fast') return aliases?.fast?.model ?? modelName;
  if (modelName === 'smart') return aliases?.smart?.model ?? modelName;
  if (modelName === 'default') return aliases?.default?.model ?? modelName;
  return modelName;
}

/**
 * 判断别名是否表示"跟随主模型"(inherit 语义)。
 * agent/skill 定义里写 'smart'/'default'/'inherit' 都视为跟随主模型。
 */
export function isInheritAlias(modelName: string | undefined): boolean {
  return !modelName || modelName === 'inherit' || modelName === 'smart' || modelName === 'default';
}

/**
 * 由新配置(defaultModel/backgroundModel)构造 ModelAliases,
 * 供 behavior 注入,保持 resolveModelAlias 消费方零改动。
 */
export function buildModelAliases(config: {
  defaultModel?: string;
  backgroundModel?: string;
  defaultContextLimit?: number;
  backgroundContextLimit?: number;
}): ModelAliases {
  const main = { model: config.defaultModel ?? '', contextLimit: config.defaultContextLimit };
  return {
    fast: config.backgroundModel
      ? { model: config.backgroundModel, contextLimit: config.backgroundContextLimit }
      : main,
    smart: main,
    default: main,
  };
}
