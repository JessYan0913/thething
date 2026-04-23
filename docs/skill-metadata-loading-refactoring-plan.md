# Skill 元数据加载改造方案

## 背景

当前 TheThing 项目将 skill 元数据一次性加载到系统提示词中，存在以下问题：

1. **破坏 Prompt Cache** - skill 列表变化会导致系统提示词缓存失效
2. **Token 无限制** - 大量技能会占用过多 context window
3. **无搜索发现** - 用户输入无法触发相关技能搜索
4. **重复注入** - 无法追踪已发送技能，可能导致重复

Claude Code Best 的设计方案解决了这些问题：

- **消息附件注入** - skill 元数据通过 `<system-reminder>` 消息注入，不影响系统提示词缓存
- **预算控制** - skill listing 占用 1% context window，描述截断 250 字符
- **TF-IDF 搜索** - 用户输入触发搜索，高置信度技能自动加载完整内容
- **状态追踪** - Map 追踪已发送技能，避免重复注入

---

## 改造目标

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         改造前                                            │
├─────────────────────────────────────────────────────────────────────────┤
│  System Prompt                                                           │
│  ├─ Identity                                                             │
│  ├─ Capabilities                                                         │
│  ├─ Rules                                                                │
│  ├─ Skills (一次性写入，破坏缓存)                                         │
│  ├─ Memory                                                               │
│  └─ ...                                                                  │
│                                                                          │
│  问题: skills section 变化 → 整个系统提示词缓存失效                       │
│        大量技能 → token 爆炸                                              │
│        无搜索发现 → 用户输入无法触发相关技能                               │
└─────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────┐
│                         改造后                                            │
├─────────────────────────────────────────────────────────────────────────┤
│  System Prompt (不变，可缓存)                                             │
│  ├─ Identity                                                             │
│  ├─ Capabilities                                                         │
│  ├─ Rules                                                                │
│  ├─ [DYNAMIC_BOUNDARY]                                                   │
│  ├─ Memory                                                               │
│  └─ ...                                                                  │
│                                                                          │
│  Message Attachments (每轮动态注入)                                       │
│  ├─ skill_listing: 技能摘要列表 (bundled + mcp，预算控制)                 │
│  ├─ skill_discovery: 搜索发现的技能 (TF-IDF，自动加载)                    │
│  └─ sentSkillNames: 追踪已发送技能                                        │
│                                                                          │
│  优势: 系统提示词稳定 → prompt cache 有效                                 │
│        预算控制 → token 不爆炸                                            │
│        搜索发现 → 按需加载相关技能                                        │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## 改造架构

### 新增模块

```
packages/core/src/
├─ extensions/
│  ├─ skills/                 (现有，改造)
│  │  ├─ types.ts             (新增: SkillVisibility, SkillIndexEntry)
│  │  ├─ metadata-loader.ts   (改造: 分层加载)
│  │  ├─ budget-formatter.ts  (新增: 预算控制格式化)
│  │  └─ visibility-filter.ts (新增: 分层可见性过滤)
│  │
│  ├─ skill-search/           (新增目录)
│  │  ├─ index.ts
│  │  ├─ tokenizer.ts         (分词 + 词干提取)
│  │  ├─ tfidf-index.ts       (TF-IDF 索引构建)
│  │  ├─ search.ts            (搜索函数)
│  │  ├─ prefetch.ts          (预加载 + 自动加载)
│  │  ├─ feature-check.ts     (特性开关)
│  │  └─ types.ts
│  │
│  ├─ attachments/            (新增目录)
│  │  ├─ index.ts
│  │  ├─ types.ts             (Attachment 类型定义)
│  │  ├─ skill-listing.ts     (skill_listing 附件)
│  │  ├─ skill-discovery.ts   (skill_discovery 附件)
│  │  ├─ sent-tracker.ts      (已发送技能追踪)
│  │  └─ formatter.ts         (附件格式化)
│  │
│  └─ system-prompt/
│     ├─ builder.ts           (改造: 移除 skills section)
│     └─ sections/
│        ├─ skills.ts         (删除或改为引用 skill_discovery)
│        └─ ...               (其他 sections 不变)
│
├─ session/
│  ├─ state.ts                (新增: session 状态管理，包含 sentSkillNames)
│  └─ cache.ts                (改造: prompt cache 状态)
```

---

## 详细设计

### Phase 1: 附件系统基础

#### 1.1 Attachment 类型定义

