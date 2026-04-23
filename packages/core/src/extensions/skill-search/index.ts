/**
 * Skill Search 模块入口
 *
 * 提供 TF-IDF 技能搜索功能：
 * - 分词 (CJK bigram + 英文单词)
 * - 词干提取 (简化版)
 * - TF-IDF 索引构建
 * - 余弦相似度搜索
 */

export {
  tokenize,
  tokenizeAndStem,
  tokenizeBatch,
  mergeTokens,
  stem,
  isCjk,
} from './tokenizer';

export {
  buildSkillIndex,
  computeIdf,
  getSkillIndexCache,
  setSkillIndexCache,
  clearSkillIndexCache,
  hasIndexCache,
  getIndexCacheSize,
  FIELD_WEIGHT,
} from './tfidf-index';

export type { SkillIndexEntry } from './tfidf-index';

export {
  searchSkills,
  batchSearchSkills,
  DEFAULT_SEARCH_OPTIONS,
} from './search';

export type { SearchResult, SearchOptions } from './search';

export const SKILL_SEARCH_MODULE_VERSION = '1.0.0';