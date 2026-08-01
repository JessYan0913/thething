# 技能常驻集设计（Skill Resident Set）

> 状态：已实施（2026-08-01）
> 背景问题会话：`/chat/user/MihtfMdwi2kc3HI5Ytg4e`（create-skill 未被调用）

## 1. 问题（已在代码中逐条核实）

技能列表注入系统提示词的现行实现（`modules/skills/budget-formatter.ts` 的 `formatSkillsWithinBudget`，由 `modules/system-prompt/builder.ts` 的 skill-matching section 调用）在技能规模增长后失效：

1. **预算挤压**：当前 89 个文件级技能的 description + whenToUse 全量 ≈ 31k 字符，另有每条 `(source: <绝对路径>)` ≈ 6k 字符，远超 8000 字符预算（builder 调用时未传 contextWindowTokens，走 `DEFAULT_CHAR_BUDGET`）。均摊后 `maxDescLen < MIN_DESC_LENGTH(20)`，触发极端分支（budget-formatter.ts:128-138）——**所有技能只剩名字 + 路径，description/whenToUse 全部丢弃**。更糟的是该分支保留的恰是对模型无用的绝对路径（skill 工具按 name 查找，见 skill.ts:62），丢弃的恰是触发词。实证：用户说"编写一个skill"，模型没有调用 create-skill，手写了 SKILL.md。
2. **豁免集合是死代码**：`FULL_DESC_SOURCES = {'bundled', 'project'}`（budget-formatter.ts:63），但 `ConfigSource` 合法值是 `'builtin' | 'user' | 'project' | 'plugin'`（primitives/constants.ts:29）——**`'bundled'` 不是合法 source 值，永远匹配不到任何技能**。bundled.ts 生成的 create-skill 是 `source: 'builtin'`，本该保留完整描述的内置技能同样被剥成名字。
3. **单条截断上限偏低**：`MAX_DESC_CHARS = 250`，而实测 89 个技能 description + whenToUse 的中位数是 336 字符——即使不触发极端分支，**半数以上技能的触发词也会被截掉一部分**。
4. **规模天花板**：即使修掉上述问题，全量注入是 O(N) 常驻成本，1000 个技能 ≈ 100k tokens，不可持续；且清单越长，模型"从 N 个描述里挑对 1 个"的选择噪声越大。

## 2. 设计决策

**核心思路：常驻清单设上限 + 全量目录走检索。** 不做每轮消息的自动语义召回（embedding / 小模型重排），改为"确定性的常驻集选择 + 模型主动检索"。

技能 section 从"全量列表 + 预算裁剪"改为三段式：

```
## 技能 section（skill-matching，session 缓存策略）
├─ A. 常驻清单（≤N 条，name + description + whenToUse，单条上限 500 字符）
├─ B. 目录引导（其余技能只列名字 + 一句 find_skills 检索引导）
└─ C. create-skill 引导语（现有 skillCreationNote，保留）
```

上下文占用从 O(全量描述) 变为 O(N×单条上限 + 全量×名字长度)。技能涨到几百个时 B 段可进一步折叠为类别摘要（本期不做）。

### 2.1 常驻集选择器（A 段）

确定性打分排序，取前 N（默认 40，可配置）。优先级从高到低：

| 优先级 | 信号 | 说明 |
|---|---|---|
| 1 | Agent 绑定 | Agent 定义 `skills` 为白名单数组时，数组内技能无条件常驻（后续实施，本期留接口） |
| 2 | builtin | create-skill 等内置技能无条件常驻 |
| 3 | 用户置顶（pinned） | preferences 中的 pinned 列表 |
| 4 | project 来源 | 当前项目的技能天然相关 |
| 5 | 活跃度 | `use_count` + `last_used_at` 时间衰减排序 |

同优先级内按活跃度降序，无使用记录按名字排序（保证确定性）。

**会话内稳定性（缓存约束）**：skill-matching section 是 `session` 缓存策略、prompt 前缀的一部分，而 `createAgent()`（composition/app/create.ts）是**每请求重建**的。因此常驻集必须缓存在进程级、以 conversationId 为键（`getSessionSkillResidentSet`，LRU 上限 200 会话防泄漏），同一会话内每次 createAgent 取到相同结果，不随使用统计变化重排，否则破坏 prompt cache。使用统计只影响**新会话**的常驻集。

### 2.2 A 段截断策略（新增，明确规则）

原 250 字符上限截掉半数技能的触发词，是本次要解决的问题的一部分，规则改为：

