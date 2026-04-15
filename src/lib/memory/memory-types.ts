export type MemoryType = 'user' | 'feedback' | 'project' | 'reference';

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
- 已经在 CLAUDE.md 中描述的内容
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
- 已经在 CLAUDE.md 中描述的内容
- 临时性任务信息`;

export const TRUSTING_RECALL_SECTION = `## 记忆召回防御

召回记忆时，请先验证记忆内容是否仍然有效：
- 如果记忆提到某个文件，确认文件存在
- 如果记忆提到某个函数，确认函数存在（用 grep 搜索）
- 如果记忆包含代码示例，验证代码是否仍然正确

记忆可能过期。请在推荐前先验证。`;

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
}

export function formatMemoryFrontmatter(data: MemoryFileData): string {
  return `---
name: ${data.name}
description: ${data.description}
type: ${data.type}
---`;
}

export function parseMemoryFrontmatter(content: string): MemoryFileData | null {
  const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!frontmatterMatch) return null;

  const frontmatterStr = frontmatterMatch[1];
  const bodyContent = frontmatterMatch[2].trim();

  const nameMatch = frontmatterStr.match(/^name:\s*(.+)$/m);
  const descMatch = frontmatterStr.match(/^description:\s*(.+)$/m);
  const typeMatch = frontmatterStr.match(/^type:\s*(.+)$/m);

  if (!nameMatch || !typeMatch) return null;

  const type = nameMatch[1].trim();
  if (!isMemoryType(type)) return null;

  return {
    name: nameMatch[1].trim(),
    description: descMatch?.[1].trim() || '',
    type,
    content: bodyContent,
  };
}

function isMemoryType(type: string): type is MemoryType {
  return ['user', 'feedback', 'project', 'reference'].includes(type);
}
