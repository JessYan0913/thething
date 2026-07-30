# TheThing 消息分支系统完整设计方案

**文档状态：** 方案设计稿  
**日期：** 2026-07-28  
**适用范围：** TheThing Web / Desktop 对话页面、消息存储、Agent 运行与上下文摘要

---

## 1. 执行摘要

TheThing 当前已经实现了一个质量较高的消息分支基础：使用不可变消息树保存全部历史，以会话 head 指针表示当前路径；重新生成、编辑重发和手动分叉都不会破坏旧历史，迟到的 Agent 写入也不会覆盖当前路径。

现有架构不应推翻。下一阶段应在消息树之上增加四个清晰层次：

1. **Message graph（消息图）**：保存不可变消息内容与父子关系；
2. **Branch（分支）**：保存用户认定的方案、名称、分叉点与当前位置；
3. **Run（运行）**：保存一次 Agent 执行的锚点、状态、结果、成本与提交情况；
4. **Projection（投影视图）**：把复杂的消息图整理成前端可直接展示的分支树。

产品层面，建议在对话页右上角增加“分支”入口，点击后展开约 280–320px 的右侧分支树面板。第一版可直接基于当前消息树实现只读可视化；后续再逐步支持分支命名、准确恢复、归档、比较和过时结果恢复。

核心目标不是“产生更多分支”，而是让分支多起来以后，用户仍然清楚地知道：**我在哪里、有哪些路线、每条路线讨论了什么、怎么准确回去、哪些 AI 结果真正生效。**

---

## 2. 当前实现概览

### 2.1 当前数据模型

当前采用 SQLite 不可变消息树：

- `messages.parent_id` 指向上一条消息；
- `conversations.head_message_id` 是唯一活动游标；
- 当前对话历史等于从 head 沿 parent 链回溯到根的路径；
- 消息行原则上只插入、不覆盖。

主要实现位置：

- `packages/core/src/services/datastore/sqlite/schema.ts`
- `packages/core/src/services/datastore/sqlite/message-store.ts`
- `packages/app/app/api/chat/route.ts`
- `packages/app/components/Chat.tsx`

### 2.2 当前操作语义

`commitUserMessage` 根据消息 ID 和内容区分三种行为：

- 新 ID：普通发送，作为当前 head 的孩子插入；
- 已知 ID、内容不变：重新生成，把 head 移回原用户消息；
- 已知 ID、内容变化：编辑重发，在原 parent 下插入新兄弟节点。

手动“从这里拉出新分支”则把 head 停在历史消息上，下一条用户消息自然成为新的孩子。

### 2.3 当前并发保护

assistant 结果写入时锚定本轮用户消息。只有当前 head 仍等于锚点时，结果才推进 head；否则结果保留在树中，但不会成为活动路径。

该机制让迟到运行天然成为非活动分叉，避免旧结果覆盖当前历史，是现有设计中最有价值的部分。

### 2.4 当前前端能力

对话页已经支持：

- 消息下方 `< 1/2 >` 兄弟版本切换；
- assistant 消息上的“从这里拉出新分支”；
- 停在历史节点后的“直接发送将拉出新分支”提示；
- “回到后面的消息”入口。

### 2.5 当前测试情况

消息树核心单元测试覆盖：

- 普通发送；
- 重新生成；
- 编辑重发；
- 迟到写入；
- 内容去重；
- 摘要失效；
- 兄弟版本查询；
- head 切换和手动 fork。

本轮评估实际运行结果：**23 项测试全部通过。**

---

## 3. 当前设计的优点

### 3.1 数据模型简洁

所有行为最终都归结为“插入节点”和“移动 head”，不需要同时维护 archived、deleted、version 等大量状态字段。

### 3.2 历史不丢失

重新生成和编辑不会覆盖旧消息。即使新生成失败，旧回答仍在消息树中，可以恢复。

### 3.3 并发冲突容易控制

旧运行完成得再晚，也无法越过 head CAS 成为当前路径，降低了流式生成、停止、编辑和重新生成之间的竞态风险。

### 3.4 与产品操作天然匹配

重新生成、编辑消息和从中间继续，本质上都是在同一棵树上选择另一条路径，模型与用户行为一致。

---