- 常驻条目单条上限 `MAX_RESIDENT_ENTRY_CHARS = 500`（description + whenToUse 合并后截断）。中位数 336 的技能完整保留；超限的主要是十余个视频类技能（最长 1018），触发词通常前置，尾部截断可接受。
- **builtin 与 pinned 条目不截断**——builtin 是产品自身能力，pinned 是用户显式声明"这个对我重要"。
- 常驻条目**不再携带 sourcePath 绝对路径**（原 overhead 主因之一）。技能定位由 skill 工具按 name 完成；`(outputs: ...)` paths 提示保留。
- `formatSkillsWithinBudget` 的"预算均摊裁剪到只剩名字"路径整体废弃，由常驻集选择器取代；`truncateDescription` 等工具函数复用。

### 2.3 目录引导（B 段）

落选技能不丢弃，降级为纯名字列表（逗号分隔，不带路径），并附一句引导：

> 以上技能仅列出名称。需要了解详情或发现更多技能时，使用 `find_skills` 工具检索。

保证模型"知道存在"，召回 miss 时能自救。禁用（disabled）的技能连目录都不进。

### 2.4 find_skills 内置工具（检索通路）

`find-skills` 做成**内置工具**而非技能（技能形态要先被发现才可用，鸡生蛋问题；工具形态才是常驻基础设施）。

- 位置：`modules/tools/find-skills.ts`，在 `modules/agent/tools.ts` 与 skill 工具同点接线，共享同一份 skills 快照与 `reloadSkills` 钩子（快照未命中时重扫磁盘，与 skill.ts:198 行为一致）。
- 输入：`query`（关键词），`limit`（默认 10）。
- 实现：对全量技能的 name / description / whenToUse 做大小写不敏感的子串 + 分词匹配打分，返回 top-k 完整元数据（name、description、whenToUse）。disabled 技能不返回。
- 89 条规模纯内存扫描即可。**不建 SQLite FTS、不引入 embedding**——几百条以后按需替换实现，接口不变。

### 2.5 使用统计

- 存储：`<layout.dataDir>/skill-usage.json`（默认 `~/.thething/data/skill-usage.json`），结构 `{ [name]: { count, lastUsedAt } }`。不进 chat.db，避免 schema 迁移；技能是用户级资源，统计也应是用户级。类型复用已存在的 `SkillUsageRecord`（modules/skills/types.ts:82，目前无人引用）。
- 记录点：skill 工具 execute 成功加载技能后 `recordSkillUsage(...)`，内部容错（写失败仅 debug 日志，不影响技能执行）。
- 写入方式：读-改-写 + 临时文件原子 rename。**已知取舍**：多会话并发写为 last-writer-wins，可能丢个别计数——统计只用于排序，丢一笔无影响，不引入锁。
- 消费点：新会话的常驻集选择。

### 2.6 pinned / disabled 偏好

`~/.thething/preferences.json` 增加 `skills` 键：

```json
{
  "skills": {
    "pinned": ["gold-price-analysis"],
    "disabled": ["some-unused-skill"]
  }
}
```

- 该文件现由 app 层（packages/app/lib/preferences.ts）读写，core 不依赖 app——core 侧新增独立读取（`modules/skills/preferences.ts`，从 `<layout.configDir>/preferences.json` 读 `.skills` 键，文件不存在或键缺失返回空默认）。两层共享文件、各自读写自己的键，互不感知。
- `disabled`：完全排除——不进常驻、不进目录、find_skills 不返回、skill 工具拒绝加载（覆盖快照命中与 reload 命中两条路径）。**产品决策：用户显式 `/name` 调用 disabled 技能同样被拒**（工具层无法区分用户显式调用与模型自主调用），错误信息说明该技能已禁用及如何在 preferences 中恢复。
- `pinned`：常驻集优先级 3，且条目不截断（见 2.2）。

### 2.7 Bug 修复（随本期落地）

1. `FULL_DESC_SOURCES` 的 `'bundled'` 改为 `'builtin'`（budget-formatter.ts:63）——修正死代码匹配。
2. builder.ts skill-matching section 改为调用新的三段式格式化，`formatSkillsWithinBudget` 不再是该 section 入口。

## 3. 尺寸预算（基于当前 89 个技能实测）