```typescript
// packages/core/src/extensions/attachments/types.ts

export interface Attachment {
  type: string;
  // 通用字段
}

export interface SkillListingAttachment extends Attachment {
  type: 'skill_listing';
  content: string;           // 格式化后的技能列表
  skillCount: number;        // 技能数量
  isInitial: boolean;        // 是否是首次发送
}

export interface SkillDiscoveryAttachment extends Attachment {
  type: 'skill_discovery';
  skills: SkillDiscoveryResult[];
  signal: DiscoverySignal;
  source: 'native' | 'remote' | 'both';
}

export interface SkillDiscoveryResult {
  name: string;
  description: string;
  score: number;
  autoLoaded: boolean;       // 是否自动加载完整内容
  content?: string;          // 自动加载的完整内容
  path?: string;             // SKILL.md 路径
}

export interface DiscoverySignal {
  trigger: 'user_input' | 'assistant_turn' | 'subagent_spawn';
  queryText: string;
  startedAt: number;
  durationMs: number;
  indexSize: number;
  method: 'tfidf' | 'keyword';
}
```

#### 1.2 已发送技能追踪

```typescript
// packages/core/src/extensions/attachments/sent-tracker.ts

/**
 * 追踪已发送的技能名称，避免重复注入
 * Key: agentId 或 sessionKey
 * Value: Set<skillName>
 */
const sentSkillNames: Map<string, Set<string>> = new Map();

export function getSentSkills(key: string): Set<string> {
  let sent = sentSkillNames.get(key);
  if (!sent) {
    sent = new Set();
    sentSkillNames.set(key, sent);
  }
  return sent;
}

export function markSkillSent(key: string, skillName: string): void {
  getSentSkills(key).add(skillName);
}

export function markSkillsSent(key: string, skillNames: string[]): void {
  const sent = getSentSkills(key);
  for (const name of skillNames) {
    sent.add(name);
  }
}

export function clearSentSkills(key: string): void {
  sentSkillNames.delete(key);
}

export function isNewSkill(key: string, skillName: string): boolean {
  return !getSentSkills(key).has(skillName);
}

export function getNewSkills(key: string, skills: Skill[]): Skill[] {
  const sent = getSentSkills(key);
  return skills.filter(s => !sent.has(s.name));
}
```

---

### Phase 2: 预算控制

#### 2.1 预算计算

```typescript
// packages/core/src/extensions/skills/budget-formatter.ts

/**
 * Skill listing 预算配置
 */
export const SKILL_BUDGET_CONFIG = {
  // Context window 占用比例
  CONTEXT_PERCENT: 0.01,         // 1%
  
  // 每字符约 4 个 token
  CHARS_PER_TOKEN: 4,
  
  // 默认字符预算 (fallback)
  DEFAULT_CHAR_BUDGET: 8000,     // 1% of 200k × 4
  
  // 单条描述硬上限
  MAX_DESC_CHARS: 250,
  
  // 最小描述长度 (极端情况下)
  MIN_DESC_LENGTH: 20,
};

/**
 * 计算字符预算
 */
export function getCharBudget(contextWindowTokens?: number): number {
  if (contextWindowTokens) {
    return Math.floor(
      contextWindowTokens * SKILL_BUDGET_CONFIG.CHARS_PER_TOKEN 
      * SKILL_BUDGET_CONFIG.CONTEXT_PERCENT
    );
  }
  return SKILL_BUDGET_CONFIG.DEFAULT_CHAR_BUDGET;
}

/**
 * 截断描述
 */
export function truncateDescription(desc: string, maxChars: number): string {
  if (desc.length <= maxChars) return desc;
  return desc.slice(0, maxChars - 1) + '…';
}

/**
 * 格式化技能列表，在预算内
 */
export function formatSkillsWithinBudget(
  skills: Skill[],
  contextWindowTokens?: number,
  options?: {
    alwaysFull?: string[];  // 哪些技能名称保持完整描述
  }
): string {
  if (skills.length === 0) return '';
  
  const budget = getCharBudget(contextWindowTokens);
  const alwaysFull = new Set(options?.alwaysFull ?? []);
  
  // 计算每条完整描述的总长度
  const entries = skills.map(s => ({
    skill: s,
    full: formatSkillEntry(s),
    isAlwaysFull: alwaysFull.has(s.name) || s.source === 'bundled',
  }));
  
  const fullTotal = entries.reduce(
    (sum, e) => sum + e.full.length + 1, 
    0
  ) - 1;
  
  // 如果总长度在预算内，直接返回
  if (fullTotal <= budget) {
    return entries.map(e => e.full).join('\n');
  }
  
  // 超预算：计算非 alwaysFull 技能的可用描述长度
  const alwaysFullChars = entries.reduce(
    (sum, e) => e.isAlwaysFull ? sum + e.full.length + 1 : sum,
    0
  );
  const remainingBudget = budget - alwaysFullChars;
  
  const restEntries = entries.filter(e => !e.isAlwaysFull);
  if (restEntries.length === 0) {
    return entries.filter(e => e.isAlwaysFull).map(e => e.full).join('\n');
  }
  
  // 计算非 alwaysFull 技能的最大描述长度
  const nameOverhead = restEntries.reduce(
    (sum, e) => sum + e.skill.name.length + 4, // "- name: "
    0
  ) + restEntries.length - 1; // newlines
  
  const availableForDescs = remainingBudget - nameOverhead;
  const maxDescLen = Math.floor(availableForDescs / restEntries.length);
  
  if (maxDescLen < SKILL_BUDGET_CONFIG.MIN_DESC_LENGTH) {
    // 极端情况：只显示名称
    return entries.map(e => 
      e.isAlwaysFull ? e.full : `- ${e.skill.name}`
    ).join('\n');
  }
  
  // 截断描述
  return entries.map(e => {
    if (e.isAlwaysFull) return e.full;
    const desc = getSkillDescription(e.skill);
    return `- ${e.skill.name}: ${truncateDescription(desc, maxDescLen)}`;
  }).join('\n');
}

/**
 * 格式化单条技能
 */
function formatSkillEntry(skill: Skill): string {
  const desc = getSkillDescription(skill);
  const truncated = truncateDescription(desc, SKILL_BUDGET_CONFIG.MAX_DESC_CHARS);
  return `- ${skill.name}: ${truncated}`;
}

/**
 * 获取技能描述 (description + whenToUse)
 */
function getSkillDescription(skill: Skill): string {
  if (skill.whenToUse) {
    return `${skill.description} - ${skill.whenToUse}`;
  }
  return skill.description;
}
```

