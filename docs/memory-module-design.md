# Memory 模块设计 v2

> 日期：2026-08-12
> 状态：P0/P1/P2 已实施（save/delete 工具 + 三因子检索 + 记忆面板 UI + 冷启动）
> 边界规格见 [memory-wiki-boundary.md](./memory-wiki-boundary.md)（Memory 与 Wiki 职责划分）
> 本文档替代旧版 [memory-system-design.md](./memory-system-design.md)（2026-06-23 基于 LLM Wiki 重建记忆的方案——已被拆分为 Wiki + Memory 两个模块取代）

---

## 一、研究结论（权威论文）

记忆系统设计的方法论，从认知科学和 LLM 智能体研究中提炼如下。

### 1.1 记忆分类框架

**Atkinson & Shiffrin (1968)** 三存储模型（感觉/短时/长时记忆）是源头；**CoALA**（Sumers et al., 2023, arXiv:2309.02427）映射到语言智能体，定义四类记忆：

| 类型 | 含义 | TheThing 对应 |
|---|---|---|
| 工作记忆 | 当前决策周期活跃信息 | 上下文窗口 |
| 情景记忆 | 过去的交互记录 | 会话历史 |
| 语义记忆 | 关于世界和自身的知识 | **Wiki + Memory** |
| 程序性记忆 | 技能/流程 | Skills + 行为纠正 |

**关键**：CoALA 强调**读写权限分离**。Wiki = 只读语义记忆（知识）；Memory = 可写语义记忆（用户事实）。这正是 memory-wiki-boundary.md 的划分依据。

### 1.2 五大代表系统的设计

| 系统 | 论文 | 核心机制 | 对本模块的启发 |
|---|---|---|---|
| Generative Agents | Park et al. 2023, 2304.03442 | 记忆流逐条记录 + **recency×importance×relevance 三因子检索** + 定期反思巩固 | 检索打分模型（量变后引入） |
| MemGPT | Packer et al. 2023, 2310.08560 | 上下文当主存、外部存储当磁盘，**事件驱动写入**（模型自主调用） | 当前已采用：save_memory 由模型自主调用 |
| A-Mem | Xu et al. 2025, 2502.12110 | Zettelkasten 式结构化笔记 + 自动链接 + 记忆演化回写 | 关键词/标签字段（可选演进） |
| MemoryBank | Zhong et al. 2023, 2305.10250 | 记忆文件 + 艾宾浩斯遗忘曲线 | 会话末批量巩固、时间衰减（可选） |
| HippoRAG | Gutiérrez et al. 2024, 2405.14831 | 海马体理论 → 知识图谱 + PageRank 多跳检索 | 远期：需要多跳关联时再上 |

### 1.3 记忆质量控制（最重要）

**MemFail**（Garg et al. 2026, 2605.26667）把记忆系统拆成三个规范操作，各有专属失败模式：
- **Summarization（压缩）** — 最易失真丢信息
- **Storage（存储）** — 结构化程度越高、忠实度越高
- **Retrieval（检索）** — 语义检索不理解时序

配套结论：
- **来源引用**是防幻觉第一道闸——每条记忆必须可归因到源消息（Synthius-Mem, 2604.11563）
- 提取 prompt 应按记忆域**分开定制**，不存在万能提取 prompt（Yang et al. 2026, 2604.11610）
- 低置信记忆支持**弃权/拒答**（LongMemEval, 2410.10813 把 abstention 列为五大脑力之一）

### 1.4 冲突处理

**"Don't Ask the LLM to Track Freshness"**（2606.01435）把记忆冲突分为三类：
- **互斥替换型**（current-value）：同一属性只有最新值正确 → 取 `max(timestamp)`，确定性代码
- **历史相对型**（historical）：问"之前的状态" → 需要第 k 新值，不覆盖
- **聚合过滤型**（aggregation）：按事件时间窗口过滤

关键主张：**LLM 做语义匹配，版本比较交给确定性代码**，不让 LLM 既判断相关性又判断新旧。

