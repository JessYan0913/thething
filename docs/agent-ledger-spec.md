# Agent 账本模块（Ledger）完整设计规格

> 日期：2026-08-01
> 状态：完整设计（一次性落地，不分阶段）
> 概念文档：docs/llm-ledger.md（是什么、为什么）
> 本文件：怎么做（完整规格）

---

## 一、定位与边界

### 定义

账本是产品为 Agent 提供的一级数据能力模块——Agent 的「事实账本」。它让 Agent 拥有时间维度：把每次任务产生的结构化事实可靠地记录下来，并提供快速回顾、查询、聚合和统计计算所需的数据基础。

### 非职责边界（硬性）

- **不做价值评判**：不判断数据/趋势/数据集是否"重要、低价值、值得沉淀"
- **不做语义结论**：不替 Agent 生成业务结论、归因解释或长期知识总结
- **不决定下一步行动**：不自行决定是否补采、清理、归档或调用其他模块
- **不绑定外部出口**：不把 Wiki、报告、通知等作为固定流程的一部分

### 与 Wiki / Skill 的关系

- 账本存事实与数值；Wiki 可存 Agent 判断后选择的结论；Skill 存方法（如何采集、如何分析、如何使用账本）
- Wiki 是可选下游消费者，不是账本的依赖、固定出口或验收条件
- 「Agent 怎么看、怎么用账本」由使用编排 Skill 承载，不内建在账本内核

---

## 二、总体架构

```
┌────────────────────────────────────────────────────┐
│ Agent（决策者）                                     │
│   判断是否需要数据 · 解读结果 · 决定下一步           │
└───────────────────────┬────────────────────────────┘
                        │ 遵循指引（system prompt + 业务 Skill 内嵌指导）
┌───────────────────────▼────────────────────────────┐
│ 使用引导（对齐 Wiki 模式）                           │
│   LEDGER_GUIDELINES_PROMPT 注入 system prompt       │
│   业务 Skill 步骤内明确 Ledger 用法                  │
└───────────────────────┬────────────────────────────┘
                        │ 调用受控工具
┌───────────────────────▼────────────────────────────┐
│ Ledger 内核（确定性）                               │
│  ┌──────────────────────────────────────────────┐  │
│  │ 工具层                                        │  │
│  │   append（写·唯一） query/aggregate/stat（读）│  │
│  │   lint（检）        rollup/prune（治·受控）   │  │
│  ├──────────────────────────────────────────────┤  │
│  │ 校验器 ledger-check                           │  │
│  │   schema 合规 · 幂等 · 范围 · 时间单调        │  │
│  ├──────────────────────┬───────────────────────┤  │
│  │ 文件层（事实源）      │ 单向导入               │  │
│  │ data.jsonl append-   │  ────────────────►    │  │
│  │ only · git 审计      │                       │  │
│  └──────────────────────┴───────────────────────┘  │
│                    索引层（查询计算）               │
│                    ledger.db（SQLite）可重建        │
└───────────────────────┬────────────────────────────┘
                        │ 数据经唯一写入口 append 流入
┌───────────────────────▼────────────────────────────┐
│ 外部世界：MCP · 连接器 · 定时任务（只读来源）        │
└────────────────────────────────────────────────────┘
```

**架构原则：**

1. **文件为源，索引为算** — 事实唯一真源在 append-only 文件；SQLite 是查询与计算的派生索引，单向导入、可删掉重建
2. **写路径唯一** — 所有写只走 append 工具；破坏性操作在结构上不存在
3. **校验是代码，不是模型** — schema/幂等/范围/单调检查全部确定性执行
4. **治理是阈值，不是心情** — rollup/prune 由确定性规则触发，留审计
5. **感知靠目录，使用靠引导** — Agent 通过 catalog 感知数据资产；Ledger 用法由模块指引（注入 system prompt）+ 业务 Skill 内嵌指导承载，不设独立编排 Skill
6. **不做价值判断** — 内核只返回事实、统计结果、质量与治理状态

---

## 三、存储设计（文件层 + 索引层，同时存在）

### 3.1 文件层（事实源）