---

### Phase 3: TF-IDF 搜索引擎

#### 3.1 分词器

```typescript
// packages/core/src/extensions/skill-search/tokenizer.ts

/**
 * 停用词 (英文)
 */
const STOP_WORDS = new Set([
  'a', 'an', 'the', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
  'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
  'should', 'may', 'might', 'shall', 'can', 'need', 'to', 'of', 'in',
  'for', 'on', 'with', 'at', 'by', 'from', 'as', 'into', 'through',
  // ... 更多停用词
]);

/**
 * CJK 字符检测
 */
const CJK_RANGE = /[一-鿿㐀-䶿]/;

export function isCjk(ch: string): boolean {
  return CJK_RANGE.test(ch);
}

/**
 * 分词
 * - CJK: 双字符切片
 * - 英文: 单词提取 + 停用词过滤
 */
export function tokenize(text: string): string[] {
  const tokens: string[] = [];
  const lower = text.toLowerCase();
  let i = 0;
  
  while (i < lower.length) {
    if (isCjk(lower[i]!)) {
      // CJK: 双字符切片
      let cjkRun = '';
      while (i < lower.length && isCjk(lower[i]!)) {
        cjkRun += lower[i];
        i++;
      }
      for (let j = 0; j < cjkRun.length - 1; j++) {
        tokens.push(cjkRun.slice(j, j + 2));
      }
    } else if (/[a-z0-9]/.test(lower[i]!)) {
      // 英文: 单词提取
      let word = '';
      while (i < lower.length && /[a-z0-9\-_]/.test(lower[i]!)) {
        word += lower[i];
        i++;
      }
      const cleaned = word.replace(/^[-_]+|[-_]+$/g, '');
      if (cleaned && !STOP_WORDS.has(cleaned)) {
        tokens.push(cleaned);
      }
    } else {
      i++;
    }
  }
  
  return tokens;
}

/**
 * 词干提取 (简化版)
 */
export function stem(word: string): string {
  if (isCjk(word[0] ?? '')) return word;
  
  let s = word;
  if (s.endsWith('ing') && s.length > 5) s = s.slice(0, -3);
  else if (s.endsWith('tion') && s.length > 5) s = s.slice(0, -4);
  else if (s.endsWith('ness') && s.length > 5) s = s.slice(0, -4);
  else if (s.endsWith('ment') && s.length > 5) s = s.slice(0, -4);
  else if (s.endsWith('er') && s.length > 4) s = s.slice(0, -2);
  else if (s.endsWith('s') && s.length > 3 && !s.endsWith('ss')) s = s.slice(0, -1);
  else if (s.endsWith('ed') && s.length > 4) s = s.slice(0, -2);
  else if (s.endsWith('ly') && s.length > 4) s = s.slice(0, -2);
  
  return s;
}

/**
 * 分词 + 词干提取
 */
export function tokenizeAndStem(text: string): string[] {
  return tokenize(text).map(stem);
}
```

