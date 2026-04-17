# 权限控制体系设计

> 融合 Claude Code 三级权限模型设计哲学、AI SDK v6 原生能力与当前项目架构
> **2026-04-18 更新**：移除 RBAC 和多用户系统相关内容，简化为单用户场景

## 文档信息

- **创建日期**: 2026-04-16
- **参考来源**:
  - [Claude Code 权限模型](https://ccb.agent-aura.top/docs/safety/permission-model)
  - [claude-code-best/claude-code](https://github.com/claude-code-best/claude-code) 源码审计
  - [AI SDK v6 官方文档](https://ai-sdk.dev/docs)
  - 当前项目代码审计 (`E:\thething/src/`)
- **工作场景**: 企业级私有化部署，单用户使用，中心化云服务器

---

## 1. 设计哲学

### 1.1 核心原则：Defense-in-Depth（纵深防御）

权限控制不是单一检查点，而是多层独立防线。每一层都可以独立做出 Allow/Ask/Deny 裁决，任何一层 Deny 即终止操作。

```
用户请求 → L1 规则引擎 → L2 工具自检 → L3 模式约束 → L4 AI 分类器 → L5 Hook 系统 → 执行
            ↓              ↓              ↓              ↓              ↓
          Deny?          Deny?         Deny?          Deny?         Deny?
```

### 1.2 三行为裁决模型

每次工具调用只有三种裁决：

| 行为 | 用户体验 | SDK 映射 | 典型场景 |
|------|---------|---------|---------|
| **Allow** | 自动放行，无感知 | `needsApproval: false` 或动态函数返回 false | 读取项目内文件、git status |
| **Ask** | 弹出确认对话框 | `needsApproval: true` → `tool-approval-request` | 执行未知命令、写入敏感路径 |
| **Deny** | 直接拒绝，不可恢复 | `prepareStep` 中移除工具或 throw | 被禁止的命令、越权路径 |

### 1.3 规则来源的优先级链

规则从 4 个来源汇聚，优先级从高到低（高优先级覆盖低优先级）：

```
1. session         — 用户在当前对话中手动授权（"Always allow"）
2. cliArg          — 启动参数 / 环境变量
3. skill           — Skill 工具的 allowedTools 白名单
4. projectSettings — 项目级配置（.claude/settings.json）
```

**关键设计**: 低优先级规则永远不能覆盖高优先级的 Deny。这是 Claude Code 的 "bypass-immune" 安全底线。

---

## 2. 当前项目现状分析

### 2.1 已有能力

| 能力 | 位置 | 状态 |
|------|------|------|
| DenialTracker | `src/lib/agent-control/denial-tracking.ts` | ✅ 完整（3 次拒绝 + 冷却期） |
| Guardrails 中间件 | `src/lib/middleware/guardrails.ts` | ✅ PII 红化 |
| Bash needsApproval | `src/lib/tools/bash.ts:167-181` | ✅ 黑名单 + 白名单 + 需审批判定 |
| ask_user_question needsApproval | `src/lib/tools/ask-user-question.ts:41` | ✅ 强制需审批 |
| 前端审批 UI | `src/components/ai-elements/approval-panel.tsx` | ✅ 审批对话框 |
| 问题收集 UI | `src/components/ai-elements/user-question-panel.tsx` | ✅ 多选问题面板 |
| 审批响应流程 | `src/components/Chat.tsx:215-325` | ✅ addToolApprovalResponse |
| 技能级工具白名单 | `src/lib/skills/` | ✅ `Skill.allowedTools` |
| Denial 注入 pipeline | `src/lib/agent-control/pipeline.ts:59-67` | ✅ 阈值检查 |

### 2.2 缺失能力（本设计要解决的）

| 缺失项 | 风险 | 影响 | 备注 |
|--------|------|------|------|
| 文件路径 allowlist/blocklist | 高 | read/edit/write 可操作任意系统路径 | **Phase 1 待完善** |
| 规则引擎 + 优先级层叠 | 中 | 无统一规则匹配逻辑 | **Phase 1 待完善** |
| Bash 安全命令白名单 | 低 | 已有部分实现 | 可扩展更多安全命令 |
| 规则持久化（"Always allow"） | 低 | 会话结束后规则丢失 | 可选实现 |

---

## 3. 整体架构设计

### 3.1 模块划分

```
src/lib/permissions/
├── types.ts                    # 类型定义（PermissionResult, PermissionRule）
├── engine.ts                   # 核心规则匹配引擎（三维度匹配）
├── rule-loader.ts              # 规则加载器（4 层来源聚合）
├── rule-parser.ts              # 规则字符串解析（如 "Bash(git *)"）
├── path-validation.ts          # 文件系统路径验证
└── persistence.ts              # 规则持久化（SQLite，可选）
```

> **注**: Bash 命令安全分类器、权限模式管理、Hook 系统等高级功能已移除。
> 当前基础审批流程已够用，文件路径验证是主要待完善项。

### 3.2 权限决策流水线

每次工具调用经过以下流水线（映射到 AI SDK 的生命周期）：

```
Step 0: 工具调用生成 (LLM → tool call)
         ↓
Step 1: prepareStep 前置检查 (SDK prepareStep callback)
    1a. 全局 Deny 规则检查 → 命中则从 activeTools 移除工具
    1b. 权限模式检查（plan 模式 deny 所有写操作）
    1c. RBAC 角色检查 → 无权限则 deny
         ↓
Step 2: 规则引擎匹配 (SDK needsApproval 动态函数)
    2a. 工具名精确匹配（Blanket allow/deny）
    2b. 命令模式匹配（Bash 工具专用）
    2c. 路径模式匹配（Read/Edit/Write 工具专用）
         ↓
Step 3: 工具自检
    3a. Bash: 危险命令黑名单 → 命中则 deny
    3b. File: 路径越界检查 → 越界则 deny
         ↓
Step 4: AI 分类器（auto 模式）
    4a. 发送 transcript + action 给 LLM 评估安全性
    4b. 返回 allow/ask/deny
         ↓
Step 5: Hook 系统
    5a. PreToolUse hook → 可 override 为 allow/deny/ask
         ↓
Step 6: 默认行为
    6a. 未命中任何规则 → 按当前 permissionMode 默认行为
```

### 3.3 与 AI SDK 的集成点

| SDK 能力 | 用途 | 实现方式 |
|----------|------|---------|
| `needsApproval: async ()` | 动态审批决策 | 规则引擎返回 true → Ask，false → Allow |
| `tool-approval-request` | 前端审批 UI | 检测 content 中的 approval request → 渲染对话框 |
| `tool-approval-response` | 用户审批回传 | 用户确认/拒绝 → 添加 response 到 messages |
| `prepareStep` | 工具动态管理 | 按权限模式动态设置 `activeTools` |
| `activeTools` | 工具可见性控制 | Deny 规则命中的工具从列表移除 |
| `experimental_context` | 传递权限上下文 | 传入 PermissionContext 到工具 execute |
| LanguageModelMiddleware | 输出层防护 | guardrails 中间件增强为权限审计 |

---

## 4. 核心类型定义

### 4.1 权限结果

```typescript
type PermissionBehavior = 'allow' | 'ask' | 'deny';

interface PermissionResult {
  behavior: PermissionBehavior;
  message?: string;           // 展示给用户的原因
  updatedInput?: Record<string, unknown>; // Hook 可修改输入
  decisionReason?: string;    // 内部审计日志
  source?: PermissionRuleSource; // 命中了哪个来源的规则
}
```

### 4.2 权限规则

```typescript
type PermissionRuleSource =
  | 'session'        // 当前对话中的临时授权
  | 'cliArg'         // 启动参数/环境变量
  | 'skill'          // Skill 工具的 allowedTools
  | 'projectSettings'; // .claude/settings.json

interface PermissionRule {
  id: string;
  source: PermissionRuleSource;
  behavior: PermissionBehavior;
  toolName: string;           // "Bash", "read_file", "mcp__server__*"
  ruleContent?: string;       // "git *", "src/**", "npm publish:*"
  createdAt: Date;
  expiresAt?: Date;           // 临时授权（session 级）
}
```

### 4.3 权限上下文

```typescript
interface PermissionContext {
  rules: Map<PermissionRuleSource, PermissionRule[]>;
  workingDir: string;
  denialTracker: DenialTracker;
}
```
  };
}
```

---

## 5. 规则匹配引擎设计

### 5.1 三维度匹配

#### 维度 1: 工具名匹配

```typescript
function toolMatchesRule(toolName: string, rule: PermissionRule): boolean {
  if (rule.toolName === toolName) return true;
  if (rule.toolName.includes('*')) {
    return minimatch(toolName, rule.toolName);
  }
  // MCP 工具: mcp__server__tool 匹配 mcp__server 或 mcp__server__*
  if (toolName.startsWith('mcp__')) {
    const [_, server] = toolName.split('__');
    if (rule.toolName === `mcp__${server}`) return true;
    if (rule.toolName === `mcp__${server}__*`) return true;
  }
  return false;
}
```

#### 维度 2: 命令模式匹配（Bash 专用）

```typescript
function commandMatchesRule(command: string, ruleContent: string): boolean {
  // 解析 ruleContent 为模式
  // "git *" → 匹配以 git 开头的所有命令
  // "npm publish:*" → 匹配 npm publish 开头的命令
  // "*" → 匹配所有命令
  const pattern = ruleContent.replace(/\*/g, '.*');
  return new RegExp(`^${pattern}`).test(command.trim());
}
```

#### 维度 3: 路径匹配（文件工具专用）

```typescript
function pathMatchesRule(filePath: string, ruleContent: string): boolean {
  return minimatch(filePath, ruleContent, { dot: true });
}
```

### 5.2 规则优先级评估

```typescript
function evaluatePermission(
  toolName: string,
  input: Record<string, unknown>,
  context: PermissionContext,
): PermissionResult {
  // 按优先级从高到低检查每个来源
  const sources: PermissionRuleSource[] = [
    'session', 'cliArg', 'skill', 'projectSettings',
  ];

  for (const source of sources) {
    const rules = context.rules.get(source) || [];

    // 先检查 deny 规则（高优先级 deny 不可覆盖）
    const denyRule = rules.find(r =>
      r.behavior === 'deny' &&
      toolMatchesRule(toolName, r) &&
      contentMatchesRule(input, r)
    );
    if (denyRule) {
      return { behavior: 'deny', source, decisionReason: `Denied by ${source} rule` };
    }

    // 再检查 ask 规则
    const askRule = rules.find(r =>
      r.behavior === 'ask' &&
      toolMatchesRule(toolName, r) &&
      contentMatchesRule(input, r)
    );
    if (askRule) {
      return { behavior: 'ask', source, decisionReason: `Ask by ${source} rule` };
    }

    // 最后检查 allow 规则
    const allowRule = rules.find(r =>
      r.behavior === 'allow' &&
      toolMatchesRule(toolName, r) &&
      contentMatchesRule(input, r)
    );
    if (allowRule) {
      return { behavior: 'allow', source, decisionReason: `Allowed by ${source} rule` };
    }
  }

  // 未命中任何规则 → 返回默认行为
  return getDefaultBehavior(toolName, context);
}
```

### 5.3 规则解析器

支持用户友好的规则格式：

```
Bash                    → 整个 Bash 工具
Bash(git *)             → Bash 工具中 git 开头的命令
Bash(npm publish:*)     → Bash 工具中 npm publish 开头的命令
read_file(src/**)       → read_file 工具中 src/ 下的文件
edit_file(.claude/*)    → edit_file 工具中 .claude/ 下的文件（deny）
mcp__github             → 整个 GitHub MCP 服务器
mcp__github__*          → 同上（通配符）
```

```typescript
function parseRuleString(ruleStr: string): Omit<PermissionRule, 'id' | 'source' | 'createdAt'> {
  const match = ruleStr.match(/^(\w[\w_]*)(?:\((.+)\))?$/);
  if (!match) throw new Error(`Invalid rule format: ${ruleStr}`);

  return {
    behavior: ruleStr.startsWith('deny:') ? 'deny' :
              ruleStr.startsWith('ask:') ? 'ask' : 'allow',
    toolName: match[1].replace(/^(allow|deny|ask):/, ''),
    ruleContent: match[2],
  };
}
```

---

## 6. AI SDK 集成实现

### 6.1 needsApproval 动态审批

```typescript
import { tool } from 'ai';
import { z } from 'zod';
import { evaluatePermission, PermissionContext } from './permissions';

export function createBashTool(context: PermissionContext) {
  return tool({
    description: '执行 shell 命令',
    inputSchema: z.object({
      command: z.string().describe('要执行的命令'),
      timeoutMs: z.number().optional().default(30000),
    }),
    needsApproval: async ({ command }) => {
      const result = evaluatePermission('bash', { command }, context);
      if (result.behavior === 'deny') {
        throw new Error(`操作被拒绝: ${result.decisionReason}`);
      }
      return result.behavior === 'ask';
    },
    execute: async ({ command, timeoutMs }, { experimental_context }) => {
      const ctx = experimental_context as PermissionContext;
      // 工具内二次检查（defense-in-depth）
      const safety = classifyCommand(command);
      if (safety.dangerous) {
        throw new Error(`安全阻止: ${safety.reason}`);
      }
      // ... 执行命令
    },
  });
}
```

### 6.2 审批请求/响应流程（Web 端）

```typescript
// API Route: app/api/chat/route.ts
export async function POST(request: Request) {
  const { messages, approvalResponses } = await request.json();

  // 如果有审批响应，注入到消息流
  if (approvalResponses?.length > 0) {
    messages.push({
      role: 'tool',
      content: approvalResponses.map((r: ToolApprovalResponse) => ({
        type: 'tool-approval-response',
        approvalId: r.approvalId,
        approved: r.approved,
        reason: r.reason,
      })),
    });
  }

  const result = await agent.stream({ messages });

  return createAgentUIStreamResponse({
    agent,
    uiMessages: messages,
    onFinish: async ({ response }) => {
      // 检测是否有审批请求
      const approvalRequests = response.messages
        .flatMap(m => Array.isArray(m.content) ? m.content : [])
        .filter(part => part.type === 'tool-approval-request');

      if (approvalRequests.length > 0) {
        // 前端会收到 approvalRequests，展示确认对话框
        // 用户确认后，再次调用此 API 携带 approvalResponses
      }
    },
  });
}
```

### 6.3 prepareStep 动态工具管理

```typescript
// 在 pipeline.ts 中集成权限检查
prepareStep: async ({ stepNumber, messages, model }) => {
  const permissionContext = sessionState.permissionContext;

  // Plan 模式：移除所有写操作工具
  if (permissionContext.mode === 'plan') {
    return {
      messages,
      activeTools: ['read_file', 'grep', 'glob', 'exa_search'], // 仅保留只读工具
    };
  }

  // 检查 DenialTracker
  if (sessionState.denialTracker.isThresholdExceeded()) {
    const exceededTools = sessionState.denialTracker.getSummary().exceededTools;
    // 从 activeTools 中移除超限工具
    const allTools = ['bash', 'read_file', 'edit_file', 'write_file', 'grep', 'glob'];
    const allowedTools = allTools.filter(t => !exceededTools.includes(t));
    return { messages, activeTools: allowedTools };
  }

  // 默认：所有工具可用（needsApproval 会做细粒度控制）
  return { messages };
}
```

### 6.4 权限审计中间件

```typescript
// 在现有 guardrails/cost/telemetry 中间件链中增加权限审计
export const permissionAuditMiddleware: LanguageModelV3Middleware = {
  specificationVersion: 'v3',

  wrapGenerate: async ({ doGenerate, params }) => {
    const result = await doGenerate();

    // 审计工具调用
    for (const part of result.content) {
      if (part.type === 'tool-call') {
        logPermissionAudit({
          timestamp: Date.now(),
          toolName: part.toolName,
          input: part.input,
          userId: params.experimental_context?.userId,
          sessionId: params.experimental_context?.sessionId,
        });
      }
    }

    return result;
  },

  wrapStream: async ({ doStream }) => {
    const { stream, ...rest } = await doStream();
    // 流式审计逻辑...
    return { stream, ...rest };
  },
};
```

---

## 7. 路径验证设计

### 7.1 路径安全检查

```typescript
interface PathValidationResult {
  allowed: boolean;
  reason?: string;
  resolvedPath: string;
}

function validatePath(
  filePath: string,
  context: PermissionContext,
): PathValidationResult {
  const resolved = path.resolve(context.workingDir, filePath);

  // 1. 越界检查：不允许访问工作目录外的路径
  if (!resolved.startsWith(context.workingDir)) {
    return { allowed: false, reason: '路径越界：不允许访问工作目录外的文件', resolvedPath: resolved };
  }

  // 2. 敏感路径检查（bypass-immune，即使 bypass 模式也生效）
  const sensitivePaths = ['.git/', '.claude/', '.env', 'node_modules/.cache/'];
  for (const sensitive of sensitivePaths) {
    if (resolved.includes(sensitive)) {
      return { allowed: false, reason: `敏感路径被保护: ${sensitive}`, resolvedPath: resolved };
    }
  }

  // 3. 角色路径检查
  const role = getRole(context.roleId);
  for (const denied of role.permissions.deniedPaths) {
    if (minimatch(resolved, denied)) {
      return { allowed: false, reason: `角色权限拒绝: ${denied}`, resolvedPath: resolved };
    }
  }

  // 4. 规则引擎路径检查
  const ruleResult = evaluatePermission('read_file', { filePath }, context);
  if (ruleResult.behavior === 'deny') {
    return { allowed: false, reason: ruleResult.decisionReason, resolvedPath: resolved };
  }

  return { allowed: true, resolvedPath: resolved };
}
```

### 7.2 TOCTOU 防护

```typescript
// 防止 Time-of-Check-to-Time-of-Use 攻击
function securePathChecks(filePath: string): string[] {
  const dangerous = [];

  // 阻止 shell 展开
  if (/[\$`~]/.test(filePath)) dangerous.push('包含 shell 展开语法');
  if (/%\w+%/.test(filePath)) dangerous.push('包含 Windows 环境变量展开');

  // 阻止 UNC 路径（Windows）
  if (filePath.startsWith('\\\\')) dangerous.push('UNC 路径被禁止');

  // 阻止符号链接跳转
  // (在 resolve 后检查 symlink)

  return dangerous;
}
```

---

## 8. 命令安全分类器

> **当前状态**: 已在 `src/lib/tools/bash.ts` 中实现黑白名单检查。

现有实现已够用，安全命令白名单可按需扩展：

```typescript
const SAFE_COMMANDS = [
  'git status', 'git log', 'git diff', 'git branch',
  'ls', 'dir', 'pwd', 'cd',
  'cat', 'head', 'tail', 'wc',
  'find ', 'grep ', 'echo ',
  'npm run build', 'npm run lint', 'npm test',
  'pnpm run', 'yarn run',
];
```

---

---

## 9. 持久化（可选）

> **注**: 当前会话级规则已够用。持久化用于"Always allow"功能，可按需实现。

SQLite 存储（简化版）：

```sql
CREATE TABLE permission_rules (
  id TEXT PRIMARY KEY,
  source TEXT NOT NULL CHECK (source IN ('session', 'cliArg', 'skill', 'projectSettings')),
  behavior TEXT NOT NULL CHECK (behavior IN ('allow', 'ask', 'deny')),
  tool_name TEXT NOT NULL,
  rule_content TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  expires_at DATETIME,
  UNIQUE(source, tool_name, rule_content)
);
```

---

## 10. 前端审批 UI（已实现）

> **当前状态**: 基础审批 UI 已在 `src/components/ai-elements/` 实现。

### 10.1 已实现组件

| 组件 | 文件 | 功能 |
|------|------|------|
| ApprovalPanel | `approval-panel.tsx` | Bash/文件工具审批对话框 |
| UserQuestionPanel | `user-question-panel.tsx` | ask_user_question 多选问题面板 |

### 10.2 审批响应流程（已实现）

```typescript
// Chat.tsx 中已实现的流程
const { addToolApprovalResponse } = useChat({...});

// 检测 approval-requested 状态
if (toolPart.state === 'approval-requested') {
  setApprovalDialog({
    isOpen: true,
    approvalId: toolPart.approval.id,
    toolName, toolInput,
  });
}

// 用户批准
const handleApprove = (approvalId: string) => {
  addToolApprovalResponse({ id: approvalId, approved: true });
};

// 用户拒绝
const handleDeny = (approvalId: string, reason?: string) => {
  addToolApprovalResponse({ id: approvalId, approved: false, reason });
};
```
            approved: false,
            reason: '用户拒绝此操作',
          });
          denialTracker.record(toolCall.toolName, '用户拒绝');
        },
      });
    }
  },
});
```

---

## 11. 实施计划（简化版）

### 已完成 ✅

| 任务 | 文件 | 状态 |
|------|------|------|
| Bash needsApproval | `src/lib/tools/bash.ts` | ✅ 黑名单 + 白名单 + 需审批判定 |
| ask_user_question needsApproval | `src/lib/tools/ask-user-question.ts` | ✅ 强制需审批 |
| 前端审批 UI | `src/components/ai-elements/` | ✅ ApprovalPanel + UserQuestionPanel |
| 审批响应流程 | `src/components/Chat.tsx` | ✅ addToolApprovalResponse |

### 待完成 ⏳

| 任务 | 文件 | 说明 | 优先级 |
|------|------|------|--------|
| 路径验证 | `src/lib/permissions/path-validation.ts` | read/edit/write 工具路径检查 | P1 |
| 类型定义 | `src/lib/permissions/types.ts` | PermissionResult, PermissionRule | P2 |
| 规则引擎 | `src/lib/permissions/engine.ts` | 三维度匹配（可选） | P3 |
| 规则持久化 | `src/lib/permissions/persistence.ts` | "Always allow" 功能（可选） | P4 |

> **注**: 当前基础审批流程已够用。路径验证是主要待完善项，规则引擎和持久化可按需实施。
| 权限 Hook 系统 | `src/lib/permissions/hooks.ts` | PreToolUse 等钩子 |

---

## 12. 安全底线（Bypass-Immune）

以下安全检查**任何情况下都不可绕过**：

1. **工作目录越界**: 不允许访问 `workingDir` 外的路径
2. **敏感路径保护**: `.git/`, `.claude/`, `.env`, shell 配置文件
3. **危险命令黑名单**: `rm -rf /`, `dd`, `mkfs`, `curl` 到未知域名等
4. **Shell 展开阻止**: `$VAR`, `%VAR%`, `~user`, `` `cmd` ``

这些检查在规则引擎之前执行，确保即使配置错误也不会导致安全事故。

---

## 13. 总结

本设计融合了 Claude Code 的三级权限模型（Allow/Ask/Deny）和 AI SDK v6 的原生能力（`needsApproval`, `tool-approval-request/response`），已实现基础审批流程。

**已实现功能**:
1. Bash 工具 needsApproval（黑名单 + 白名单 + 需审批判定）
2. ask_user_question 工具强制审批
3. 前端审批 UI + 审批响应流程

**待完善功能**:
1. 文件工具路径验证（read/edit/write）
2. 规则引擎（可选）
3. 规则持久化（可选）

**与 Claude Code 的差异**:
- 无 OS 级 Sandbox（Web 应用不需要）
- 无 RBAC 多用户系统（单用户场景）
- 规则来源简化为 4 层
- 无权限模式切换（default 模式已够用）