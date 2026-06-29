# thething vs pi：Agent 核心机制深度对比分析

> 分析时间：2026-06-29
> 对比目标：https://github.com/earendil-works/pi

---

## 背景

pi 是一个开源的 Agent 框架项目，定位为"自我扩展的编码助手"（self extensible coding agent），提供交互式 CLI、多 LLM 提供商统一 API 和支持库。它与 thething 同为 TypeScript 编写的 monorepo，在 Agent 系统设计上有不同的取舍和架构选择。

本报告对两者的 Agent 核心机制进行全面对比，重点关注值得 thething 学习的点。

---

## 一、项目架构概览

| 维度 | pi | thething |
|------|----|----------|
| 包结构 | `pi-ai`(LLM API)、`pi-agent-core`(运行时)、`pi-coding-agent`(CLI)、`pi-tui`(终端UI) | `core`(引擎)、`app`(Web)、`cli`、`desktop`、`resumable-stream` |
| 核心抽象 | `AgentTool`（Tool Definition + Instance 分离） | `AgentDefinition` + `Tool`(Vercel AI SDK) |
| 配置目录 | `.pi/`（extensions/、prompts/、skills/、git/、npm/） | `.agents/`（多源加载：project > user > builtin） |
| 设计哲学 | 编码专用，轻量化，CLI 深度绑定 | 通用型个人助手，模块化，平台化 |
| 许可证 | MIT | 未标明 |
| 依赖管理 | npm lockfile + shrinkwrap 供应链硬化 | pnpm workspace |

---

## 二、系统提示词机制

### pi：函数式构建，简单直接

pi 的 `buildSystemPrompt()` 是一个单一函数，接收 `BuildSystemPromptOptions`：

```
身份 + 工具列表 + 指南 + 文档路径 + 项目上下文 + Skills + 日期/CWD
```

核心代码模式——纯字符串拼接：

```typescript
export function buildSystemPrompt(options: BuildSystemPromptOptions): string {
  // 工具信息来自 toolSnippets（工具注册时传入的一句话描述）
  const visibleTools = tools.filter(name => !!toolSnippets?.[name]);
  const toolsList = visibleTools.map(name => `- ${name}: ${toolSnippets![name]}`).join('\n');

  // Guidelines 根据可用工具动态生成
  if (hasBash && !hasGrep && !hasFind && !hasLs) {
    addGuideline("Use bash for file operations like ls, rg, find");
  }
  addGuideline("Be concise in your responses");
  addGuideline("Show file paths clearly when working with files");

  // Skills 用 XML 格式注入
  prompt += formatSkillsForPrompt(skills);  // → <available_skills>...
}
```

**关键特点：**
- 全程字符串拼接，无模块化
- 有 `customPrompt` 短路分支
- Tools 用一句话描述注入（`toolSnippets`）
- Guidelines 根据工具集动态生成
- Skills 以 XML 格式列出，LLM 再用 read 工具按需加载

### thething：分层模块化 Section 系统

```typescript
// builder.ts 按优先级排序的 section 系统
Priority 1:  Identity
Priority 2:  Capabilities
Priority 3:  Rules
Priority 4:  Language Rules
Priority 5:  Response Style
Priority 10: User Preferences
Priority 20: Tools
----- DYNAMIC_BOUNDARY -----  // 缓存分割线
Priority 51: System Context
Priority 45: Wiki
Priority 10: Project Context
Priority 10: Permissions
Priority 30: Skill Matching
Priority 99: First Message Guidance
Priority 100: Session Guidance
```

每个 section 独立模块、独立可测，标注 `cacheStrategy: static|session|dynamic`。

### 对比

| 方面 | pi | thething |
|------|----|----------|
| 组织方式 | 单一函数字符串拼接 | 多 section 按优先级组装 |
| 缓存策略 | 无 | `DYNAMIC_BOUNDARY` + section 级缓存策略 |
| 工具描述 | 注册时附带 `toolSnippets` 自动注入 | 目前通过系统提示词手动编写 |
| Skills 注入 | XML 格式注入，LLM 按需 read | system-reminder 消息 |
| Guidelines | 根据工具自动推导 | 固定规则 |

### 可学习点

pi 的 `toolSnippets` 机制值得借鉴——工具注册时自带一句话说明，自动生成系统提示词中的工具列表，简化维护。

---

## 三、工具定义与注册机制

### pi 的模型：双层抽象（Definition + Instance 分离）

```
createReadToolDefinition(cwd, options)  → ToolDefinition (schema + 描述)
createReadTool(cwd, options)            → AgentTool       (可执行实例)
```

预置组合函数：
```typescript
createCodingTools()    // read + write + edit + bash
createReadOnlyTools()  // read + grep + find + ls
createAllTools()       // 全部 7 种
```

**7 种原子工具：** read, bash, edit, write, grep, find, ls

其中 edit 同时支持两种模式：完整文件重写 和 diff-based 编辑。

### thething 的模型：工厂函数 + 统一装载

```typescript
loadAllTool({
  appContext, sessionState, agentDefinition, options, ...
}) → Record<string, Tool>
```