#### 3.2 TF-IDF 索引

```typescript
// packages/core/src/extensions/skill-search/tfidf-index.ts

import { tokenizeAndStem } from './tokenizer';

/**
 * 技能索引条目
 */
export interface SkillIndexEntry {
  name: string;
  normalizedName: string;
  description: string;
  whenToUse?: string;
  source: string;
  sourcePath: string;
  contentLength?: number;
  tokens: string[];
  tfVector: Map<string, number>;
}

/**
 * 字段权重
 */
const FIELD_WEIGHT = {
  name: 3.0,
  whenToUse: 2.0,
  description: 1.0,
} as const;

/**
 * 计算加权 TF 向量
 */
function computeWeightedTf(
  fields: { tokens: string[]; weight: number }[]
): Map<string, number> {
  const weighted = new Map<string, number>();
  
  for (const field of fields) {
    const freq = new Map<string, number>();
    for (const t of field.tokens) {
      freq.set(t, (freq.get(t) ?? 0) + 1);
    }
    
    let max = 1;
    for (const v of freq.values()) if (v > max) max = v;
    
    for (const [term, count] of freq) {
      const val = (count / max) * field.weight;
      const existing = weighted.get(term) ?? 0;
      if (val > existing) weighted.set(term, val);
    }
  }
  
  return weighted;
}

/**
 * 计算 IDF (逆文档频率)
 */
export function computeIdf(index: SkillIndexEntry[]): Map<string, number> {
  const df = new Map<string, number>();
  
  for (const entry of index) {
    const seen = new Set<string>();
    for (const t of entry.tokens) {
      if (!seen.has(t)) {
        df.set(t, (df.get(t) ?? 0) + 1);
        seen.add(t);
      }
    }
  }
  
  const N = index.length;
  const idf = new Map<string, number>();
  
  for (const [term, count] of df) {
    idf.set(term, Math.log(N / count));
  }
  
  return idf;
}

/**
 * 构建技能索引
 */
export async function buildSkillIndex(
  skills: Skill[]
): Promise<SkillIndexEntry[]> {
  const entries: SkillIndexEntry[] = [];
  
  for (const skill of skills) {
    const nameTokens = tokenizeAndStem(skill.name);
    const descTokens = tokenizeAndStem(skill.description);
    const whenTokens = tokenizeAndStem(skill.whenToUse ?? '');
    
    const allTokens = [...new Set([
      ...nameTokens,
      ...descTokens,
      ...whenTokens,
    ])];
    
    const tfVector = computeWeightedTf([
      { tokens: nameTokens, weight: FIELD_WEIGHT.name },
      { tokens: whenTokens, weight: FIELD_WEIGHT.whenToUse },
      { tokens: descTokens, weight: FIELD_WEIGHT.description },
    ]);
    
    entries.push({
      name: skill.name,
      normalizedName: normalizeSkillName(skill.name),
      description: skill.description,
      whenToUse: skill.whenToUse,
      source: skill.source ?? 'project',
      sourcePath: skill.sourcePath,
      contentLength: skill.body?.length,
      tokens: allTokens,
      tfVector,
    });
  }
  
  return entries;
}

/**
 * 规范化技能名称
 */
function normalizeSkillName(name: string): string {
  return name.toLowerCase().replace(/[-_]/g, ' ');
}

// 缓存
let cachedIndex: SkillIndexEntry[] | null = null;
let cachedIdf: Map<string, number> | null = null;

export function getSkillIndexCache(): {
  index: SkillIndexEntry[] | null;
  idf: Map<string, number> | null;
} {
  return { index: cachedIndex, idf: cachedIdf };
}

export function setSkillIndexCache(
  index: SkillIndexEntry[],
  idf: Map<string, number>
): void {
  cachedIndex = index;
  cachedIdf = idf;
}

export function clearSkillIndexCache(): void {
  cachedIndex = null;
  cachedIdf = null;
}
```

#### 3.3 搜索函数

