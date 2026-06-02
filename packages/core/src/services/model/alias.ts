export type ModelAliases = {
  fast: { model: string; contextLimit?: number };
  smart: { model: string; contextLimit?: number };
  default: { model: string; contextLimit?: number };
};

export function resolveModelAlias(modelName: string, aliases?: ModelAliases): string {
  if (modelName === 'fast') return aliases?.fast?.model ?? '';
  if (modelName === 'smart') return aliases?.smart?.model ?? '';
  if (modelName === 'default') return aliases?.default?.model ?? '';
  return modelName;
}