## 4. 为什么还需要升级

当前系统更准确地说是“支持分叉的消息树”，还不是完整的“分支管理系统”。

它知道：

- 有哪些消息；
- 哪些消息互为兄弟；
- 当前 head 在哪里。

但它不知道：

- 用户把哪一条长期路线认作一个方案；
- 这条方案叫什么名字；
- 用户上次在该方案停在哪里；
- 某条路线是正式分支、普通重新生成版本，还是过时运行结果；
- 一次 Agent 运行是否真正提交成功；
- 两个分支应该如何比较、归档和恢复。

通俗地说：

> 当前系统像地图上保存了所有走过的路，并用一个红点标记当前位置；升级后的系统还会给每条路线命名、记录上次走到哪里，并记录每辆车是否真正到达目的地。

---

## 5. 用户能感受到的具体收益

### 5.1 不会迷路

用户始终能看到：

- 当前位于哪个方案；
- 它从哪条消息分出；
- 已经继续了多少轮；
- 上次停在哪里；
- 还有哪些可切换路线。

### 5.2 可以放心尝试

用户可以让 AI：

- 换一种实现；
- 使用另一个模型；
- 修改中间需求；
- 从历史节点重新规划。

原路线仍然存在，并且可以准确回去。

### 5.3 长任务更容易管理

当一个会话讨论几十轮时，不再依赖 `< 1/3 >` 和用户记忆猜测哪个版本后来发展成了什么方案。

### 5.4 快速操作更稳定

连续编辑、停止、重新生成和切换时，旧运行只能保留自己的结果，不能修改当前分支的摘要、标题和上下文状态。

### 5.5 可以比较方案

系统明确知道两个分支的共同祖先，因此可以比较：

- 各自新增的消息；
- 文件修改差异；
- 成本和 token；
- 最终任务状态；
- 优缺点摘要。

### 5.6 过时结果仍可利用

被后续编辑顶掉的 AI 结果不必彻底隐藏，可提供“查看”和“恢复为新分支”。

---

## 6. 目标架构

### 6.1 Message graph：不可变事实层

继续保留现有消息树：

```text
Message
- id
- conversation_id
- parent_id
- role
- content
- created_at
```

职责：

- 保存消息内容；
- 保存消息因果顺序；
- 保证旧历史不被覆盖；
- 为所有分支共享公共前缀。

建议补充：

- parent 必须存在；
- parent 必须属于同一 conversation；
- 应用层防止形成环；
- 版本排序不再长期依赖 SQLite `rowid`，改用毫秒时间或单调序号。

### 6.2 Branch：稳定分支身份

建议新增轻量 `branches` 表：

```sql
CREATE TABLE branches (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL,
  parent_branch_id TEXT,
  fork_message_id TEXT,
  tip_message_id TEXT NOT NULL,
  name TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
```

字段语义：

- `fork_message_id`：从哪里分出；
- `tip_message_id`：该分支当前终点；
- `parent_branch_id`：来源分支；
- `name`：用户或系统生成的分支名；
- `created_by`：manual、regenerate、edit、stale_run、import；
- `status`：active、archived、failed、ephemeral。

`conversations` 增加：

```text
active_branch_id
revision
```

Branch 不应强制拥有所有消息。共享前缀消息天然属于多条分支，Branch 只需保存 fork point 和 tip，路径可通过 parent 链计算。

### 6.3 Run：一次 Agent 执行

建议引入 `conversation_runs`：

```sql
CREATE TABLE conversation_runs (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  anchor_message_id TEXT NOT NULL,
  expected_tip_id TEXT,
  result_tip_id TEXT,
  status TEXT NOT NULL,
  model TEXT,
  agent_type TEXT,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  superseded_by TEXT,
  error TEXT
);
```

状态：

- `running`：运行中；
- `committed`：结果成功提交到目标分支；
- `superseded`：结果完成，但目标分支已经前进；
- `aborted`：主动取消；
- `failed`：执行失败。

提交规则：

1. 开始运行时记录 branch、anchor 和 expected tip；
2. 生成结果作为不可变消息写入；
3. 提交时对 Branch tip 执行 CAS；
4. CAS 成功，Run 变为 committed；
5. CAS 失败，Run 变为 superseded；
6. 只有 committed Run 能更新当前分支的摘要、上下文水位、checkpoint、标题等派生状态。