```typescript
// packages/core/src/extensions/skill-search/search.ts

import { tokenizeAndStem, isCjk } from './tokenizer';
import { getSkillIndexCache, computeIdf } from './tfidf-index';
import type { SkillIndexEntry } from './tfidf-index';

export interface SearchResult {
  name: string;
  description: string;
  score: number;
  sourcePath?: string;
  contentLength?: number;
}

/**
 * 余弦相似度
 */
function cosineSimilarity(
  queryTfIdf: Map<string, number>,
  docTfIdf: Map<string, number>
): number {
  let dot = 0;
  let normQ = 0;
  let normD = 0;
  
  for (const [term, qWeight] of queryTfIdf) {
    const dWeight = docTfIdf.get(term) ?? 0;
    dot += qWeight * dWeight;
    normQ += qWeight * qWeight;
  }
  
  for (const dWeight of docTfIdf.values()) {
    normD += dWeight * dWeight;
  }
  
  const denom = Math.sqrt(normQ) * Math.sqrt(normD);
  return denom === 0 ? 0 : dot / denom;
}

/**
 * 搜索技能
 */
export function searchSkills(
  query: string,
  index: SkillIndexEntry[],
  options?: {
    limit?: number;
    minScore?: number;
    nameMatchBonus?: number;
  }
): SearchResult[] {
  const limit = options?.limit ?? 5;
  const minScore = options?.minScore ?? 0.10;
  const nameMatchBonus = options?.nameMatchBonus ?? 0.4;
  
  if (index.length === 0 || !query.trim()) return [];
  
  const queryTokens = tokenizeAndStem(query);
  if (queryTokens.length === 0) return [];
  
  // 计算查询 TF
  const queryTf = new Map<string, number>();
  const freq = new Map<string, number>();
  for (const t of queryTokens) {
    freq.set(t, (freq.get(t) ?? 0) + 1);
  }
  let max = 1;
  for (const v of freq.values()) if (v > max) max = v;
  for (const [term, count] of freq) {
    queryTf.set(term, count / max);
  }
  
  // 获取 IDF
  const idf = getSkillIndexCache().idf ?? computeIdf(index);
  
  // 计算查询 TF-IDF
  const queryTfIdf = new Map<string, number>();
  for (const [term, tf] of queryTf) {
    queryTfIdf.set(term, tf * (idf.get(term) ?? 0));
  }
  
  const queryLower = query.toLowerCase().replace(/[-_]/g, ' ');
  
  // 搜索
  const results: SearchResult[] = [];
  
  for (const entry of index) {
    let score = cosineSimilarity(queryTfIdf, entry.tfVector);
    
    // 名称匹配加成
    if (entry.name.length >= 4) {
      if (queryLower.includes(entry.normalizedName)) {
        score = Math.max(score, nameMatchBonus);
      }
    }
    
    if (score >= minScore) {
      results.push({
        name: entry.name,
        description: entry.description,
        score,
        sourcePath: entry.sourcePath,
        contentLength: entry.contentLength,
      });
    }
  }
  
  // 按分数排序，限制数量
  return results
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}
```

---

### Phase 4: 技能附件注入

#### 4.1 skill_listing 附件

```typescript
// packages/core/src/extensions/attachments/skill-listing.ts

import type { Skill } from '../skills/types';
import { formatSkillsWithinBudget } from '../skills/budget-formatter';
import { getNewSkills, markSkillsSent } from './sent-tracker';
import type { SkillListingAttachment } from './types';

/**
 * 配置
 */
const SKILL_LISTING_CONFIG = {
  // 最大技能数量
  MAX_SKILLS: 30,
  
  // 哪些来源总是显示
  ALWAYS_VISIBLE: ['bundled', 'mcp'],
};

/**
 * 获取 skill_listing 附件
 */
export async function getSkillListingAttachment(
  skills: Skill[],
  sessionKey: string,
  contextWindowTokens?: number,
  options?: {
    suppressNext?: boolean;  // resume 场景：跳过首次发送
    filterSources?: string[];
  }
): Promise<SkillListingAttachment | null> {
  // 过滤可见技能
  let visibleSkills = filterVisibleSkills(skills, options?.filterSources);
  
  // 检查是否是 resume 场景
  if (options?.suppressNext) {
    // 标记所有当前技能为已发送，返回空
    markSkillsSent(sessionKey, visibleSkills.map(s => s.name));
    return null;
  }
  
  // 找出新技能
  const newSkills = getNewSkills(sessionKey, visibleSkills);
  if (newSkills.length === 0) return null;
  
  // 是否是首次发送
  const sentSkills = getSentSkills(sessionKey);
  const isInitial = sentSkills.size === 0;
  
  // 标记为已发送
  markSkillsSent(sessionKey, newSkills.map(s => s.name));
  
  // 格式化
  const content = formatSkillsWithinBudget(newSkills, contextWindowTokens, {
    alwaysFull: SKILL_LISTING_CONFIG.ALWAYS_VISIBLE,
  });
  
  return {
    type: 'skill_listing',
    content,
    skillCount: newSkills.length,
    isInitial,
  };
}

/**
 * 过滤可见技能
 */
function filterVisibleSkills(
  skills: Skill[],
  filterSources?: string[]
): Skill[] {
  if (filterSources) {
    return skills.filter(s => 
      filterSources.includes(s.source ?? 'project')
    );
  }
  
  // 默认：只显示 bundled 和 mcp
  return skills.filter(s => 
    SKILL_LISTING_CONFIG.ALWAYS_VISIBLE.includes(s.source ?? 'project')
  );
}
```