```
~/.thething/ledger/
├── catalog.json              # 派生：数据集清单与健康度（索引层生成）
├── runs.log                  # 追加：每次操作的执行记录
├── governance.log            # 追加：治理审计（何时清理了什么）
├── ledger.db                 # SQLite 索引（查询层）
└── <dataset-name>/
    ├── schema.json           # 模板固定：字段/类型/单位/范围/identity
    └── data.jsonl            # append-only：每行一条事实记录
```

文件层约定：

- `data.jsonl` 每行一个 JSON 对象，**只追加，不修改、不删除**
- 时间统一 ISO 8601 含时区（如 `2026-08-01T09:00:00+08:00`），不发明时间格式
- 数值单位在 schema 中声明，写入时校验
- 整个目录纳入 git：版本历史、diff、回溯免费获得
- 文件层永不接收直接写操作；Agent 只能通过 append 工具写入

### 3.2 索引层（SQLite）

| 表 | 字段 | 说明 |
|----|------|------|
| `datasets` | name PK, schema_json, retention_policy_json, created_at, updated_at | 数据集定义 |
| `records` | dataset_id, observed_at, ingested_at, source_type, source_id, dedupe_key, payload_json, schema_version, status | 事实记录；`PRIMARY KEY(dataset_id, dedupe_key)` 强制幂等 |
| `runs` | id PK, dataset_id, execution_id, operation, status, started_at, finished_at, error, meta_json | 操作执行记录；`execution_id` 关联外部自动化执行 |
| `governance_events` | id PK, operation, dataset_id, criteria_json, affected_count, executed_at, meta_json | 治理审计 |

关键约束：

- **幂等在索引层强制执行**：`PRIMARY KEY(dataset_id, dedupe_key)`——重复 append 物理上不可能产生重复行
- `observed_at`（事实发生时间）与 `ingested_at`（服务端入账时间）分开，补采/延迟不会污染时间轴
- `source_type` / `source_id` 由可信执行上下文注入（connector / cron / execution id），外部来源信息只进 payload
- `schema_version` 记录每行的写入版本，schema 演进不影响历史解释

### 3.3 单向导入机制（ledger-index）

- 文件层是唯一真源；索引层是派生视图
- `ledger-index` 增量同步：读取 data.jsonl 新行 → upsert 进 records → 更新 catalog
- **可重建性**：索引层删除后，从文件层全量重建即恢复——不存在双写一致性问题
- 导入时机：append 写入后立即同步 + cron 定期全量校验

### 3.4 为什么不是"纯文件"或"纯数据库"

| 维度 | Wiki（文本） | Ledger（数据） |
|------|-------------|----------------|
| 检索方式 | LLM 读文本 + index + grep | SQL 查询（范围/维度/聚合） |
| grep 够用吗 | 够（几千页） | 不够（几十万行是常态） |
| 聚合计算 | 无需求 | 核心需求 |
| 出错容差 | 高（可改可重写） | 低（事实错了就是错了） |

文件能存，但不能算；数据库能算，但失去审计可读性。**两者并存才是完整形态：文件是事实的账簿，数据库是账簿的算盘。**

---

## 四、数据模型与 Schema 契约

### 4.1 数据集定义（schema.json）

```json
{
  "version": 1,
  "name": "gold-price",
  "description": "每日金价采集",
  "timeZone": "Asia/Shanghai",
  "identity": ["market", "observed_at"],
  "fields": {
    "price": { "type": "number", "role": "measure", "unit": "CNY/g", "min": 0, "max": 10000, "nullable": false },
    "market": { "type": "string", "role": "dimension", "nullable": false }
  },
  "retention": { "detail_days": 90, "rollup_granularity": "week" }
}
```

契约规则：

- `fields`：字段必须有类型、角色（measure/dimension）、单位（数值）、范围（数值）、可空性
- `identity`：声明幂等键的组成字段（与 observed_at 组合），内核据此生成/校验 dedupe_key
- **schema 由模板固定，Agent 不自由发明字段**；字段可追加，不可删除；形态变化走新数据集
- `retention`：保留策略（明细保留期、降采样粒度），治理阈值从这里读取

### 4.2 记录字段