偏好冲突（A vs B）区分"互斥替换"和"累加共存"没有通用自动规则——取决于该属性的**语义域是单值还是多值**。

### 1.5 隐私与用户控制（业界共识）

OpenAI/Anthropic 一致的四原则：**透明（可查看）、可编辑、可删除、可关闭**。
- Anthropic Memory tool 强调：路径穿越防护、拒绝写入敏感信息、定期清理长期未访问文件
- Always-On Agents（2606.30306）提出治理六轴：Authority / Scope / Mutability / Provenance / Recoverability / Actionability
- 外部文件存储天然满足"被遗忘权"——删除条目即物理删除，无需参数化机器遗忘

---

## 二、设计原则（从研究提炼）

1. **代码只做 IO，判断交给 LLM**（沿用 Karpathy 范式）——但与 Wiki 不同，Memory 不做编译/lint/交叉引用
2. **原子事实 + 结构化元数据**，落盘 Markdown——可追溯、可单独编辑/删除
3. **来源引用必带**——防幻觉第一道闸
4. **事件驱动写入**（MemGPT 范式）——模型自主调用 save_memory
5. **按记忆域分 prompt**——identity/preference/correction/explicit 分开指导提取
6. **检索先简单后复杂**——现有关键词+全量注入，量变后再上三因子打分/top-k/语义检索
7. **用户控制优先**——透明、可编辑、可删除、可关闭是信任地基
8. **外部存储优于参数化**——删除即物理删除，不做复杂机器遗忘

---

## 三、当前实现状态（2026-08-12 已落地）

### 3.1 存储

- 目录：`~/.thething/memory/<id>.md`（扁平）
- 格式：frontmatter + 内容

```markdown
---
id: abc123def456789a
type: preference          # preference | identity | correction | explicit
dimension: display-format # 可选：语义域（单值属性填，多值不填）
source: 用户原话            # 可选：来源引用（防幻觉）
importance: 6             # 可选：1-10 检索权重（缺省按 type 派生）
pinned: false
created: 2026-08-12T01:57:12.992Z
updated: 2026-08-12T01:57:12.992Z
---
不喜欢看表格，回复时用文字表述
```

### 3.2 工具

- `save_memory`（content / type / dimension? / source? / importance?）
- `delete_memory`（id）
- 注册在 `loadAllTools`，有 `memoryBaseDir` 时注入
- 敏感信息由 prompt 约束（LLM 自觉不写），不做代码正则拦截——语义判断交给 LLM，用户可删兜底

### 3.3 系统提示词注入

- `memory-guidelines`（priority 43）— MEMORY_GUIDELINES_PROMPT（按域细分 + 冲突处理 + 敏感信息规则）
- `recalled-memory`（priority 44）— 三因子（recency×importance×relevance）打分排序，top-k（20）注入；relevance 用最后一条用户消息做轻量关键词匹配

### 3.4 文件清单

```
packages/core/src/modules/memory/
├── index.ts            # barrel export
├── memory-paths.ts     # getPrimaryMemoryDir (~/.thething/memory)
├── memory-io.ts        # read/write/delete/update + 序列化
├── memory-prompt.ts    # MEMORY_GUIDELINES_PROMPT + formatMemoryForPrompt
├── memory-query.ts     # 三因子检索（recency×importance×relevance + top-k）
└── memory-extract.ts   # 冷启动：历史会话 → 记忆提取

packages/core/src/modules/tools/
├── save-memory.ts      # save_memory 工具
└── delete-memory.ts    # delete_memory 工具

packages/core/src/modules/system-prompt/sections/memory.ts  # guidelines + recalled sections

packages/app/
├── app/api/memory/route.ts              # GET/POST/PUT/DELETE 记忆 CRUD
├── app/api/memory/extract/route.ts      # 冷启动提取（POST）
├── app/settings/memory/page.tsx         # 记忆面板页面壳
└── components/UserMemorySettings.tsx    # 记忆面板组件
```

---

## 四、差距分析（研究 vs 现状）

