# Wiki 模块重构：从「用户记忆」到「Agent 知识积累」

> 参考：[Karpathy LLM Wiki](./llm-wiki.md)
> 日期：2026-06-24
> 状态：设计阶段

---

## 一、背景

当前 wiki 模块虽然架构上参考了 Karpathy 的 LLM Wiki 模式（扁平目录、index.md、log.md、[[wiki-link]]），但心智模型被窄化为「用户记忆系统」——分类只有 identity/pattern/state，prompt 只引导 agent 保存用户偏好和行为纠正。

Karpathy 的核心洞察是：

> **wiki 是 Agent 积累知识的机制，不只是记住用户。**

Agent 阅读文章、分析技术、做对比研究、沉淀领域知识——这些都应该成为 wiki 的内容，跨对话累积产生认知复利。

### 当前实现 vs Karpathy 愿景

| 维度 | 当前实现 | Karpathy 愿景 |
|------|---------|--------------|
| 分类 | `identity/pattern/state` — 用户维度 | 概念页、实体页、对比页、综合概述 |
| 触发 | 用户事实、行为纠正 | 任何值得沉淀的知识 |
| 内容 | "用户喜欢 X" | "React vs Vue 对比结论"、"这篇论文的核心观点" |
| 价值 | 个性化 | **认知复利** — 知识跨对话累积 |
| 工具名 | `save_memory` | 应体现「知识积累」心智模型 |

---

## 二、设计原则

1. **Wiki 是 Agent 的知识库，不是用户档案** — 任何值得跨对话保留的知识都应入库
2. **LLM 做编译和维护，代码只做 IO** — 保持现有架构优势
3. **分类是标签，不是限制** — LLM 可以自由分类，系统只提供推荐类型
4. **向后兼容** — 现有用户记忆数据可迁移

---

## 三、分类体系重设计

### 旧分类（用户维度）

```
identity  — 用户极少变化的事实
pattern   — 用户跨场景规律
state     — 用户当前状态
```

### 新分类（知识维度）

```
user      — 关于用户的事实（偏好、身份、习惯、纠正）
agent     — 关于 Agent 自身的规则和知识（行为准则、工具使用）
project   — 项目相关知识（架构决策、技术选型、进度）
domain    — 领域知识（技术对比、最佳实践、研究结论）
entity    — 实体知识（人物、工具、服务的属性和关系）
```

**设计考量：**

- `user` 替代了旧的 `identity/pattern/state`，简化但保留用户维度
- `agent` 捕获 Agent 自身的行为规则（如「禁止 mock 数据库」）
- `project` 是用户最常见的跨对话知识场景
- `domain` 是 Karpathy 愿景的核心——Agent 积累的领域知识
- `entity` 跟踪 Agent 遇到的人物、工具、服务
- LLM 可以使用推荐分类之外的值，index.md 按实际分类分组

### 分类映射（迁移用）

```
旧 identity → user（用户身份事实）
旧 pattern  → user（用户行为规律）或 agent（AI 行为规则）
旧 state    → project（项目状态）或 user（用户状态）
```

---

## 四、Schema 变更

### wikiActionSchema（新增字段）

```ts
const wikiActionSchema = z.object({
  action: z.enum(['create', 'update', 'merge', 'replace', 'invalidate']),
  mode: z.enum(['replace', 'append']).optional(),
  category: z.enum(['user', 'agent', 'project', 'domain', 'entity']),
  name: z.string().max(20),
  description: z.string().max(50),
  content: z.string(),
  // 新增字段
  source: z.enum(['explicit', 'inferred']).optional()
    .describe('知识来源: explicit=用户直说, inferred=推断'),
  aliases: z.array(z.string()).optional()
    .describe('主体别名（用于召回匹配）'),
  triggers: z.array(z.string()).min(1).max(5).optional()
    .describe('用户将来可能的提问（用于召回）'),
  target: z.string().optional(),
  mergeTargets: z.array(z.string()).optional(),
})
```

### WikiPageData（新增字段）

```ts
interface WikiPageData {
  name: string
  description: string
  category: string
  created: string
  updated: string
  // 新增
  source?: 'explicit' | 'inferred'
  aliases?: string[]
  triggers?: string[]
}
```

---

## 五、关键 Prompt 设计

### WIKI_MAINTAINER_PROMPT（核心原则）

```
## 核心原则

1. **编译知识，不转述原文**
   content 存储的是 AI 未来需要知道的信息，不是对话记录。

2. **增强优先于创建**
   先检查索引中是否有相关页面，有则更新，无则创建。

3. **保持一致性**
   新知识与旧知识矛盾时，用新信息覆盖。

4. **维护交叉引用**
   新增或更新页面时，检查是否需要 [[wiki-link]]。
```

### 「值得编译吗」判断标准

