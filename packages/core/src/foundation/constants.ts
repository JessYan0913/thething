// ============================================================
// Foundation Constants - 纯技术常量
// ============================================================
// 本文件包含不依赖任何业务层的基础技术常量。
// 这些常量的共同特征：
// - 不涉及用户业务决策
// - 不因部署环境而改变
// - 被 foundation 层自身使用
//
// 注意：业务配置默认值（如预算上限、压缩策略等）
// 保留在 config/defaults.ts 中。本文件只放纯技术常量。
// ============================================================

// ============================================================
// Token 计算常量
// ============================================================

/** Bytes per Token 估算 */
export const BYTES_PER_TOKEN = 4;

// ============================================================
// 命名常量
// ============================================================

/**
 * 默认项目配置目录名称
 *
 * 这是纯命名常量，不涉及业务逻辑。
 * 业务层可通过 resolveLayout() 覆盖此值。
 */
export const DEFAULT_PROJECT_CONFIG_DIR_NAME = '.thething';

/** Tokenizer 缓存目录名称 */
export const TOKENIZER_CACHE_DIR_NAME = 'tokenizers';

/** 自动压缩缓冲区（参考 Claude Code: 13,000） */
export const AUTOCOMPACT_BUFFER_TOKENS = 13_000;

// ============================================================
// Tokenizer 远程加载配置
// ============================================================

/** HuggingFace 镜像基础地址（国内） */
export const HF_MIRROR_BASE_URL = 'https://hf-mirror.com';

/** HuggingFace 官方地址 */
export const HF_OFFICIAL_BASE_URL = 'https://huggingface.co';

/**
 * 模型名称到 HuggingFace repo 的映射
 *
 * 格式: { modelNamePattern: { org, repo, variant } }
 * - modelNamePattern: 模型名称匹配模式（小写）
 * - org: HuggingFace 组织名
 * - repo: 仓库基础名称
 * - variant: 变体后缀（如 -Instruct）
 */
export const MODEL_TO_HF_REPO_MAPPING: Record<string, { org: string; repo: string; variant?: string }> = {
  // Qwen 系列
  'qwen2.5': { org: 'Qwen', repo: 'Qwen2.5-7B', variant: 'Instruct' },
  'qwen3': { org: 'Qwen', repo: 'Qwen2.5-7B', variant: 'Instruct' },
  'qwen3.5': { org: 'Qwen', repo: 'Qwen2.5-7B', variant: 'Instruct' },
  'qwen3.6': { org: 'Qwen', repo: 'Qwen2.5-7B', variant: 'Instruct' },
  'qwen-max': { org: 'Qwen', repo: 'Qwen2.5-7B', variant: 'Instruct' },
  'qwen-plus': { org: 'Qwen', repo: 'Qwen2.5-7B', variant: 'Instruct' },
  'qwen-turbo': { org: 'Qwen', repo: 'Qwen2.5-7B', variant: 'Instruct' },

  // GLM 系列
  'glm': { org: 'Qwen', repo: 'Qwen2.5-7B', variant: 'Instruct' },
  'glm-4': { org: 'Qwen', repo: 'Qwen2.5-7B', variant: 'Instruct' },
  'glm-5': { org: 'Qwen', repo: 'Qwen2.5-7B', variant: 'Instruct' },
  'chatglm': { org: 'Qwen', repo: 'Qwen2.5-7B', variant: 'Instruct' },
  'chatglm3': { org: 'Qwen', repo: 'Qwen2.5-7B', variant: 'Instruct' },

  // DeepSeek 系列
  'deepseek': { org: 'deepseek-ai', repo: 'deepseek-llm-7b', variant: 'chat' },
  'deepseek-v3': { org: 'deepseek-ai', repo: 'DeepSeek-V3' },

  // Llama 系列
  'llama': { org: 'meta-llama', repo: 'Llama-2-7b', variant: 'chat-hf' },
  'llama3': { org: 'meta-llama', repo: 'Llama-3.1-8B', variant: 'Instruct' },
};

/** 默认 tokenizer repo（未知模型时使用） */
export const DEFAULT_TOKENIZER_REPO = { org: 'Qwen', repo: 'Qwen2.5-7B', variant: 'Instruct' };