### 6.4 Selection：准确恢复用户选择

当前 `switchHead` 会沿每层“最新孩子”下行到叶子，可能不是用户上次浏览的路线。

建议增加：

```sql
CREATE TABLE branch_selections (
  branch_id TEXT NOT NULL,
  parent_message_id TEXT NOT NULL,
  selected_child_id TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (branch_id, parent_message_id)
);
```

用户切换某个兄弟版本时，记录“在该分支的父消息下，选择了哪个 child”。恢复时优先沿该选择下行，不再依赖 latest rowid 猜测。

### 6.5 Projection：面向 UI 的读取模型

后端应把复杂树整理成前端可直接消费的数据，而不是让 UI 自己解释数据库结构。

建议返回：

```ts
interface ConversationProjection {
  revision: number;
  activeBranch: {
    id: string;
    name?: string;
    tipId: string;
    forkPointId?: string;
  };
  messages: ProjectedMessage[];
  versionGroups: Array<{
    parentId: string | null;
    activeMessageId: string;
    versions: Array<{
      messageId: string;
      ordinal: number;
      createdAt: string;
      runStatus?: string;
    }>;
  }>;
  branchSummaries: Array<{
    id: string;
    name?: string;
    forkPointId: string;
    tipId: string;
    preview: string;
    turnCount: number;
    status: string;
  }>;
}
```

---

## 7. 显式操作协议

当前通过“ID 是否存在 + parts 是否变化”推断 append、regenerate 和 edit，短期有效，但协议隐式依赖前端 SDK 行为。

建议定义统一领域命令：

```ts
type ConversationCommand =
  | { type: 'append'; branchId: string; message: UIMessage; expectedTipId: string | null }
  | { type: 'regenerate'; branchId: string; assistantMessageId: string }
  | { type: 'edit'; branchId: string; messageId: string; replacement: UIMessage }
  | { type: 'fork'; sourceBranchId: string; fromMessageId: string; name?: string }
  | { type: 'switch'; branchId: string };
```

收益：

- 不再依赖 AI SDK 是否保留消息 ID；
- API、Web、Desktop、CLI 使用相同语义；
- 服务端能精确验证操作是否合法；
- 审计日志可读；
- 未来增加 rename、archive、compare、restore 更自然。

现有推断逻辑可保留为兼容适配层。

---

## 8. 版本与正式分支的区别

### 8.1 普通版本

重新生成若只是产生几个候选回答，继续用 `< 1/3 >` 紧凑切换，不应全部塞入侧栏。

### 8.2 正式分支

某个版本满足以下任一条件时，可升级为正式分支：

- 用户明确点击“从这里分支”；
- 用户沿该版本继续发送消息；
- 用户给它命名或固定；
- 路线已经继续两轮以上。

建议状态演进：

```text
隐式版本 → 候选分支 → 正式分支
```

这样既避免分支面板被普通 regenerate 塞满，也能让真正的替代方案得到管理。

---

## 9. 前端分支树方案

### 9.1 入口位置

在对话页标题栏右上角增加“分支”按钮：

```text
设计登录系统                  [分支图标 分支 3]
```

有正式分支时可以显示：

```text
设计登录系统             [手机号方案 · 3 个分支]
```

显示规则：

- 无分叉：仅显示弱化图标；
- 出现多个版本：显示数量；
- 有正式分支：显示当前分支名；
- 有可恢复过时结果：显示提示点。

### 9.2 展开方式

点击入口后，从右侧展开约 280–320px 的面板，主聊天区适当收窄；再次点击收起。

窄窗口或移动端使用覆盖式抽屉，约占 85% 宽度。

### 9.3 默认展示内容

默认显示分支级视图，而不是完整消息级图：

```text
分支树

● 最初回答
│
├─ 账号密码方案
│  5 轮 · 停在密码重置
│
├─ 手机号方案               当前
│  8 轮 · 停在短信防刷
│
└─ 未采用的生成
   已过时运行 · 可恢复
```

默认只画：

- 会话起点；
- 分叉点；
- 正式分支；
- 当前分支；
- 可恢复结果；
- 每个分支终点。