| 维度 | 学术界共识 | 当前实现 | 差距 |
|---|---|---|---|
| 来源引用 | 每条记忆可归因到源消息 | ✅ source 字段 | 无 |
| 敏感信息防护 | 拒绝写入密码/证件号 | ✅ prompt 约束（LLM 自觉不写）+ 用户可删 | 无代码拦截（有意） |
| 按域定制提取 | 每域独立 prompt | ✅ 四域分小节指引 | 无 |
| 注入量控制 | 常驻小索引 + 按需 top-k | ✅ 三因子打分 + top-k(20) 注入 | 无 |
| 冲突处理 | 区分单值/多值属性 | ✅ dimension 字段 + 同域冲突返回 | 无 |
| 遗忘 | 显式删除 + 可选衰减 | ✅ delete_memory + 面板删除/清空 | 无衰减（可选） |
| 用户控制 | 查看/编辑/删除/关闭 | ✅ 记忆面板（列表/搜索/筛选/增删/清空/提取） | 无总开关（可选） |
| 冷启动 | 从历史会话批量提取 | ✅ extractMemoriesFromHistory + 面板按钮 | 无 |
| 弃权 | 低置信拒答 | ❌ 无 | 可选 |

---

## 五、目标设计（演进路线）

### P0（已实施）：基础闭环
- 原子条目存储 + save/delete 工具 + 每轮注入 ✅

### P1（已实施）
1. **source 字段**：记忆条目加来源引用（哪条消息/哪轮对话），防幻觉第一闸 ✅
2. **敏感信息防护**：prompt 约束（LLM 自觉不写），不做代码正则拦截 ✅
3. **按域细分提取指引**：MEMORY_GUIDELINES_PROMPT 按 identity/preference/correction/explicit 分小节 ✅
4. **冲突确定性处理**：save_memory 同 dimension 冲突检测，返回 warning 由 Agent 判断 ✅

### P2（已实施）
5. **检索升级**：recency×importance×relevance 三因子打分，top-k(20) 注入；relevance 用最后一条用户消息轻量关键词匹配 ✅
6. **记忆面板（UI）**：/settings/memory 页，列表/搜索/类型筛选/增删/清空 ✅
7. **冷启动**：extractMemoriesFromHistory + 面板"从历史对话提取"按钮 ✅

### P3（远期）
8. **语义检索**：量变到向量库值得引入时再上（当前明确不上）
9. **记忆巩固**：会话末批量提取（MemoryBank 范式）
10. **时间衰减/清理**：艾宾浩斯式或"长期未访问自动清理"（Anthropic 建议）
11. **多 agent 权限分层**：数据助理场景验证后，组织级只读 + 用户级读写
12. **记忆总开关 / 临时会话**：用户控制四原则补全

---

## 六、参考论文与文档

**记忆分类**
- Atkinson & Shiffrin (1968) 三存储模型
- CoALA — Sumers et al., arXiv:2309.02427

**代表系统**
- Generative Agents — Park et al., arXiv:2304.03442
- MemGPT — Packer et al., arXiv:2310.08560
- A-Mem — Xu et al., arXiv:2502.12110
- MemoryBank — Zhong et al., arXiv:2305.10250
- HippoRAG — Gutiérrez et al., arXiv:2405.14831

**质量控制**
- MemFail — Garg et al., arXiv:2605.26667
- Self-Evolving Memory Extraction — Yang et al., arXiv:2604.11610
- LongMemEval — arXiv:2410.10813

**冲突与新鲜度**
- Don't Ask the LLM to Track Freshness — arXiv:2606.01435
- Memory Retrieval for Changing Preferences — arXiv:2606.02976

**隐私与治理**
- Always-On Agents — arXiv:2606.30306
- Agents That Know Too Much — arXiv:2606.26627

**工业实践**
- OpenAI: Memory and new controls for ChatGPT (2024)
- Anthropic: Memory tool 文档 / Claude Code auto-memory 文档
- Anthropic: Effective Context Engineering for AI Agents (2025)
