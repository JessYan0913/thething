# Desktop应用审批状态恢复问题修复方案

## 问题描述

当Agent运行时遇到需要审批的工具调用时，Desktop应用会卡死；重新打开应用后，没有恢复需要审批的内容，输入框上方没有显示需要审批的内容。

## 根本原因

### 1. 内存状态丢失
- `approval-context.ts`中的`suspendedStates`是一个内存Map，重启后丢失
- 完整的执行现场（`SuspendedAgentState`）未持久化到数据库

### 2. SQLite持久化不完整
- `agent-run-store.ts`只持久化了状态标记（`paused_approval`）和`approvalId`
- 未持久化：`pausedModelMessages`、`allSteps`、`responseText`等执行现场

### 3. Web UI状态未恢复
- `approvalRequests`是React state，页面刷新后重置为空
- 没有从后端API获取待审批状态的机制

## 修复方案

### Phase 1: 后端状态持久化（核心）

#### 1.1 扩展SQLite表结构
```sql
-- 在agent_runs表中添加suspended_state字段
ALTER TABLE agent_runs ADD COLUMN suspended_state TEXT;

-- 创建suspended_approvals表
CREATE TABLE IF NOT EXISTS suspended_approvals (
  conversation_id TEXT PRIMARY KEY,
  approval_id TEXT NOT NULL,
  tool_call_id TEXT NOT NULL,
  tool_name TEXT NOT NULL,
  tool_input TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  FOREIGN KEY (conversation_id) REFERENCES agent_runs(conversation_id)
);
```

#### 1.2 修改approval-context.ts
```typescript
// 将内存Map改为数据库存储
export async function setSuspendedState(
  conversationId: string, 
  state: SuspendedAgentState,
  db: SqliteDatabase
): Promise<void> {
  // 1. 序列化state
  const serialized = JSON.stringify({
    pausedModelMessages: state.pausedModelMessages,
    allSteps: state.allSteps,
    responseText: state.responseText,
    writtenFiles: state.writtenFiles,
    approvedTools: state.approvedTools,
  });
  
  // 2. 保存到agent_runs表
  await db.run(
    'UPDATE agent_runs SET suspended_state = ? WHERE conversation_id = ?',
    [serialized, conversationId]
  );
  
  // 3. 保存待审批项到suspended_approvals表
  for (const approval of state.pendingApprovals) {
    await db.run(
      `INSERT OR REPLACE INTO suspended_approvals 
       (conversation_id, approval_id, tool_call_id, tool_name, tool_input, created_at, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        conversationId,
        approval.approvalId,
        approval.toolCallId,
        approval.toolName,
        JSON.stringify(approval.toolInput),
        new Date(state.createdAt).toISOString(),
        new Date(state.createdAt + SUSPENDED_TTL_MS).toISOString(),
      ]
    );
  }
}

export async function getSuspendedState(
  conversationId: string,
  db: SqliteDatabase
): Promise<SuspendedAgentState | null> {
  // 1. 从agent_runs获取序列化状态
  const run = await db.get(
    'SELECT suspended_state FROM agent_runs WHERE conversation_id = ?',
    [conversationId]
  );
  
  if (!run?.suspended_state) return null;
  
  const state = JSON.parse(run.suspended_state);
  
  // 2. 从suspended_approvals获取待审批项
  const approvals = await db.all(
    'SELECT * FROM suspended_approvals WHERE conversation_id = ?',
    [conversationId]
  );
  
  // 3. 检查过期
  if (approvals.length > 0 && new Date(approvals[0].expires_at) < new Date()) {
    await clearSuspendedState(conversationId, db);
    return null;
  }
  
  return {
    conversationId,
    pausedModelMessages: state.pausedModelMessages,
    pendingApprovals: approvals.map(a => ({
      approvalId: a.approval_id,
      toolCallId: a.tool_call_id,
      toolName: a.tool_name,
      toolInput: JSON.parse(a.tool_input),
    })),
    allSteps: state.allSteps,
    responseText: state.responseText,
    writtenFiles: state.writtenFiles || [],
    approvedTools: state.approvedTools || [],
    createdAt: new Date(approvals[0]?.created_at || Date.now()).getTime(),
  } as SuspendedAgentState;
}
```

#### 1.3 修改agent-run-store.ts
```typescript
// 添加获取待审批conversation的方法
async getConversationsNeedingApproval(): Promise<string[]> {
  const rows = await this.db.all(
    `SELECT conversation_id FROM agent_runs 
     WHERE status = 'paused_approval' 
     AND pending_approval_id IS NOT NULL`
  );
  return rows.map(row => row.conversation_id);
}
```

### Phase 2: Web UI恢复机制

#### 2.1 添加API端点
```typescript
// packages/app/app/api/chat/pending-approvals/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { getStore } from '@/lib/store';