工具调用、系统消息和普通中间消息不要全部显示为节点。

### 9.4 消息级展开

点击分支展开后，再显示关键消息：

```text
手机号方案
├─ 使用验证码登录
├─ 增加 IP 限流
├─ 增加设备指纹
└─ 验证码过期策略
```

### 9.5 当前分支表达

同时使用三种方式：

- 当前节点使用强调色；
- 显示“当前”文字；
- 从根到当前节点的路径连线高亮。

不要只依赖颜色。

### 9.6 节点信息

节点默认展示：

- 分支名称；
- 对话轮数；
- 当前终点摘要；
- 当前/归档/失败/可恢复等状态。

悬停补充：

- 分叉消息预览；
- 最后更新时间；
- 使用模型；
- 成本；
- Run 状态。

### 9.7 点击与预览

正式分支节点不建议单击后立即无提示切换整个历史。

推荐流程：

1. 单击节点进入预览；
2. 主聊天区显示该分支历史；
3. 顶部显示“正在预览账号密码方案”；
4. 提供“切换到此分支”和“返回当前分支”。

同一位置的普通 `< 1/3 >` 版本仍可直接切换。

### 9.8 节点操作

MVP：

- 切换到此分支；
- 从这里继续；
- 重命名；
- 归档。

后续：

- 与当前分支比较；
- 复制为新分支；
- 恢复过时结果；
- 删除。

### 9.9 大树处理

当分支和节点较多时支持：

- 折叠普通版本；
- 只看正式分支；
- 适应视图；
- 缩放和平移；
- 搜索分支名和消息预览；
- 自动定位当前节点；
- 虚拟化渲染。

第一版不必实现完整二维 Git 图，树形列表已经能提供大部分价值。

---

## 10. API 设计

### 10.1 MVP 树读取接口

第一版可直接基于现有消息树：

```http
GET /api/chat/:conversationId/tree
```

```ts
interface ConversationTree {
  revision: number;
  activeTipId: string;
  nodes: Array<{
    id: string;
    parentId: string | null;
    role: 'user' | 'assistant';
    preview: string;
    createdAt: string;
    childCount: number;
    isActivePath: boolean;
    runStatus?: 'committed' | 'superseded' | 'failed';
  }>;
}
```

### 10.2 正式 Branch API

后续建议：

```http
GET    /api/chat/:conversationId/projection
POST   /api/chat/:conversationId/branches
PATCH  /api/chat/:conversationId/branches/:branchId
POST   /api/chat/:conversationId/branches/:branchId/switch
POST   /api/chat/:conversationId/branches/:branchId/archive
POST   /api/chat/:conversationId/runs/:runId/restore
GET    /api/chat/:conversationId/compare?left=...&right=...
```

### 10.3 revision 同步

Conversation 增加单调递增 revision。所有影响活动视图的事务提交后 revision 加一。

客户端规则：

- 接口和流完成事件均携带 revision；
- 旧 revision 响应不得覆盖新状态；
- revision 不连续时重新获取 projection；
- 服务端持久化完成后发送明确事件。

这样可以替代当前前端固定等待 800ms 再刷新分支信息的时序猜测。

---

## 11. 上下文摘要与分支

当前摘要锚点离开活动路径时会删除摘要，可避免“幽灵历史”混入上下文，但分支切换后复用能力有限。

长期建议摘要绑定：

```text
conversation_id + branch_id + anchor_message_id
```

收益：

- 每条长期分支拥有自己的压缩历史；
- 切回分支时可恢复其摘要；
- 不必因另一个分支切换而���弃全部摘要；
- 分支比较时可使用分支级摘要。

---

## 12. 分支比较、搜索与治理

### 12.1 分支比较

比较结果应包括：

- 共同祖先；
- 左右分支新增消息；
- 文件改动差异；
- 模型和 Agent；
- 成本与 token；
- Todo 完成情况；
- 风险和结论摘要。

### 12.2 分支搜索

支持按以下内容搜索：

- 分支名称；
- 消息正文；
- 自动摘要；
- 修改过的文件；
- 模型或 Agent；
- 日期和状态。

### 12.3 归档与垃圾回收

不可变树会持续增长。建议通过可达性分析确定必须保留节点：

