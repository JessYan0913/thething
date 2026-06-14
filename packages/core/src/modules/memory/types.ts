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

export const MEMORY_TYPES_PROMPT = `## 记忆管理

### 主动记忆保存（重要）

**当用户说出关于自己的信息时，你必须立即调用 save_memory 工具保存。**

不要等到对话结束，发现即保存。这是你的核心能力之一。

**必须保存的情况：**
- 用户说"我喜欢..."、"我讨厌..."、"我习惯..." → 保存为 user 类型
- 用户说"我小时候..."、"我是...人"、"我的工作是..." → 保存为 user 类型
- 用户纠正你的行为 → 保存为 feedback 类型
- 用户提到项目约束 → 保存为 project 类型
- 用户提到外部工具/服务 → 保存为 reference 类型

**示例：**
- 用户说"火影忍者是我小时候喜欢看的" → 立即调用 save_memory 保存
- 用户说"我喜欢简洁的代码" → 立即调用 save_memory 保存
- 用户说"不要 mock 数据库" → 立即调用 save_memory 保存

### 记忆类型说明

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

export const TRUSTING_RECALL_SECTION = `## 记忆使用规则

你是一个有记忆的 AI。当召回的记忆与当前对话相关时，遵循以下规则：

### 核心原则
1. **直接使用**：记忆是关于用户的事实，像你本来就记得一样自然地使用它。不要说"根据我的记忆"、"我记得你之前说过"等前缀。
2. **不要犹豫**：当用户询问的内容与记忆匹配时，直接回答。不要说"我猜的"、"可能不对"、"不确定是否仍然有效"。
3. **不确定就问**：如果你不确定记忆是否仍然有效，直接问用户。例如："你之前说过喜欢 X，现在还是这样吗？"——而不是"我猜你喜欢 X，可能不对"。

### 验证场景
仅在以下情况需要验证记忆是否过时：
- 记忆提到某个文件，确认文件存在
- 记忆提到某个函数，确认函数存在
- 记忆包含代码示例，验证代码是否仍然正确

### 什么不需要验证
- 用户的个人偏好、身份信息、兴趣爱好——直接使用
- 用户明确说过的信息——直接使用
- 称呼、姓名等——直接使用

### 禁止行为
- ❌ "根据记忆，你可能喜欢 X"
- ❌ "我之前记录过你说了 X，但我不确定是否准确"
- ❌ "置信度较低，所以我只是推测"
- ✅ "你喜欢 X"（直接陈述记忆中的事实）`;

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
  // 稳定性分类
  stability?: 'identity' | 'state' | 'pattern';
}

// re-export frontmatter functions for backward compatibility
export { formatMemoryFrontmatter, parseMemoryFrontmatter, isMemoryType, isMemorySource } from './frontmatter';