| 项 | 字符 | ≈ tokens |
|---|---|---|
| 现状：全量 desc+whenToUse | 31.1k（+路径 6k） | ~9.3k（超 8k 字符预算 → 退化为纯名字） |
| A 段 40 条 @500 上限（最坏取最长 40 条） | ~17k | ~4.3k |
| A 段 40 条 @250 上限（参考） | ~10.7k | ~2.7k |
| B 段全量名字（89 条共 1430 字符） | ~1.6k | ~0.4k |
| **三段合计（N=40, cap=500）** | **~19k** | **~4.8k** |

比现状"退化纯名字"多花 ~3k tokens，换回的是常驻技能的完整触发词——这正是本设计的目的。N 与单条上限是两个独立旋钮，觉得贵可下调 N（30 条 ≈ 3.7k tokens）。规模到几百个技能时，B 段名字列表线性增长，届时按 §5 折叠为类别摘要。

## 4. 明确不做的

- ❌ 每轮消息自动语义召回（embedding / 小模型重排）——改为模型主动检索
- ❌ SQLite FTS / 向量索引——当前规模纯扫描够用，接口留好
- ❌ 类别折叠——缺 category 元数据，规模需要时再加
- ❌ Agent skills 白名单数组（三态语义）——独立改动，另行实施，本期只在选择器留优先级 1 的空位
- ❌ preferences 的 UI 管理界面——本期手改 JSON 即可

## 5. 实施清单

| # | 项 | 位置 | 状态 |
|---|---|---|---|
| 1 | FULL_DESC_SOURCES 'bundled'→'builtin' | `modules/skills/budget-formatter.ts` | ☑ |
| 2 | 常驻集选择器 + 三段式格式化 + 进程级会话缓存 | `modules/skills/resident-set.ts`（新） | ☑ |
| 3 | preferences skills 键读取 | `modules/skills/preferences.ts`（新） | ☑ |
| 4 | builder.ts skill-matching 接线 | `modules/system-prompt/builder.ts` | ☑ |
| 5 | find_skills 工具 | `modules/tools/find-skills.ts`（新）+ `modules/agent/tools.ts` | ☑ |
| 6 | 使用统计模块 | `modules/skills/usage.ts`（新）+ `modules/tools/skill.ts` 记录 | ☑ |
| 7 | disabled 过滤（skill 工具两条路径 + find_skills + 常驻/目录） | `modules/tools/skill.ts` 等 | ☑ |
| 8 | 测试 | `modules/skills/__tests__/resident-set.test.ts` + `modules/tools/__tests__/find-skills.test.ts` | ☑ |

验收标准：

1. 单测：91+ 技能输入下，A 段 ≤N 条且每条含触发词；builtin/pinned 不截断；disabled 全通路排除；同 conversationId 两次构建结果逐字节一致；usage 记录与衰减排序正确。
2. 集成验证：真实会话中说"编写一个skill"，模型调用 create-skill（原始问题回归）。
3. `pnpm typecheck`、`pnpm test`、`check:exports` 全绿后，实施清单才可勾选。

## 6. 实施记录（2026-08-01）

- 常驻集计算点：`createAgent()`（composition/app/create.ts）每请求经 `getSessionSkillResidentSet(conversationId, ...)` 取会话稳定结果，与 wiki/project context 并行加载 preferences + usage。结果经 `skillListing` 选项传入 `buildAgentInstructions` → `buildSystemPrompt`；builder 的 skill-matching section 优先用 `skillListing`，未提供时回退旧的 `formatSkillsWithinBudget`（兼容直接调用 buildSystemPrompt 的场景）。
- 使用统计记录点：skill 工具成功加载后 `recordSkillUsage(usageDataDir, name)`（`usageDataDir = layout.dataDir`，内部容错）。
- disabled 拒绝：skill 工具在查找之前先查 disabled 列表，天然覆盖快照命中与 reload 命中两条路径；find_skills 结果过滤；常驻/目录段由选择器排除。
- 实测（93 技能，含 builtin + 项目 .claude/skills）：常驻 40 + 目录 53，A+B 段 14071 字符 ≈ 3.5k tokens；create-skill 常驻且描述完整；清单无绝对路径泄漏。
- 验证：`pnpm typecheck` ✅；core 测试 816/816 ✅（新增 33 个）。`check:exports`（54 > 50）与 `check:layers`（1 处 L2→L3）在本改动前的干净工作区上同样失败，为既有问题，与本期无关（本期未改 core index.ts 顶层导出）。
- 遗留：验收标准 2（真实会话回归"编写一个skill"→ create-skill 被调用）待应用侧手动验证。