**更丰富的工具生态：** core(6) + todo(6) + cron + wiki(2) + agent(2) + MCP(N) + connector(N)

### 对比

| 方面 | pi | thething |
|------|----|----------|
| 核心工具数 | 7 个 | 约 20+（不含 MCP） |
| Definition/Instance | 显式分离，不耦合 | 合一，Vercel AI SDK tool() 直接生成实例 |
| 按角色组合 | 预置 `createXxxTools()` | `resolveToolsForAgent()` 动态过滤 |
| 参数校验 | ToolDefinition Input 泛型 | Zod schema |
| 输出控制 | 无统一机制 | `toModelOutput()` |
| Bash 扩展 | 钩子系统（BashSpawnHook） | 无类似钩子 |

### 可学习点

1. **Definition/Instance 分离**——Definition 层可单独用于生成文档、权限检查、系统提示词描述
2. **预置组合函数**——按 agent 类型（代码/只读/全量）快速组工具集
3. **更少的原子工具**——简化 LLM 的决策空间

---

## 四、Skill 机制

### pi：文件型，XML 注入 + 按需 read

```typescript
interface Skill {
  name: string;
  description: string;
  filePath: string;
  baseDir: string;
  sourceInfo: SourceInfo;
  disableModelInvocation: boolean;
}
```

**发现规则：**
- 目录内有 `SKILL.md` → 加载，停止递归
- 无 `SKILL.md` → 加载根目录 `.md` 文件 + 递归子目录
- 支持 `.gitignore` / `.ignore` / `.fdignore`
- 名称碰撞保留先到，后者产生 collision 诊断

**调用方式：**
- LLM 看到 XML skill 列表 → 用 `read` 工具按需加载内容
- `/skill:name` 命令显式调用（绕过模型）
- `disableModelInvocation: true` → 只可显式调用

### thething：元数据丰富，工具直接调用

```typescript
interface SkillMetadata {
  name; description; whenToUse?;
  allowedTools: string[];     // 工具白名单
  model?: string;             // 模型覆盖
  effort: 'low'|'medium'|'high';
  context: 'inline'|'fork';  // 执行上下文
  paths: string[];            // 输出目录
}

interface Skill extends SkillMetadata {
  body: string;  // 完整指令
}
```

**调用方式：** `skill({name, args})` 直接返回完整 body，支持 `$ARGUMENTS` 占位符和 `fork` 模式。

### 对比与可学习点

| pi 的亮点 | 说明 |
|-----------|------|
| `disableModelInvocation` | 某些 skill 只允许用户显式调用，可防止模型在不需要时加载 |
| 忽略文件支持 | 扫描时自动忽略 `.gitignore` 中的路径 |
| 更严格的命名校验 | 小写字母数字短横线、64 字限制、不可前后带短横线 |
| XML 简洁注入 | `<available_skills>` 比 system-reminder 更直观 |
| 按需 read 加载 | 避免一次性把大 skill 内容塞进上下文 |

---

## 五、MCP / 扩展机制

### pi：自定义扩展系统（无 MCP）

pi **没有 MCP 支持**。它通过自定义 **Extensions** 系统实现插件化：

```
extensions/
├── types.ts     // ToolDefinition 接口
├── loader.ts    // 扩展加载
├── runner.ts    // 扩展运行
├── wrapper.ts   // 包装器
├── index.ts
```

扩展可贡献：tools、skills、prompts、themes 等资源。

### thething：完整 MCP 支持

```
mcp/
├── types.ts             // transport 配置（stdio/SSE/HTTP）
├── registry.ts          // McpRegistry 连接管理
├── loader.ts            // 配置加载
├── tool-wrapper.ts      // 输出封装
├── mcp-config-store.ts  // CRUD
```

支持工具过滤（include/exclude）、elicitation 处理、`mcp_` 前缀命名。

### 对比

thething 的 MCP 支持远超 pi。但 pi 的扩展系统在**易用性**上有参考价值——写一个 TypeScript 文件即可注册工具/技能/提示词，无需处理 MCP 协议的传输协商。可以考虑在 thething 中加入对**本地轻量级扩展**的友好支持。

---

## 六、Agent 生命周期与运行时

### pi：AgentHarness + Session 树

```
agentLoop() → runLoop()
  → streamAssistantResponse()    [LLM 调用]
  → executeToolCalls()           [同步或并行]
    → prepareToolCall()          [验证 + beforeToolCall 钩子]
    → executePreparedToolCall()  [执行]
    → finalizeExecutedToolCall() [afterToolCall 钩子]
```

**关键特点：**
- Session 树形组织，支持分支/子会话
- `activeToolNames` 追踪当前可用工具
- `beforeToolCall` / `afterToolCall` 钩子系统
- `shouldTerminateToolBatch()` 批量终止逻辑
- 事件总线（event-bus.ts）驱动 UI 更新
- compaction：branch-summarization + estimateTokens

### thething：AgentPipeline + SessionState

