import { DEFAULT_MODEL_ALIASES } from '../config/behavior';

export { DEFAULT_MODEL_ALIASES as MODEL_MAPPING };

export type ModelAliases = { fast: string; smart: string; default: string };

export function resolveModelAlias(modelName: string, aliases?: ModelAliases): string {
  if (modelName === 'fast') return aliases?.fast ?? DEFAULT_MODEL_ALIASES.fast;
  if (modelName === 'smart') return aliases?.smart ?? DEFAULT_MODEL_ALIASES.smart;
  if (modelName === 'default') return aliases?.default ?? DEFAULT_MODEL_ALIASES.default;
  return modelName;
}