| 字段 | 谁填 | 说明 |
|------|------|------|
| `payload` | Agent | 数据集声明的字段值 |
| `observed_at` | Agent/数据源 | 事实发生时间 |
| `ingested_at` | 内核 | 服务端入账时间，强制注入 |
| `source_type` / `source_id` | 内核 | 可信执行上下文 |
| `dedupe_key` | 内核 | 由 identity + observed_at + source 生成 |
| `schema_version` | 内核 | 写入时的 schema 版本 |
| `status` | 内核 | accepted / suspect / rejected / superseded |

---

## 五、工具接口

| 工具 | 动作 | 职责 |
|------|------|------|
| `ledger_create` | 记前准备 | 按模板声明数据集 schema 与保留策略 |
| `ledger_append` | 记（唯一写） | 追加一条记录：校验 → 幂等 → 落文件 → 同步索引 |
| `ledger_catalog` | 感知 | 返回数据集清单：时间范围、记录数、健康度、最近更新 |
| `ledger_query` | 查 | 只读查询：时间范围 + 维度过滤 + 字段选择 |
| `ledger_aggregate` | 算 | 按时间/维度分组聚合（avg/sum/min/max/count） |
| `ledger_stat` | 算 | 确定性统计特征（移动平均、波动率、趋势系数），只返回数值 |
| `ledger_lint` | 检 | 健康检查：缺失日期、重复、异常值、新鲜度，不推断业务影响 |
| `ledger_rollup` | 治 | 按数据集策略或明确条件聚合降采样 |
| `ledger_prune` | 治 | 按明确时间/容量/状态条件受控清理；必须支持 dry-run |
| `ledger_export` | 治 | 数据集导出（jsonl / csv） |

**读能力分层（安全边界）：**

| 层 | 能力 | 护栏 |
|----|------|------|
| 第 1 层 | 预定义 API（catalog/query/aggregate/stat/lint） | 覆盖日常需求，写路径唯一 |
| 第 2 层 | 只读 SQL（SELECT + 聚合） | 语法校验、强制 LIMIT、超时；禁写操作 |
| 第 3 层 | 只读计算脚本（沙箱） | 预注册、读快照副本，原始数据不可被改动 |

**底线：写永远只走 append；读可以逐层放开。**

---

## 六、写入路径（时序）

```
Agent/采集管线 调用 ledger_append
  1. schema 校验      payload 字段类型/单位/范围/必填是否符合 schema
  2. 幂等校验         按 identity + observed_at 生成 dedupe_key，索引层查重
  3. 元数据注入       ingested_at / source_type / source_id / schema_version / status
  4. 落文件           原子追加一行到 data.jsonl
  5. 同步索引         upsert 进 records（唯一约束兜底幂等）
  6. 记录 run          追加 runs.log + runs 表
  返回：record id 或 "duplicate（已存在，未重复写入）"
```

- 重复执行同一采集 → 返回幂等结果，不产生污染
- 校验失败 → 拒绝写入，返回具体字段与原因（不改数据、不猜测业务影响）

---

## 七、查询与感知

### 感知：ledger_catalog

Agent 面对任务时先查目录，感知自己"拥有"什么：

```json
[
  { "name": "gold-price", "range": ["2026-07-01", "2026-08-01"],
    "records": 31, "last_ingested": "2026-08-01T09:00:00+08:00",
    "health": { "missing_days": 0, "suspect": 0 } }
]
```

### 查询与计算

```sql
-- 过去 30 天日均价与波动（索引层一行 SQL）
SELECT date(observed_at), AVG(price), MAX(price), MIN(price)
FROM records WHERE dataset_id = 'gold-price'
  AND observed_at >= date('now', '-30 day')
GROUP BY date(observed_at);
```

- `ledger_stat` 提供移动平均、波动率、趋势系数等确定性算法，只返回数值
- 分析结果的解释、价值判断、下一步行动，全部由 Agent 完成

---

## 八、质量与校验（ledger-check）

写入时校验（append 内联）+ 定期全量校验（cron）：

| 检查 | 规则 | 输出 |
|------|------|------|
| schema 合规 | 字段类型/单位/范围/必填 | 具体字段 + 行号 |
| 时间单调 | observed_at 不倒退、不超前于 now | 异常行 |
| 幂等 | dedupe_key 无重复 | 重复行 |
| 缺失检测 | 按 identity 期望的频率检查空档 | 缺失日期清单 |
| 新鲜度 | last_ingested 距今超阈值 | 停滞数据集 |