#### 4.2 skill_discovery 附件

```typescript
// packages/core/src/extensions/attachments/skill-discovery.ts

import type { Skill } from '../skills/types';
import { searchSkills } from '../skill-search/search';
import { buildSkillIndex, computeIdf, setSkillIndexCache } from '../skill-search/tfidf-index';
import type { SkillDiscoveryAttachment, SkillDiscoveryResult, DiscoverySignal } from './types';

/**
 * 配置
 */
const SKILL_DISCOVERY_CONFIG = {
  // 自动加载最低分数
  AUTO_LOAD_MIN_SCORE: 0.30,
  
  // 自动加载数量上限
  AUTO_LOAD_LIMIT: 2,
  
  // 自动加载内容最大字符数
  AUTO_LOAD_MAX_CHARS: 12000,
};

// 会话内已发现的技能
const discoveredThisSession = new Set<string>();

/**
 * 获取 skill_discovery 附件 (Turn Zero)
 */
export async function getTurnZeroSkillDiscovery(
  userInput: string,
  skills: Skill[],
  options?: {
    autoLoadBody?: (skillName: string) => Promise<string | null>;
  }
): Promise<SkillDiscoveryAttachment | null> {
  if (!userInput.trim()) return null;
  
  const startedAt = Date.now();
  
  // 构建索引
  const index = await buildSkillIndex(skills);
  const idf = computeIdf(index);
  setSkillIndexCache(index, idf);
  
  // 搜索
  const results = searchSkills(userInput, index, { limit: 5 });
  
  // 富化：自动加载高置信度技能
  const enriched = await enrichResultsForAutoLoad(results, skills, options?.autoLoadBody);
  
  if (enriched.length === 0) return null;
  
  // 标记为已发现
  for (const r of enriched) {
    discoveredThisSession.add(r.name);
  }
  
  const signal: DiscoverySignal = {
    trigger: 'user_input',
    queryText: userInput.slice(0, 200),
    startedAt,
    durationMs: Date.now() - startedAt,
    indexSize: index.length,
    method: 'tfidf',
  };
  
  return {
    type: 'skill_discovery',
    skills: enriched,
    signal,
    source: 'native',
  };
}

/**
 * 预加载搜索 (Inter-turn)
 */
export async function startSkillDiscoveryPrefetch(
  input: string | null,
  skills: Skill[]
): Promise<SkillDiscoveryAttachment | null> {
  if (!input?.trim()) return null;
  
  const startedAt = Date.now();
  
  // 使用缓存索引
  const { index } = getSkillIndexCache();
  if (!index) return null;
  
  // 搜索
  const results = searchSkills(input, index, { limit: 5 });
  
  // 过滤已发现的
  const newResults = results.filter(r => !discoveredThisSession.has(r.name));
  if (newResults.length === 0) return null;
  
  // 标记为已发现
  for (const r of newResults) {
    discoveredThisSession.add(r.name);
  }
  
  const signal: DiscoverySignal = {
    trigger: 'assistant_turn',
    queryText: input.slice(0, 200),
    startedAt,
    durationMs: Date.now() - startedAt,
    indexSize: index.length,
    method: 'tfidf',
  };
  
  return {
    type: 'skill_discovery',
    skills: newResults.map(r => ({
      name: r.name,
      description: r.description,
      score: r.score,
      autoLoaded: false,
    })),
    signal,
    source: 'native',
  };
}

/**
 * 富化搜索结果：自动加载高置信度技能
 */
async function enrichResultsForAutoLoad(
  results: SearchResult[],
  skills: Skill[],
  autoLoadBody?: (skillName: string) => Promise<string | null>
): Promise<SkillDiscoveryResult[]> {
  let loadedCount = 0;
  const enriched: SkillDiscoveryResult[] = [];
  
  for (const result of results) {
    const base: SkillDiscoveryResult = {
      name: result.name,
      description: result.description,
      score: result.score,
      autoLoaded: false,
    };
    
    // 检查是否应该自动加载
    if (
      loadedCount < SKILL_DISCOVERY_CONFIG.AUTO_LOAD_LIMIT &&
      result.score >= SKILL_DISCOVERY_CONFIG.AUTO_LOAD_MIN_SCORE &&
      autoLoadBody
    ) {
      const body = await autoLoadBody(result.name);
      if (body && body.length <= SKILL_DISCOVERY_CONFIG.AUTO_LOAD_MAX_CHARS) {
        loadedCount++;
        enriched.push({
          ...base,
          autoLoaded: true,
          content: body,
          path: result.sourcePath,
        });
        continue;
      }
    }
    
    enriched.push(base);
  }
  
  return enriched;
}

/**
 * 清除会话发现状态
 */
export function clearDiscoveryState(): void {
  discoveredThisSession.clear();
}
```