```text
正式 branch tips
+ 当前 branch tip
+ 用户固定的 run results
+ summary anchors
→ 向根遍历得到必须保留节点
```

其余节点先标记为可回收，不立即物理删除。

建议区分：

- 正式分支；
- 临时 regenerate 版本；
- superseded run；
- 失败且无内容的 run；
- 用户归档分支。

---

## 13. 当前系统应优先修复的问题

### P0/P1：迟到运行的派生副作用

`appendMessages` 返回 `headMoved=false` 后，旧运行仍可能执行 finalize。消息路径虽然不被污染，但标题、上下文水位、checkpoint、摘要和其他派生状态可能受旧运行影响。

建议：

```ts
if (!headMoved) {
  // 可记录该 run 自身成本与结果，但不得更新当前会话派生状态
  return;
}
```

或者让 `finalizeAgentRun` 明确接收 `runStatus`，只允许 committed Run 更新当前会话。

### P1：去掉 latest-child 恢复歧义

`switchHead` 不应长期沿每层最新孩子自动下降。短期可持久化 selected child；长期直接使用 Branch tip。

### P1：去掉固定 800ms 刷新

流完成后通过持久化完成事件和 revision 更新 UI，不再使用固定延时。

### P1：补树完整性约束

插入消息时验证 parent 存在且属于同一 conversation，并防止断链和跨会话 parent。

### P2：查询优化

当前活动路径读取会先加载全会话消息，分支信息又逐层查询 siblings。后续可使用递归 CTE 或批量查询，避免长会话下 O(全树) 加 N+1 查询。

### P2：稳定排序

兄弟版本顺序不应长期依赖 SQLite rowid。增加 `sequence` 或毫秒级创建时间。

---

## 14. 分阶段实施计划

### Phase 1：正确性和同步

目标：不改变主要产品形态，先解决底层风险。

任务：

1. `headMoved=false` 时隔离 finalize 副作用；
2. 引入 conversation revision；
3. 通过持久化完成事件刷新前端；
4. 去掉固定 800ms；
5. parent 同会话完整性校验；
6. 增加 API 和竞态集成测试。

验收：

- 旧 Run 不更新当前会话派生状态；
- 快速连续编辑、停止、重新生成后 UI 与数据库一致；
- 无需刷新页面即可看到新分支版本；
- 旧响应不能覆盖新 revision。

### Phase 2：右侧分支树 MVP

目标：让用户看见现有消息树。

任务：

1. 右上角增加分支入口；
2. 新增 `/tree` 读取接口；
3. 右侧 280–320px 树形面板；
4. 当前路径高亮；
5. 普通版本折叠；
6. 点击节点预览；
7. 切换到节点或从节点继续；
8. 窄窗口抽屉适配。

验收：

- 用户能看到所有分叉点和当前路径；
- 长消息只展示摘要，不挤爆布局；
- 普通 regenerate 不会污染顶层分支列表；
- 切换操作有加载、失败和恢复状态。

### Phase 3：稳定导航

目标：切回分支时准确恢复。

任务：

1. 持久化 selected child；
2. 去掉 latest-rowid 自动下降；
3. projection API；
4. 前端不再自行解释裸 siblings；
5. 分支预览和确认切换。

验收：

- 重启后仍回到用户上次选择的位置；
- 复杂树切换具有确定性；
- Web 与 Desktop 展示一致。

### Phase 4：Branch 一等对象

目标：让长期方案可命名和管理。

任务：

1. 新增 branches 表；
2. conversation 增加 active_branch_id；
3. 手动 fork 创建正式 Branch；
4. regenerate 保持轻量版本；
5. 分支自动命名、重命名和归档；
6. 分支摘要和轮数统计。

验收：

- 用户能清楚识别多个长期方案；
- 分支能命名、归档、准确切换；
- 共享前缀不会复制消息。

### Phase 5：Run 事务化

目标：把 Agent 执行与分支提交彻底分离。

任务：

1. 新增 conversation_runs；
2. committed/superseded/aborted/failed 状态；
3. 分支 tip CAS；
4. Run 级成本与模型信息；
5. superseded 结果恢复为新分支；
6. 所有派生状态只接受 committed Run。

