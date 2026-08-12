# Memory 与 Wiki 边界规格

> 日期：2026-08-11（更新：2026-08-12）
> 状态：边界确定（一页纸），模块已实现第一版（见 [memory-module-design.md](./memory-module-design.md)）
> 参考：ChatGPT 记忆（Memory）、Karpathy LLM Wiki（Wiki）、[agent-ledger-design.md](./agent-ledger-design.md)（职责划分范式）
> 延伸阅读：[Claude Memory](https://claude.com/blog/memory)（产品设计：项目隔离 / 隐身模式 / 历史冷启动）、[Claude Managed Agents Memory](https://claude.com/blog/claude-managed-agents-memory)（工程实现：文件系统挂载 / 多 agent 共享 / 权限分层）

---

## 一、背景

现状 wiki 模块被系统提示词定义为「你的长期记忆」（见 `WIKI_GUIDELINES_PROMPT`），但 LLM Wiki 的品类是**知识积累**（从外部来源编译知识），不是**记忆用户**（记住关于用户的事实）。一个模块兼职两份工作 → 两头不靠。

解决：拆成两个一等模块。**Memory 管"记住你是谁"，Wiki 管"越来越懂你的世界"。** 与 Ledger（事实数值）/ Todos（任务状态）/ Skill（方法）并列。

## 二、定位

| | Memory（用户记忆） | Wiki（知识库） |
|---|---|---|
| 参考 | ChatGPT 记忆 / Claude Memory / Claude Code auto-memory | Karpathy LLM Wiki |
| 单位 | 原子记忆条目（短、独立）；可汇总为摘要展示 | 编译的知识页面（合成、演进） |
| 内容 | 关于用户的事实（偏好、身份、纠正、流程习惯） | 关于世界/业务的知识 |
| 维护 | 用户可见、可管理；显式记忆确定性写入 | LLM 做编译 / lint / 交叉引用 |
| 面向 | 用户（透明、控制）+ Agent 事实源 | Agent 认知复利 |
| 产品面 | 记忆面板（列表 / 增删 / pin / 摘要视图） | 现有 wiki 页面 / 图谱 / lint / log |
| 隔离粒度 | **项目级隔离**（不同项目/工作区记忆不交叉） | 全局共享 |

## 三、Memory 职责

**记什么：**
- 用户身份事实（我是谁、职业、家庭）
- 偏好（喜欢 / 讨厌 / 习惯）
- 行为纠正与规则（"不要做 X"、"以后都用 X"）
- 显式记忆（"记住这个"）

**规则：**
- 每条独立、短、用户可见可管理
- 显式记忆必须确定性写入，不依赖 LLM 编译判断
- 召回：注入 Agent 上下文；先关键词 + 触发词，语义检索后置
- **项目级隔离**：不同项目/工作区的记忆互不可见，防止跨业务线信息污染（同 Claude Memory 项目隔离设计）
- **隐身模式**：敏感对话可临时不写入记忆（用户主动关闭，或对话级 opt-out）
- **冷启动**：支持从历史会话批量提取初始记忆，降低上手门槛

**非职责（硬性）：**
- 不做知识编译 / 合成 / 交叉引用 —— Wiki
- 不做领域研究、对比分析 —— Wiki
- 不存可量化时序数据 —— Ledger
- 不存任务 / 项目状态 —— Todos
- 不存方法 / 流程 —— Skill

## 四、Wiki 职责（只列与 Memory 的边界）

- 保留：领域知识、对比结论、研究、系统机制、项目决策（agent / project / domain / entity / misc）
- **非职责：不承担用户记忆的产品面（面板 / 增删 / 显式记住）—— Memory**

## 五、判别路由（写进两者指引）

判据：**主语是「用户」还是「世界 / 知识」？**

| 信息 | 去向 |
|---|---|
| "我喜欢 X" "我的工作是 Z" "记住这个" | Memory |
| "不要做 X" "以后都用 X"（行为纠正） | Memory |
| "我们选了这个方案，因为…" 对比结论 研究 | Wiki |
| 可量化、要对比趋势（金价 / 日报 / 健康） | Ledger |
| 正在做什么、待办 | Todos |

## 六、交互

- Memory 是 Wiki 的**上游事实源（单向）**：Wiki 编译知识时可读取 Memory 的用户事实，增强相关性
- Memory 不消费 Wiki；避免循环依赖
- 二者均不绑定对方为固定出口

## 七、对现有系统的迁移

| 现有 | 去向 |
|---|---|
| wiki 页面 category=user | → Memory（减重：去掉交叉引用 / lint 要求） |
| wiki 页面 category=agent/project/domain/entity/misc | → 留在 Wiki |
| `WIKI_GUIDELINES_PROMPT` 中"你的长期记忆"措辞 | → 改为"知识库"；记忆的心智移入 Memory |
| `save_wiki` 工具 | 保留（知识） |
| 记忆工具 | 新增 `save_memory` 等（对齐旧 memory 模块的简化版） |

## 八、明确不做

- Memory 不做编译 / lint / 交叉引用 —— 那是为知识设计的，不是为记忆
- 不上向量库（语义检索后置）
- 不建"全能记忆引擎"
- 不跨项目共享用户偏好 —— 项目隔离是安全护栏，不是可选功能

## 九、待决策

1. ~~Memory 存储：单条目 md vs jsonl~~ → 已定：单条目 md（延续 git + 可读 + Obsidian 传统）
2. 行为规则是否单列 vs 归 Memory —— 默认归 Memory（用户可见可管理）
3. 语义召回引入时机 —— 量变再上（P2/P3）
4. ~~记忆格式：原子条目 vs 摘要聚合视图~~ → 已定：存储用原子条目（可追溯、可删），产品面提供摘要聚合视图（Claude Memory 做法）；两层分离
5. **多 agent 权限分层**（面向"数据助理"场景）：组织级记忆只读（业务口径、老板偏好）+ 用户级读写；参考 Claude Managed Agents 的权限模型，待数据助理场景验证后再落地（P3）