export async function GET(request: NextRequest) {
  try {
    const store = getStore();
    const conversationIds = await store.agentRunStore.getConversationsNeedingApproval();
    
    const pendingApprovals = [];
    for (const conversationId of conversationIds) {
      const state = await store.approvalContext.getSuspendedState(conversationId);
      if (state) {
        pendingApprovals.push({
          conversationId,
          approvals: state.pendingApprovals,
        });
      }
    }
    
    return NextResponse.json({ pendingApprovals });
  } catch (error) {
    console.error('Failed to get pending approvals:', error);
    return NextResponse.json({ pendingApprovals: [] });
  }
}
```

#### 2.2 修改Chat.tsx
```typescript
// 在Chat组件中添加状态恢复逻辑
useEffect(() => {
  const restorePendingApprovals = async () => {
    try {
      const res = await fetch('/api/chat/pending-approvals');
      if (res.ok) {
        const data = await res.json();
        // 找到当前conversationId的待审批项
        const currentPending = data.pendingApprovals.find(
          (p: any) => p.conversationId === conversationId
        );
        if (currentPending && currentPending.approvals.length > 0) {
          setApprovalRequests(currentPending.approvals);
        }
      }
    } catch (error) {
      console.error('Failed to restore pending approvals:', error);
    }
  };
  
  if (conversationId) {
    restorePendingApprovals();
  }
}, [conversationId]);
```

### Phase 3: Desktop应用稳定性

#### 3.1 Agent运行时隔离
```typescript
// 修改Desktop主进程，将Agent运行时放到独立worker
const { Worker } = require('worker_threads');

// 或者使用child_process
const agentProcess = spawn(nodeExe, [agentScript], {
  detached: true,
  stdio: 'pipe'
});
```

#### 3.2 添加心跳检测
```typescript
// 在main.ts中添加
function setupHeartbeat() {
  setInterval(() => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('heartbeat');
    }
  }, 5000);
}
```

## 实施步骤

### 优先级1（立即修复）
1. 修改`approval-context.ts`，添加SQLite持久化
2. 修改`agent-run-store.ts`，添加获取待审批conversation的方法
3. 添加`/api/chat/pending-approvals` API端点
4. 修改`Chat.tsx`，在组件挂载时恢复待审批状态

### 优先级2（稳定性提升）
5. 优化Desktop应用的Agent运行时隔离
6. 添加状态恢复的错误处理和重试机制
7. 添加用户通知（显示"恢复了X个待审批操作"）

### 优先级3（长期优化）
8. 实现完整的状态机，支持更复杂的恢复场景
9. 添加审批超时的自动处理机制
10. 优化Electron的IPC通信性能

## 测试用例

1. **基础恢复测试**：
   - 启动Agent → 触发审批 → 关闭应用 → 重新打开 → 验证审批UI显示

2. **多conversation测试**：
   - 同时运行多个conversation → 都触发审批 → 重启应用 → 验证所有待审批项恢复

3. **超时测试**：
   - 触发审批 → 等待5分钟 → 验证状态自动清理

4. **边界测试**：
   - 审批过程中断网 → 恢复网络 → 验证状态一致性

## 风险评估

- **低风险**：SQLite持久化是现有架构的自然扩展
- **中风险**：状态序列化/反序列化可能丢失类型信息
- **高风险**：如果执行现场过大，可能影响数据库性能

## 回滚方案

如果修复引入新问题，可以：
1. 禁用自动恢复功能（通过环境变量）
2. 回退到纯内存状态（保留代码但不使用）
3. 添加手动恢复命令（用户输入`/restore`触发）