```
createAgent() → ToolLoopAgent(Vercel)
  → prepareStep (每个 step):
    → 中止检查 → 轮次/Tokens 更新
    → 拒绝阈值 → 模型切换 → 上下文压缩 → 工具结果预算
```

**关键特点：**
- SessionState 丰富：turnCount, tokenBudget, costTracker, denialTracker, modelSwapper
- 自动模型降级/升级（成本+任务复杂度）
- Middleware 链：costTracking → guardrails → telemetry
- 子代理：`agent`（单代理）+ `parallel_agent`（2-8 并行）
- 递归防护（最大深度 3）
- Agent 路由（关键字自动路由）
- SQLite 持久化

### 可学习点

| pi 的亮点 | 说明 |
|-----------|------|
| Session 树型结构 | 支持分支/回溯/恢复，长时间对话更灵活 |
| before/afterToolCall 钩子 | 比在 execute 里做封装更灵活，支持修改调用参数和结果 |
| 批量终止逻辑 | 多工具并行时可以提前切断 |
| 事件总线 | 解耦运行时和 UI，方便扩展 |

---

## 七、Prompt Template 系统（pi 独有）

这是 pi **最值得 thething 引入的功能**。

用户可在 `.pi/prompts/` 下放 `.md` 文件，通过 `/template-name` 快捷调用：

```
.prompts/
├── cl.md   →  /cl <issue>      代码审查
├── is.md   →  /is <issue>      Issue 分析
├── pr.md   →  /pr <URL>        PR 审查
├── sa.md   →  /sa <code>       安全审计
├── wr.md   →  /wr <topic>      写作任务
```

支持参数替换语法：`$1`, `$2`, `$@`, `$ARGUMENTS`, `${N:-default}`, `${@:N}`, `${@:N:L}`

**与 Skill 的区别：**
- **Skill** → 给 LLM 用的专业知识（LLM 自主决定是否调用）
- **Prompt Template** → 给人用的快捷指令（用户主动触发）

### 建议引入方式

thething 可以在 `cli` 层或 `app` 层加入平行的模板系统，与现有的 skill 系统同源但职责分离：

```
.agents/templates/        ← 用户自定义模板目录
└── review.md             ← /review <args> 调用
```

---

## 八、汇总：值得学习的点分级

### 高价值（建议优先评估）

| # | 可学习点 | 说明 | 预期影响 |
|---|---------|------|---------|
| 1 | **Prompt Template 系统** | 用户侧快捷指令，参数替换，`/cmd` 式调用 | 用户体验大幅提升 |
| 2 | **toolSnippets 自动注入** | 工具注册时附带一句话描述，自动生成系统提示词工具列表 | 简化 system prompt 维护 |
| 3 | **Session 分支/树结构** | 会话支持分支，可回溯到之前上下文恢复 | 长期对话管理更灵活 |

### 中价值（可以借鉴）

| # | 可学习点 | 说明 |
|---|---------|------|
| 4 | Tool Definition/Instance 分离 | 用于文档生成、权限检查、描述注入 |
| 5 | beforeToolCall / afterToolCall 钩子 | 在工具执行前后插入自定义逻辑 |
| 6 | skill 的 disableModelInvocation | 某些 skill 只允许用户显式调用 |
| 7 | 预置工具组合（createCodingTools 等） | 按 agent 类型快速组合可用工具集 |
| 8 | 忽略文件支持（.gitignore 等） | 加载技能时自动排除无关文件 |

### 设计理念参考

| # | 可学习点 | 说明 |
|---|---------|------|
| 9 | 更少的核心工具（7 个原子工具） | 简化 LLM 决策空间 |
| 10 | 自动 guideline 生成 | 根据可用工具动态生成使用指南 |
| 11 | 事件总线解耦运行时和 UI | 方便扩展不同 UI 终端 |
| 12 | 更严格的 skill 命名校验 | 小写字母数字短横线、64 字限制 |

---

## 九、thething 的优势（已超越 pi 的方面）

值得注意的是，thething 在以下方面已经优于 pi：

1. **MCP 集成**——pi 完全没有 MCP 支持
2. **系统提示词模块化**——section 系统远超 pi 的字符串拼接
3. **Agent 路由和子代理编排**——auto-routing + recursion guard + parallel agent
4. **配置管理分层**——bootstrap → createContext → createAgent 渐进解析
5. **全面的会话追踪**——token/cost/denial/model-switching
6. **模型自动降级/升级**——pi 无此功能
7. **持久化**——SQLite（messages/conversations/costs/todos）
8. **工具结果压缩**——`compact_tool_result` + compaction 策略

---

## 十、结论

两个项目定位不同：pi 是**编码专用助手**，thething 是**通用型个人助手**。thething 的架构更复杂、能力更全面。但 pi 在某些**简洁性和用户体验**设计上值得借鉴：

- **Prompt Template 系统**是最值得引入的功能，几乎没有架构冲突
- **toolSnippets** 是低成本的系统提示词改进
- **钩子系统**和**Definition/Instance 分离**是架构层面的优化，引入成本较高但长期收益大