```
值得编译的信号：
- 用户说出了关于自己的事实（身份、偏好、习惯）
- 用户纠正或认可了 AI 的做法
- 对话中产生了有价值的技术分析或对比结论
- 沉淀了架构决策或技术选型的理由
- 总结了研究发现或最佳实践
- 建立了对某个工具/服务/人物的认知
- 用户提到需要跨会话记住的约束或决策

不值得编译：
- 可以从代码/文件/git 实时获取的信息
- 一次性任务，完成后不再有价值
- 纯粹的寒暄或情绪表达
```

### Content 编译规则（新增场景）

| 用户说的 | Content 写法 |
|---------|-------------|
| 直接事实「我喜欢X」 | "用户喜欢X" |
| 间接指令「根据X推导Y」 | 推导后的结论 |
| 行为纠正「不要做X」 | "禁止X" 或 "必须Y" |
| 技术对比「A和B哪个好」 | "在Y场景下，A优于Z，因为..." |
| 研究发现「这篇论文讲的是...」 | "关于X的研究发现：..." |
| 架构决策「我们选了X」 | "项目选择了X方案，原因是..." |

### WIKI_GUIDELINES_PROMPT（Agent 系统提示词注入）

```
## 知识库

你有一个持久化的知识库，存储了你积累的各种知识。

### 使用知识

当知识库中有相关信息时，直接使用，不要犹豫。

### 保存知识

当对话中产生值得跨会话保留的知识时，主动调用 save_wiki。

**保存的信号：**
- 用户说了关于自己的事实
- 你做了有价值的技术分析或对比
- 产生了架构决策或选型结论
- 总结了研究发现或最佳实践
- 建立了对实体（人物/工具/服务）的认知

**不要保存：**
- 可以从代码/文件实时获取的信息
- 临时性任务
- 即时情绪

### Query 结果回写

如果你在回答问题时产生了有价值的综合分析（对比、推理、总结），
应该保存为新页面。好的回答不应该消失在聊天历史中。
```

---

## 六、文件变更清单

### 核心修改（6 个文件）

| 文件 | 改动 |
|------|------|
| `wiki-config.ts` | `categories` 默认值改为新分类 |
| `wiki-prompt.ts` | 重写所有 prompt + schema（最关键） |
| `wiki-io.ts` | `WikiPageData` 接口新增字段，`parsePage` 解析新字段 |
| `save-wiki-memory.ts` | 工具名 `save_memory` → `save_wiki`，重写描述和 schema |
| `wiki-ingest.ts` | 适配新 schema，支持 triggers 匹配 |
| `wiki-query.ts` | 适配新分类展示 |

### 次要修改（3 个文件）

| 文件 | 改动 |
|------|------|
| `sections/wiki.ts` | 更新系统提示词注入格式 |
| `wiki-lint.ts` | 适配新分类的 lint 规则 |
| `read-wiki-page.ts` | 确认与新 schema 兼容 |

### 不需要修改

- `wiki-paths.ts` — 路径工具与分类无关
- `finalize.ts` — ingest 触发逻辑不变
- `wiki-context.ts` — 桥接层不变

---

## 七、迁移策略

### 现有数据迁移

1. 读取旧 wiki 目录中所有 .md 文件
2. 解析 frontmatter，按映射规则转换 category
3. 写入新格式（添加 source/aliases/triggers 空值）
4. 重建 index.md
5. 旧目录备份为 `_legacy`

### 不迁移的场景

如果旧数据质量差（大量原文转述），可以从空知识库重新开始。

---

## 八、验证方案

### 功能验证

1. **Ingest 测试**：构造包含技术对比的对话，验证 agent 能创建 domain 分类的页面
2. **Query 测试**：注入 index，验证 agent 能找到并使用领域知识
3. **Lint 测试**：验证新分类下的矛盾检测和孤儿检测正常工作
4. **Agent 工具测试**：验证 `save_wiki` 工具能创建各种分类的页面
5. **迁移测试**：验证旧数据能正确迁移到新格式

### 回归验证

- 现有用户记忆在迁移后仍可召回
- Agent 行为规则在新系统中正常工作
- index.md 格式正确，按新分类分组

---

## 九、实施顺序

1. **wiki-config.ts** — 更新分类默认值
2. **wiki-prompt.ts** — 重写所有 prompt 和 schema（最关键）
3. **wiki-io.ts** — 更新 WikiPageData 接口和解析逻辑
4. **save-wiki-memory.ts** — 更新工具名、描述和 schema
5. **wiki-ingest.ts** — 适配新 schema 和 triggers 匹配
6. **wiki-query.ts** — 适配新分类展示
7. **sections/wiki.ts** — 更新系统提示词注入
8. **wiki-lint.ts** — 适配新分类的 lint 规则
9. **迁移脚本** — 旧数据迁移
10. **测试** — 全流程验证