验收：

- 快速操作下没有旧运行副作用；
- 每次生成均可解释其最终状态；
- 过时结果可查看、可恢复、不会自动生效。

### Phase 6：高级能力

任务：

- 分支比较；
- 分支搜索；
- 分支级摘要；
- 导出；
- 垃圾回收；
- 多窗口与多端同步；
- 大树缩放、虚拟化和过滤。

---

## 15. 测试策略

### 15.1 Store 单元测试

增加：

- parent 跨 conversation 被拒绝；
- Branch tip CAS 成功/失败；
- selected child 恢复；
- revision 单调递增；
- superseded Run 不更新派生状态；
- Branch 共享公共前缀；
- 归档不删除消息。

### 15.2 API 集成测试

覆盖：

- 生成中切分支；
- 生成中编辑历史消息；
- 连续两次 regenerate；
- 旧请求晚于新请求返回；
- tree/projection revision 一致；
- 不存在或跨会话 messageId；
- 分支预览不改变 active branch；
- 确认切换后才改变活动状态。

### 15.3 UI 测试

覆盖：

- 无分支、单版本、多版本、多正式分支；
- 当前路径高亮；
- 折叠和展开；
- 节点预览；
- 切换失败恢复；
- 流式生成时禁用冲突操作；
- 移动端抽屉；
- 键盘操作和无障碍标签。

### 15.4 性能测试

构造：

- 1,000 条线性消息；
- 10,000 个树节点；
- 单分叉点 100 个版本；
- 100 条正式分支；
- 大量工具消息与大内容。

观察：

- projection 查询耗时；
- 面板首次渲染；
- 切换分支耗时；
- 内存占用；
- 数据库索引命中。

---

## 16. 风险与取舍

### 16.1 不要过早把所有版本升级为 Branch

否则侧栏会迅速膨胀。普通 regenerate 应折叠为版本组。

### 16.2 不要默认展示完整消息图

工具调用、系统消息和长会话会让图失去可读性。默认展示分支级摘要，按需展开消息级结构。

### 16.3 不要让前端直接解释数据库树

否则 Web、Desktop 和 CLI 会产生不同语义。后端应提供统一 projection。

### 16.4 不要一次性重写

现有不可变消息树和 CAS 机制是正确资产。应通过渐进迁移增加 revision、tree API、Branch 和 Run，而不是替换核心存储。

### 16.5 删除功能应最后实现

分支删除涉及共享前缀、摘要锚点、Run 结果和可达性分析。第一阶段优先提供归档，不直接物理删除。

---

## 17. 推荐的 MVP 范围

如果只做一个最有价值且风险可控的版本，建议包含：

1. 保留现有消息树；
2. 修复 `headMoved=false` 后的 finalize 副作用；
3. 增加 conversation revision；
4. 去掉前端 800ms 固定等待；
5. 新增完整树读取接口；
6. 对话页右上角增加“分支”入口；
7. 展开约 300px 的右侧树形面板；
8. 当前路径高亮；
9. 普通重新生成版本折叠；
10. 点击节点先预览，再确认切换或从此处继续；
11. 补 Store、API 和 UI 竞态测试。

这个 MVP 无需立即引入完整 Branch 表，就能让用户感受到“全局可见、不会迷路”的价值，同时为下一阶段正式 Branch 打基础。

---

## 18. 最终结论

TheThing 当前分支机制的核心骨架是优秀的，不需要重做。下一阶段的正确方向不是继续在 `getBranchInfo()` 上堆更多兄弟 ID，而是逐步建立清晰边界：

| 层 | 核心职责 |
| --- | --- |
| Message graph | 保存不可变内容和因果关系 |
| Branch | 保存用户认可的长期路线和导航意图 |
| Run | 保存一次 Agent 执行及其提交状态 |
| Projection | 为 UI 提供稳定、可解释的读取模型 |

最终原则：

> **消息可以存在但不活跃；运行可以完成但不提交；分支可以共享历史但拥有独立身份；UI 只消费领域投影，不自行猜测数据库树。**

完成上述演进后，TheThing 的消息分支不再只是“支持重新生成和从中间继续”，而会成为适合长任务、多方案探索和 Agent 工作流的对话版本控制系统。
