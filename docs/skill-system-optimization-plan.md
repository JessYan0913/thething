# Skills 系统优化规划

> 基于对 Claude Code Best (CCB) 和 thething 项目的 Skill 机制深度对比分析。

## 一、CCB vs thething：现状对比

| 维度 | CCB (Claude Code Best) | thething (当前) |
|------|------------------------|-----------------|
| **加载时机** | 启动时 lazy load，仅加载 frontmatter | 启动时全量加载，包括 body |
| **Prompt 注入** | 仅注入 metadata（名称+描述+触发条件），**不注入 body** | 注入全部 skill 的完整 body |
| **Token 预算** | 1% context window (~8000 chars)，三级降级截断 | 无预算限制，全部塞入 |
| **激活方式** | 用户 `/skill-name` 或 AI 自动匹配 `whenToUse` | 全部激活，无区分 |
| **执行模式** | Inline（主对话）/ Fork（子Agent）双模式 | 仅 Inline |
| **工具白名单** | `allowedTools` 注入权限上下文，自动放行 | 未使用 |
| **模型/努力覆盖** | 支持 `model` 和 `effort` 字段动态覆盖 | 未使用 |
| **条件激活** | `paths` 匹配文件路径时才激活 | 加载即激活 |
| **动态发现** | 操作文件时向上扫描 `.claude/skills/` | 无动态发现 |
| **去重机制** | `realpath` 解决符号链接冲突 | Set 去重 |
| **使用排名** | 7 天指数半衰衰减 | 有记录但无使用 |

## 二、当前 thething 的问题

```text
System Prompt = Identity + Capabilities + Rules + ... + [全部 skill 的完整 body]
                                                              ↑ 可能占用 50K+ tokens
```

**核心问题**：

1. **Token 浪费严重** — 不管用不用，所有 skill body 都注入
2. **无预算控制** — 可能挤占其他重要上下文
3. **LLM 负担过重** — 让模型从全量 skill 中自己判断哪个适用
4. **allowedTools 未生效** — skill 声明的工具白名单没有注入到权限系统

## 三、CCB Skill 生命周期参考

```text
SKILL.md ─→ parseFrontmatter ─→ 仅 metadata 注入 prompt
                                    ↓
                             AI 调用 SkillTool
                                    ↓
                   ┌──┴── Inline: 注入 body 到主对话
                   └──┴── Fork:  启动独立 SubAgent
                             ↓
                   contextModifier() 修改权限+模型+effort
                             ↓
                   recordSkillUsage() → 指数衰减排名
```

## 四、the thing 当前架构

```text
SKILL.md ─→ parseFrontmatter ─→ 全部 body 注入 prompt
                                    ↓
                             LLM 自己判断用哪个
                                    ↓
                             ToolLoopAgent 执行
                             (无 Skill 专属管道)
```

## 五、架构层面的根本差距

CCB 有一个 **`SkillTool`** (`src/tools/SkillTool/SkillTool.ts`)，它是所有 Skill 的**统一入口**。这个 Tool 做了：

1. 接收用户或 AI 的 Skill 调用请求
2. `validateInput()` 验证 Skill 名称和参数
3. `checkPermissions()` 五层权限检查
4. `call()` 分支到 Inline 或 Fork 执行
5. `contextModifier()` 动态修改权限上下文（allowedTools/model/effort）
6. `recordSkillUsage()` 更新使用排名

**the thing 没有等价物**。当前所有 skills 只是 "静态注入 prompt 的文本"，没有执行管道。

## 六、真正接近 CCB 需要新增的核心组件

### 1. SkillTool（工具层）

- 统一 Skill 调用入口
- 权限检查
- Inline/Fork 路由

### 2. SkillContextModifier（上下文层）

- `allowedTools` → 工具权限白名单
- `model override` → 模型切换
- `effort override` → 执行深度

### 3. SkillArgumentParser（参数层）

- `$ARGUMENTS` 替换
- `!`...`` shell 展开（可选）
- `${CLAUDE_SKILL_DIR}` 替换

### 4. SkillLifecycleManager（生命周期层）

- 动态发现
- 条件激活
- 使用排名
- 远程加载（可选）

## 七、分阶段实施计划

### Phase 1: Prompt Budget 控制 + Lazy Loading（推荐优先实施）

**目标**: System Prompt 只注入 skill 列表（metadata），按需加载完整 body

```text
before: 注入全部 skill 完整 body → ~50K tokens
after:  注入 skill 列表 → ~2K tokens
        + 使用时才加载完整 body
```

**需要修改的文件**：

| 文件 | 修改内容 |
|------|----------|
| `src/lib/system-prompt/sections/skills.ts` | 只格式化 name/description/whenToUse，不注入 body |
| `src/app/api/chat/route.ts` | 接收用户消息后调用 `determineActiveSkills()` |
| `src/lib/skills/body-loader.ts` | 新增按需加载指定 skill body 的函数 |

**收益**：立即节省 ~48K tokens，Agent 不再盲目加载全部 skill 内容

### Phase 2: Tool Whitelist + Model Override

**目标**: skill 的 `allowedTools` 和 `model` 字段生效

**需要修改的文件**：

| 文件 | 修改内容 |
|------|----------|
| `src/lib/agent-control/pipeline.ts` | 当 skill 激活时注入 `allowedTools` 到工具可访问列表 |
| `src/app/api/chat/route.ts` | 根据 `model` 字段动态切换模型 |

### Phase 3: Conditional Activation

**目标**: 带 `paths` 的 skill 只在匹配文件操作时才激活

**需要修改的文件**：

| 文件 | 修改内容 |
|------|----------|
| `src/lib/skills/conditional-activation.ts` | 新增 `activateConditionalSkills(filePaths)` 函数 |
| `src/lib/tools/read-file.ts` | 在文件操作工具中调用条件激活检查 |
| `src/lib/tools/edit-file.ts` | 同上 |

## 八、建议与结论

### 不要追求 100% 复刻 CCB

原因：

1. CCB 的很多设计（shell 展开、bun build、MCP skills）依赖其特定架构
2. thething 是基于 Vercel AI SDK 的 web 应用，架构本质不同
3. 投入产出比低

### 务实路径

| 阶段 | 工作量 | 收益 | 优先级 |
|------|--------|------|--------|
| Phase 1 | 低 | 高 | ⭐⭐⭐ 优先 |
| Tool Whitelist | 中 | 中 | ⭐⭐ |
| Usage Ranking | 低 | 低 | ⭐ |

**Phase 1 就能解决核心痛点**（Token 浪费 + Agent 不知道 skills），后续按需迭代。

## 九、CCB 关键源码参考

| 模块 | CCB 源码路径 | 说明 |
|------|-------------|------|
| Skill 加载 | `src/skills/loadSkillsDir.ts` | frontmatter 解析 + 去重 + 条件激活 |
| SkillTool | `src/tools/SkillTool/SkillTool.ts` | 统一调用入口 + 权限检查 + Inline/Fork |
| Prompt 预算 | `src/utils/prompt.ts` | `formatCommandsWithinBudget()` 三级降级 |
| 使用排名 | `src/utils/skillUsageTracking.ts` | 7 天半衰衰减算法 |
| 动态发现 | `src/skills/loadSkillsDir.ts` | `discoverSkillDirsForPaths()` 向上扫描 |
| 权限检查 | `src/tools/SkillTool/SkillTool.ts` | `checkPermissions()` 五层检查 |
