// ============================================================
// MemoryEntry - 加载的 Memory 数据条目
// ============================================================
// 用于 system prompt 构建和 Agent 指令注入
// 由 composition/loaders/memory 加载，但类型定义在 modules 层

export interface MemoryEntry {
  content: string;
  filePath: string;
  lines: number;
  sizeKb: number;
}

export type MemoryType = 'user' | 'feedback' | 'project' | 'reference';

// ============================================================
// Layer 2: 信任层 — 来源与置信度
// ============================================================

export type MemorySource = 'explicit' | 'inferred' | 'promoted';

export const MEMORY_SOURCE_CONFIG: Record<MemorySource, { label: string; initialConfidence: number; color: string }> = {
  explicit: {
    label: '显式',
    initialConfidence: 0.9,
    color: 'bg-blue-500/15 text-blue-700 dark:text-blue-400 border-blue-500/25',
  },
  inferred: {
    label: '归纳',
    initialConfidence: 0.3,
    color: 'bg-amber-500/15 text-amber-700 dark:text-amber-400 border-amber-500/25',
  },
  promoted: {
    label: '已晋升',
    initialConfidence: 0.6,
    color: 'bg-green-500/15 text-green-700 dark:text-green-400 border-green-500/25',
  },
};

export const MEMORY_TYPES: Record<MemoryType, { label: string; whenToSave: string; examples: string[] }> = {
  user: {
    label: '用户记忆',
    whenToSave: '用户表达了个人偏好、技术背景、角色信息时',
    examples: [
      '我是前端开发，不熟悉后端',
      '我喜欢简洁的代码风格',
      '我们团队用 TypeScript',
    ],
  },
  feedback: {
    label: '反馈记忆',
    whenToSave: '用户纠正了 AI 的行为，或认可了 AI 的做法时',
    examples: [
      '不要 mock 数据库，用真实数据',
      '单 PR 更好，不要拆分',
      '这种方式很好，以后都用',
    ],
  },
  project: {
    label: '项目记忆',
    whenToSave: '用户提到非代码可推导的项目约束、决策或流程时',
    examples: [
      '合并冻结从周四开始',
      'auth 模块重写是合规要求',
      '部署需要经过三轮审批',
    ],
  },
  reference: {
    label: '参考记忆',
    whenToSave: '用户提到外部工具、服务、流程时',
    examples: [
      'CI/CD pipeline bugs 在 Linear INGEST 项目',
      '测试数据在 staging-db 上',
      '监控面板在 Grafana prod-dashboard',
    ],
  },
};

export const WHAT_NOT_TO_SAVE = `### 什么 NOT 要保存
- 代码模式（可以从代码推导）
- 文件结构（可以实时查看）
- Git 历史（可以 git log 查看）
- 已经在 THING.md 中描述的内容
- 临时性任务信息`;

export const MEMORY_TYPES_PROMPT = `## 系统记忆管理指南

系统会自动管理记忆，你无需主动写入记忆文件。

你只需要关注以下两点：

### 记忆类型说明
你可以参考以下类型理解已存储的记忆内容：

#### user（用户记忆）
用户表达了个人偏好、技术背景、角色信息。

#### feedback（反馈记忆）
用户纠正了 AI 的行为，或认可了 AI 的做法。

#### project（项目记忆）
用户提到非代码可推导的项目约束、决策或流程。

#### reference（参考记忆）
用户提到外部工具、服务、流程。

### 什么 NOT 要记忆
以下信息不需要记忆：
- 代码模式（可以从代码推导）
- 文件结构（可以实时查看）
- Git 历史（可以 git log 查看）
- 已经在 THING.md 中描述的内容
- 临时性任务信息`;

export const TRUSTING_RECALL_SECTION = `## 记忆召回防御

召回记忆时，请先验证记忆内容是否仍然有效：
- 如果记忆提到某个文件，确认文件存在
- 如果记忆提到某个函数，确认函数存在（用 grep 搜索）
- 如果记忆包含代码示例，验证代码是否仍然正确

记忆可能过期。请在推荐前先验证。

### 什么时候不需要验证
当用户直接询问与记忆内容完全匹配的问题时（例如用户问"你该怎么叫我"→记忆中有称呼偏好），直接使用记忆内容回答，不要反复质疑记忆的可靠性。置信度仅表示信息来源方式（用户明确说出 vs 推断），不代表信息的准确性。`;