---

### Phase 5: 系统提示词改造

#### 5.1 移除 skills section

```typescript
// packages/core/src/extensions/system-prompt/builder.ts

// 改造前: skills section 在 SESSION_SECTION_FACTORIES 中

// 改造后: 移除 skills section，改为引用 skill_discovery 附件

const SESSION_SECTION_FACTORIES: SectionFactory[] = [
  // ... 其他 sections 不变
  // {
  //   name: "skills",
  //   create: (options) => createSkillsSection(options.skills ?? []),
  //   cacheStrategy: "session",
  // },
  // 删除上面的 skills section
];
```

#### 5.2 消息注入点

```typescript
// 在消息处理流程中注入附件

// packages/core/src/runtime/message-processor.ts (新增或改造)

import { getSkillListingAttachment } from '../extensions/attachments/skill-listing';
import { getTurnZeroSkillDiscovery } from '../extensions/attachments/skill-discovery';

/**
 * 处理用户消息，注入技能附件
 */
export async function processUserMessage(
  userInput: string,
  context: {
    skills: Skill[];
    sessionKey: string;
    contextWindowTokens?: number;
    isTurnZero: boolean;
  }
): Promise<{
  message: string;
  attachments: Attachment[];
}> {
  const attachments: Attachment[] = [];
  
  // 1. skill_listing (总是注入新技能)
  const listingAttachment = await getSkillListingAttachment(
    context.skills,
    context.sessionKey,
    context.contextWindowTokens
  );
  if (listingAttachment) {
    attachments.push(listingAttachment);
  }
  
  // 2. skill_discovery (Turn Zero 或搜索触发)
  if (context.isTurnZero) {
    const discoveryAttachment = await getTurnZeroSkillDiscovery(
      userInput,
      context.skills,
      {
        autoLoadBody: async (skillName) => {
          // 加载完整 SKILL.md 内容
          const skill = context.skills.find(s => s.name === skillName);
          if (skill?.body) {
            return skill.body.slice(0, 12000);
          }
          return null;
        },
      }
    );
    if (discoveryAttachment) {
      attachments.push(discoveryAttachment);
    }
  }
  
  return {
    message: userInput,
    attachments,
  };
}
```

---

## 实现顺序

### Phase 1 (基础): 附件系统和追踪

```
优先级: P0
工作量: 2-3 天
依赖: 无

文件:
├─ packages/core/src/extensions/attachments/types.ts      (新建)
├─ packages/core/src/extensions/attachments/sent-tracker.ts (新建)
├─ packages/core/src/extensions/attachments/index.ts      (新建)
```

### Phase 2 (预算): 预算控制

```
优先级: P0
工作量: 1-2 天
依赖: Phase 1

文件:
├─ packages/core/src/extensions/skills/budget-formatter.ts (新建)
```

### Phase 3 (搜索): TF-IDF 引擎

```
优先级: P1
工作量: 3-4 天
依赖: Phase 1

文件:
├─ packages/core/src/extensions/skill-search/tokenizer.ts  (新建)
├─ packages/core/src/extensions/skill-search/tfidf-index.ts (新建)
├─ packages/core/src/extensions/skill-search/search.ts     (新建)
├─ packages/core/src/extensions/skill-search/index.ts      (新建)
```

### Phase 4 (注入): 附件注入

```
优先级: P0
工作量: 2-3 天
依赖: Phase 1, Phase 2

文件:
├─ packages/core/src/extensions/attachments/skill-listing.ts   (新建)
├─ packages/core/src/extensions/attachments/skill-discovery.ts (新建)
```

### Phase 5 (改造): 系统提示词

```
优先级: P0
工作量: 1 天
依赖: Phase 4

文件:
├─ packages/core/src/extensions/system-prompt/builder.ts   (改造)
├─ packages/core/src/extensions/system-prompt/sections/skills.ts (删除或改造)
```

---

## 测试策略

### 单元测试

