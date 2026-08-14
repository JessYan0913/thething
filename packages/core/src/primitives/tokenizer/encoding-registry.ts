// ============================================================
// Encoding Registry - 模型 → tokenizer encoding 三级映射
// ============================================================
// 估算地基（见 docs/compaction-redesign.md L0）：
// 1. 精确：GPT 系列 → o200k_base / cl100k_base（js-tiktoken BPE，与训练词表一致）
// 2. 近似：Qwen/DeepSeek/Claude/GLM/Llama 已知模型族 → cl100k_base
//    （企业自研 BPE 在 js-tiktoken 无精确项，cl100k 是最接近的公开近似，
//     系统性偏差交给 usage-calibrator 收敛）
// 3. 字符：未知模型 → null（回退 primitives/token-estimate 字符估算）
//
// 只做前缀匹配，不硬编码具体模型版本——新增模型若前缀命中即可复用规则。

export type EncodingLevel = 'exact' | 'approximate' | 'char';

export interface EncodingResolution {
  level: EncodingLevel;
  /** js-tiktoken 的 encoding 名；level === 'char' 时为 null */
  encoding: string | null;
}

interface EncodingRule {
  level: EncodingLevel;
  encoding?: string;
}

/** 按模型名前缀的映射表（key 为前缀；匹配时按 key 长度降序，避免 'gpt-4' 先截胡 'gpt-4o'） */
const MODEL_ENCODING_MAP: Record<string, EncodingRule> = {
  // ── 精确：OpenAI GPT / o 系列 ──
  'gpt-4o': { level: 'exact', encoding: 'o200k_base' },
  'gpt-4.1': { level: 'exact', encoding: 'o200k_base' },
  'gpt-5': { level: 'exact', encoding: 'o200k_base' },
  'gpt-4': { level: 'exact', encoding: 'cl100k_base' },
  'gpt-3': { level: 'exact', encoding: 'cl100k_base' },
  'o4': { level: 'exact', encoding: 'o200k_base' },
  'o3': { level: 'exact', encoding: 'o200k_base' },
  'o1': { level: 'exact', encoding: 'o200k_base' },
  'openai-': { level: 'exact', encoding: 'o200k_base' },

  // ── 近似：已知模型族 → cl100k_base（偏差靠 usage 校准） ──
  'deepseek': { level: 'approximate', encoding: 'cl100k_base' },
  'glm': { level: 'approximate', encoding: 'cl100k_base' },
  'kimi': { level: 'approximate', encoding: 'cl100k_base' },
  'moonshot': { level: 'approximate', encoding: 'cl100k_base' },
  'qwen': { level: 'approximate', encoding: 'cl100k_base' },
  'llama': { level: 'approximate', encoding: 'cl100k_base' },
  'claude': { level: 'approximate', encoding: 'cl100k_base' },
  'nvidia': { level: 'approximate', encoding: 'cl100k_base' },
};

/**
 * 解析模型对应的 encoding 级别。
 *
 * @param modelName 模型名（可含供应商前缀，如 "deepseek-v4-pro"）
 */
export function resolveEncoding(modelName?: string): EncodingResolution {
  if (!modelName) return { level: 'char', encoding: null };
  const lower = modelName.toLowerCase();

  // 按 key 长度降序匹配前缀（长 key 优先，避免 gpt-4 先截胡 gpt-4o）
  const keys = Object.keys(MODEL_ENCODING_MAP).sort((a, b) => b.length - a.length);
  for (const key of keys) {
    if (lower.startsWith(key)) {
      const rule = MODEL_ENCODING_MAP[key];
      return { level: rule.level, encoding: rule.encoding ?? null };
    }
  }
  return { level: 'char', encoding: null };
}

/** 快捷：获取模型估算级别（供预算 buffer 比率选择，见 compaction-redesign L1） */
export function getEncodingLevel(modelName?: string): EncodingLevel {
  return resolveEncoding(modelName).level;
}

/** 快捷：已知模型族（exact/approximate 均视为"已知"） */
export function isKnownModel(modelName?: string): boolean {
  return resolveEncoding(modelName).level !== 'char';
}