- 输出为问题清单（文件 + 行号），**不推断业务影响**
- 异常值可标记 `status = suspect`，不物理删除——保留可追溯性

---

## 九、治理与生命周期（阈值触发，确定性）

### 规则来源

- 数据集 `retention` 策略（明细保留期、降采样粒度）
- 全局容量阈值（数据集行数、目录体积）

### rollup（降采样）

- 触发：明细超过保留期 或 行数超过阈值
- 执行：按粒度（日/周/月）聚合为摘要记录（新数据集或摘要标记）
- 摘要保留原数据的统计口径（含 record_count、缺失标记）

### prune（清理）

- 触发：超过保留期 / 容量超限 / 明确的 Agent 指令
- 要求：
  - **必须先 dry-run**：返回将要清理的范围、数量、原因
  - 执行后写 `governance.log`（操作、条件、影响数、时间）
  - 默认只清理已 rollup 覆盖的过期明细

### 触发机制

- cron 定期检查 + 阈值判断，确定性执行
- Agent 可调用治理工具，但必须携带明确条件（不允许模糊授权）

---

## 十、使用引导（对齐 Wiki 模式）

Ledger **不创建独立的"使用编排 Skill"**。让 Agent 学会使用 Ledger 的方式与 Wiki 模块完全一致，分两层：

### 10.1 模块自带全局指引（system prompt 注入）

Ledger 模块提供 `LEDGER_GUIDELINES_PROMPT`（对齐 Wiki 的 `WIKI_GUIDELINES_PROMPT`），由 system prompt 构建时注入，让 Agent 从会话开始就知道 Ledger 是什么、何时该用：

```text
## 事实账本（Agent 的结构化历史数据）

账本记录可量化、未来会被对比的任务数据（监控 / 行情 / 日报 / 健康）。
- 采集：任务产生可量化结果时，通过 ledger_append 记录；先 ledger_create 声明数据集
- 回顾：涉及 趋势/对比/历史/波动 时，先 ledger_catalog 查看已有数据，再查询
- 计算：数值统计用 ledger_aggregate / ledger_stat，不要自己口算
- 数据不足不下结论；缺失注明日期；不重复采集同一天的数据
- ���理：ledger_prune 必须先 dry-run，确认后再执行
```

- 注入方式对齐 `modules/system-prompt/sections/wiki.ts`：条件为 ledger 目录已配置，`cacheStrategy: 'session'`
- 工具描述（zod `describe`）里同样写明"何时该用"，与 Wiki 工具描述风格一致

### 10.2 业务 Skill 内嵌使用指导

在编写**具体业务操作的 Skill**（如金价采集、每日日报、健康监控）时，在步骤里明确告诉 Agent 该场景下如何使用 Ledger。示例：

```markdown
# gold-price-collector

每天 09:00 采集今日金价。
1. 调用行情 API 获取今日金价
2. 用 ledger_append 写入 gold-price 数据集（price/market/observed_at）
3. 如需对比历史：先 ledger_catalog 确认数据范围，再 ledger_aggregate
4. 当日已有记录时 ledger_append 返回 duplicate，视为正常，不要重复写入
```

- 每个业务 Skill 只描述自己场景内的 Ledger 用法，不做通用编排
- 何时用 Ledger、用哪些工具，由业务场景决定，由业务 Skill 表达

### 10.3 系统层职责

系统层只做一件事：可发现性（与 Wiki 一致——指引注入 system prompt，工具注册进工具列表）。**不额外做"场景识别 + Skill 推荐"等编排机制。**

---

## 十一、安全与权限

| 威胁 | 防护 |
|------|------|
| Agent 绕过 append 写事实 | 工具层唯一写入口；文件目录对 Agent 只读（受控工具屏蔽直接写） |
| 任意 SQL 破坏 | 只读 SQL 层：语法校验、禁写关键字、强制 LIMIT、超时 |
| 误删事实 | prune 必须 dry-run；审计日志；治理默认只清已聚合的过期明细 |
| schema 漂移 | 字段追加制、schema_version、模板固定 |
| 容量失控 | 配额阈值 + 确定性 rollup/prune；超限时拒绝写入而非静默丢弃 |
| 重复污染 | 索引层唯一约束（dataset_id, dedupe_key）物理兜底 |

