export type ModelAliases = { fast: string; smart: string; default: string };

export function resolveModelAlias(modelName: string, aliases?: ModelAliases): string {
  if (modelName === 'fast') return aliases?.fast ?? '';
  if (modelName === 'smart') return aliases?.smart ?? '';
  if (modelName === 'default') return aliases?.default ?? '';
  return modelName;
}
