import type { ModelMessage } from 'ai';
import { resolveModelAlias } from '../../extensions/subagents/model-resolver';

export interface ModelProvider {
  id: string;
  name: string;
  costMultiplier: number;
  capabilityTier: number;
}

export interface ModelSwitchConfig {
  availableModels: ModelProvider[];
  currentModel: string;
  autoDowngradeCostThreshold?: number;
  notifyOnSwitch?: boolean;
  /** 模型别名映射（来自 BehaviorConfig.modelAliases） */
  modelAliases?: { fast: string; smart: string; default: string };
}

export interface ModelSwitchResult {
  switched: boolean;
  newModel?: string;
  reason?: string;
  notification?: string;
}

const SWITCH_KEYWORDS = [
  '切换模型',
  '切换模型到',
  '换成',
  '使用',
  '用',
  '换',
  'switch to',
  'use model',
  'change model',
];

const ALIAS_KEYWORDS = ['fast', 'smart', 'default'];

export function detectModelSwitchIntent(messages: ModelMessage[], availableModels: ModelProvider[], modelAliases?: { fast: string; smart: string; default: string }): string | null {
  const lastUserMessage = [...messages].reverse().find((m) => m.role === 'user');

  if (!lastUserMessage) return null;

  const content = extractMessageText(lastUserMessage).toLowerCase();

  for (const keyword of SWITCH_KEYWORDS) {
    if (content.includes(keyword.toLowerCase())) {
      const keywordIndex = content.indexOf(keyword.toLowerCase());
      const afterKeyword = content.slice(keywordIndex + keyword.length).trim();

      // 1. Check alias keywords first (fast / smart / default)
      for (const alias of ALIAS_KEYWORDS) {
        if (afterKeyword === alias || afterKeyword.startsWith(alias)) {
          const resolved = resolveModelAlias(alias, modelAliases);
          // Verify resolved model is in availableModels
          const match = availableModels.find(m => m.id.toLowerCase() === resolved.toLowerCase());
          if (match && match.id !== currentModel) {
            return match.id;
          }
        }
      }

      // 2. Check concrete model IDs and names
      for (const model of availableModels) {
        const modelId = model.id.toLowerCase();
        const modelName = model.name.toLowerCase();

        if (afterKeyword.includes(modelId) || afterKeyword.includes(modelName)) {
          if (model.id !== currentModel) {
            return model.id;
          }
        }
      }

      break;
    }
  }

  return null;
}

let currentModel = '';

export function setCurrentModel(model: string): void {
  currentModel = model;
}

function extractMessageText(message: ModelMessage): string {
  if (typeof message.content === 'string') {
    return message.content;
  }

  if (Array.isArray(message.content)) {
    return message.content
      .filter((p: { type: string }) => p.type === 'text')
      .map((p: { type: string; text?: string }) => p.text ?? '')
      .join(' ');
  }

  return '';
}

export class ModelSwapper {
  private _config: ModelSwitchConfig;
  private _currentModel: string;
  private _switchHistory: { from: string; to: string; reason: string; timestamp: number }[] = [];

  constructor(config: ModelSwitchConfig) {
    this._config = config;
    this._currentModel = config.currentModel;
    currentModel = config.currentModel;
  }

  checkUserIntent(messages: ModelMessage[]): ModelSwitchResult {
    const targetModel = detectModelSwitchIntent(messages, this._config.availableModels, this._config.modelAliases);

    if (!targetModel) {
      return { switched: false };
    }

    const target = this._config.availableModels.find((m) => m.id === targetModel);

    if (!target) {
      return { switched: false, reason: `Model "${targetModel}" not available` };
    }

    return this._performSwitch(targetModel, 'user-request');
  }

  checkCostBudget(currentCostPercent: number): ModelSwitchResult {
    const threshold = this._config.autoDowngradeCostThreshold ?? 80;

    if (currentCostPercent < threshold) {
      return { switched: false };
    }

    const current = this._config.availableModels.find((m) => m.id === this._currentModel);

    if (!current) return { switched: false };

    const cheaperModels = this._config.availableModels
      .filter((m) => m.costMultiplier < current.costMultiplier)
      .sort((a, b) => a.costMultiplier - b.costMultiplier);

    if (cheaperModels.length === 0) {
      return { switched: false, reason: 'No cheaper model available' };
    }

    const target = cheaperModels[0];

    return this._performSwitch(target.id, `cost-budget ${currentCostPercent.toFixed(0)}%`);
  }

  checkTaskComplexity(complexityScore: number): ModelSwitchResult {
    if (complexityScore < 70) {
      return { switched: false };
    }

    const current = this._config.availableModels.find((m) => m.id === this._currentModel);

    if (!current) return { switched: false };

    const betterModels = this._config.availableModels
      .filter((m) => m.capabilityTier > current.capabilityTier)
      .sort((a, b) => b.capabilityTier - a.capabilityTier);

    if (betterModels.length === 0) {
      return { switched: false, reason: 'No more capable model available' };
    }

    const target = betterModels[0];

    return this._performSwitch(target.id, `task-complexity ${complexityScore}`);
  }

  private _performSwitch(targetModel: string, reason: string): ModelSwitchResult {
    if (targetModel === this._currentModel) {
      return { switched: false };
    }

    const target = this._config.availableModels.find((m) => m.id === targetModel);

    if (!target) {
      return { switched: false, reason: `Model "${targetModel}" not found` };
    }

    const previousModel = this._currentModel;
    this._currentModel = targetModel;
    currentModel = targetModel;

    this._switchHistory.push({
      from: previousModel,
      to: targetModel,
      reason,
      timestamp: Date.now(),
    });

    const notification = this._config.notifyOnSwitch
      ? `🔄 模型已切换：${previousModel} → ${target.name}（原因：${reason}）`
      : undefined;

    return {
      switched: true,
      newModel: targetModel,
      reason,
      notification,
    };
  }

  getCurrentModel(): string {
    return this._currentModel;
  }

  getSwitchHistory(): typeof this._switchHistory {
    return [...this._switchHistory];
  }

  getCurrentModelInfo(): ModelProvider | undefined {
    return this._config.availableModels.find((m) => m.id === this._currentModel);
  }
}

export { currentModel as getCurrentModelRaw };