```typescript
// packages/core/src/extensions/skills/__tests__/budget-formatter.test.ts

describe('formatSkillsWithinBudget', () => {
  it('should return empty string for empty skills', () => {
    expect(formatSkillsWithinBudget([])).toBe('');
  });
  
  it('should fit within budget', () => {
    const skills = createMockSkills(100); // 100 个 mock skills
    const result = formatSkillsWithinBudget(skills, 200000);
    expect(result.length).toBeLessThan(getCharBudget(200000));
  });
  
  it('should keep bundled skills full', () => {
    const skills = [
      { name: 'bundled-skill', source: 'bundled', description: 'very long desc...' },
      { name: 'project-skill', source: 'project', description: 'very long desc...' },
    ];
    const result = formatSkillsWithinBudget(skills, 8000);
    // bundled 保持完整，project 截断
  });
});

// packages/core/src/extensions/skill-search/__tests__/search.test.ts

describe('searchSkills', () => {
  it('should return results sorted by score', () => {
    const index = createMockIndex();
    const results = searchSkills('review PR', index);
    expect(results[0].score).toBeGreaterThanOrEqual(results[1].score);
  });
  
  it('should give name match bonus', () => {
    const index = [{ name: 'review-pr', normalizedName: 'review pr', ... }];
    const results = searchSkills('review PR', index);
    expect(results.find(r => r.name === 'review-pr')?.score).toBeGreaterThan(0.4);
  });
});
```

### 集成测试

```typescript
// packages/core/src/__tests__/skill-attachments.test.ts

describe('Skill Attachments Integration', () => {
  it('should inject skill_listing on turn zero', async () => {
    const context = createMockContext();
    const result = await processUserMessage('help me review', context);
    expect(result.attachments.some(a => a.type === 'skill_listing')).toBe(true);
  });
  
  it('should inject skill_discovery when relevant', async () => {
    const skills = [createSkill('review-pr', 'Review pull requests')];
    const context = createMockContext({ skills, isTurnZero: true });
    const result = await processUserMessage('review this PR', context);
    const discovery = result.attachments.find(a => a.type === 'skill_discovery');
    expect(discovery?.skills[0].name).toBe('review-pr');
  });
  
  it('should not repeat sent skills', async () => {
    const context = createMockContext();
    await processUserMessage('first message', context);
    const result = await processUserMessage('second message', context);
    // 第二次不应该重复发送同样的技能列表
  });
});
```

---

## 风险与缓解

### 风险 1: 搜索延迟

TF-IDF 搜索在大量技能时可能有延迟。

**缓解措施**:
- 索引缓存 (session 级)
- 异步预加载 (inter-turn prefetch)
- 限制搜索结果数量

### 风险 2: 自动加载过大

高置信度技能自动加载可能占用过多 token。

**缓解措施**:
- 12K 字符上限
- 最多 2 个自动加载
- 可配置开关

### 风险 3: 首次体验

用户首次使用时看不到完整技能列表。

**缓解措施**:
- skill_listing 显示 bundled + mcp
- skill_discovery 搜索发现其他技能
- `/skills` 命令查看完整列表

---

## 配置项

```typescript
// packages/core/src/config/skill-config.ts

export const SKILL_CONFIG = {
  // 预算
  BUDGET_PERCENT: 0.01,
  MAX_DESC_CHARS: 250,
  
  // 搜索
  SEARCH_LIMIT: 5,
  MIN_SCORE: 0.10,
  NAME_MATCH_BONUS: 0.4,
  
  // 自动加载
  AUTO_LOAD_MIN_SCORE: 0.30,
  AUTO_LOAD_LIMIT: 2,
  AUTO_LOAD_MAX_CHARS: 12000,
  
  // 可见性
  ALWAYS_VISIBLE: ['bundled', 'mcp'],
  MAX_LISTING_SKILLS: 30,
  
  // 开关
  ENABLE_SEARCH: true,
  ENABLE_AUTO_LOAD: true,
};
```

---

## 总结

| 改造项 | Claude Code Best 方案 | TheThing 改造 |
|--------|----------------------|---------------|
| 技能注入位置 | 消息附件 | 消息附件 |
| 预算控制 | 1% context window | 同样 |
| 搜索发现 | TF-IDF + cosine | 同样 |
| 自动加载 | score >= 0.30 | 同样 |
| 状态追踪 | Map<string, Set> | 同样 |
| 描述截断 | 250 chars | 同样 |

改造后的 TheThing 将具备：
- ✅ Prompt Cache 友好
- ✅ Token 预算控制
- ✅ 按需搜索发现
- ✅ 避免重复注入
- ✅ 分层可见性