export const WHEN_TO_ACCESS_SECTION = `## 何时访问记忆

在以下情况主动召回记忆：
- 用户提问涉及过往讨论的决策或偏好
- 用户提到项目流程、团队规范
- 用户请求基于历史上下文的任务

不要每次都列出所有记忆。只召回与当前对话相关的。`;

export interface MemoryFileData {
  name: string;
  description: string;
  type: MemoryType;
  content: string;
  // Layer 2: 信任层
  source?: MemorySource;
  confidence?: number;
  validUntil?: number | null;
  supersededBy?: string | null;
  // 语义检索增强
  subject?: string;       // 记忆主体（如"用户"、"Aura"）
  aliases?: string[];     // 主体别名（如["我", "主人", "自己"]）
  context?: string[];     // 关联场景（如["称呼", "身份", "角色"]）
}

export function formatMemoryFrontmatter(data: MemoryFileData): string {
  const lines = [
    '---',
    `name: ${data.name}`,
    `description: ${data.description}`,
    `type: ${data.type}`,
  ];
  if (data.source) lines.push(`source: ${data.source}`);
  if (data.confidence != null) lines.push(`confidence: ${data.confidence}`);
  if (data.validUntil != null) lines.push(`validUntil: ${data.validUntil}`);
  if (data.supersededBy) lines.push(`supersededBy: ${data.supersededBy}`);
  if (data.subject) lines.push(`subject: ${data.subject}`);
  if (data.aliases && data.aliases.length > 0) lines.push(`aliases: [${data.aliases.join(', ')}]`);
  if (data.context && data.context.length > 0) lines.push(`context: [${data.context.join(', ')}]`);
  lines.push('---');
  return lines.join('\n');
}

export function parseMemoryFrontmatter(content: string): MemoryFileData | null {
  const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!frontmatterMatch) return null;

  const frontmatterStr = frontmatterMatch[1];
  const bodyContent = frontmatterMatch[2].trim();

  const nameMatch = frontmatterStr.match(/^name:\s*(.+)$/m);
  const descMatch = frontmatterStr.match(/^description:\s*(.+)$/m);
  const typeMatch = frontmatterStr.match(/^type:\s*(.+)$/m);
  const sourceMatch = frontmatterStr.match(/^source:\s*(.+)$/m);
  const confidenceMatch = frontmatterStr.match(/^confidence:\s*(.+)$/m);
  const validUntilMatch = frontmatterStr.match(/^validUntil:\s*(.+)$/m);
  const supersededByMatch = frontmatterStr.match(/^supersededBy:\s*(.+)$/m);
  const subjectMatch = frontmatterStr.match(/^subject:\s*(.+)$/m);
  const aliasesMatch = frontmatterStr.match(/^aliases:\s*\[(.+)\]$/m);
  const contextMatch = frontmatterStr.match(/^context:\s*\[(.+)\]$/m);

  if (!nameMatch || !typeMatch) return null;

  const type = nameMatch[1].trim();
  if (!isMemoryType(type)) return null;

  const source = sourceMatch?.[1].trim() as MemorySource | undefined;
  const confidence = confidenceMatch ? parseFloat(confidenceMatch[1].trim()) : undefined;
  const validUntil = validUntilMatch?.[1].trim();
  const supersededBy = supersededByMatch?.[1].trim();

  return {
    name: nameMatch[1].trim(),
    description: descMatch?.[1].trim() || '',
    type,
    content: bodyContent,
    source: source && isMemorySource(source) ? source : undefined,
    confidence: confidence != null && !isNaN(confidence) ? confidence : undefined,
    validUntil: validUntil ? Number(validUntil) : undefined,
    supersededBy: supersededBy && supersededBy !== 'null' ? supersededBy : undefined,
    subject: subjectMatch?.[1]?.trim() || undefined,
    aliases: aliasesMatch?.[1]?.split(',').map(s => s.trim()).filter(Boolean) || undefined,
    context: contextMatch?.[1]?.split(',').map(s => s.trim()).filter(Boolean) || undefined,
  };
}

function isMemoryType(type: string): type is MemoryType {
  return ['user', 'feedback', 'project', 'reference'].includes(type);
}

function isMemorySource(source: string): source is MemorySource {
  return ['explicit', 'inferred', 'promoted'].includes(source);
}