---

## 十二、验收标准

1. **积累**：同一任务运行 30 天后，Agent 能一次查询获得连续历史，并完成时间范围内的对比、趋势和异常分析
2. **检索**：范围/维度/聚合/统计查询在索引层完成；百万行级数据查询可接受
3. **幂等**：同一 dedupe_key 重复 append 不产生重复事实
4. **可重建**：索引层删除后从文件层重建，查询结果与重建前一致
5. **职责边界**：账本只返回事实、统计结果和治理状态，不输出语义判断
6. **治理可审计**：rollup/prune 全程记录 governance.log；prune 支持 dry-run
7. **容量有界**：长期运行体积受策略控制，不依赖账本自行评判价值
8. **安全**：Agent 无法绕过 append 写入事实；只读 SQL 无法写库
9. **简单**：一次采集 = create（可省）+ append；一次回顾 = catalog + query/aggregate

---

## 十三、实现方式（对齐 Wiki 模块）

Ledger 按 Wiki 模块的成熟结构实现，作为完整的一级模块：

### 13.1 模块目录（对齐 `modules/wiki/`）

```
packages/core/src/modules/ledger/
├── index.ts              # 统一导出（对齐 wiki/index.ts）
├── ledger-config.ts      # LedgerConfig：目录布局、索引文件、保留默认值（对齐 wiki-config.ts）
├── ledger-paths.ts       # 路径与数据集目录解析（对齐 wiki-paths.ts）
├── ledger-io.ts          # 文件层读写：data.jsonl 原子追加、schema 读写（对齐 wiki-io.ts）
├── ledger-store.ts       # 索引层：SQLite records/runs/governance_events（复用 DataStore 模式）
├── ledger-index.ts       # 单向导入：文件 → 索引增量同步 / 全量重建
├── ledger-query.ts       # 查询与聚合：catalog / query / aggregate / stat（对齐 wiki-query.ts）
├── ledger-lint.ts        # 校验与健康检查：ledger-check（对齐 wiki-lint.ts）
├── ledger-maintenance.ts # 维护状态：健康度、过期判断（对齐 wiki-maintenance.ts）
├── ledger-prompt.ts      # LEDGER_GUIDELINES_PROMPT + zod schema（对齐 wiki-prompt.ts）
├── ledger-mutation.ts    # 写入串行化锁（对齐 wiki-mutation.ts）
└── __tests__/
```

### 13.2 工具层（对齐 `modules/tools/`）

每个工具一个文件、工厂函数模式（`createLedgerXxxTool(config)`），与 `createSaveWikiTool` 同构：

```
modules/tools/
├── ledger-create.ts      # 声明数据集
├── ledger-append.ts      # 唯一写入口（校验 → 幂等 → 落文件 → 同步索引）
├── ledger-catalog.ts     # 数据集清单与健康度
├── ledger-query.ts       # 只读查询
├── ledger-aggregate.ts   # 聚合
├── ledger-stat.ts        # 统计特征
├── ledger-lint.ts        # 健康检查
├── ledger-rollup.ts      # 降采样
├── ledger-prune.ts       # 受控清理（强制 dry-run）
└── ledger-export.ts      # 导出
```

### 13.3 注册与注入（对齐 Wiki）

- `modules/agent/tools.ts`：`config.ledgerDir` 存在时注册全部 `ledger_*` 工具（对齐 Wiki 工具注册块）
- `modules/system-prompt/sections/ledger.ts`：`createLedgerGuidelinesSection(ledgerDir)` 注入 `LEDGER_GUIDELINES_PROMPT`（对齐 `createWikiGuidelinesSection`，`cacheStrategy: 'session'`）
- 存储路径：`~/.thething/ledger/`（对齐 `~/.thething/wiki/`），遵循 `ResolvedLayout`

### 13.4 UI 与 API（对齐 Wiki 的设置页）

对齐 `settings/wiki` 提供 Ledger 管理页：数据集列表、数据量、采集历史、健康度、导出与清理。

### 13.5 执行上下文衔接

- `runs.execution_id` 关联现有 cron execution / conversation run，不重复定义自动化生命周期
- 可选：Agent 自身运行数据（成本、耗时、成功率）以记账方式进入账本，支撑自我治理
