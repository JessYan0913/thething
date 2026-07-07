# 审批状态跨重启恢复 - 实施总结

## 修复的问题

Desktop应用在Agent运行时遇到需要审批的工具调用时会卡死，重新打开应用后没有恢复需要审批的内容。

## 根本原因

1. **内存状态丢失**：`approval-context.ts`中的`suspendedStates`是内存Map，重启后丢失
2. **SQLite持久化不完整**：只持久化了状态标记，不持久化完整执行现场
3. **Web UI状态未恢复**：`approvalRequests`是React state，页面刷新后重置为空

## 实施的修改

### 1. 数据库Schema扩展 (`packages/core/src/services/datastore/sqlite/schema.ts`)
- 版本从7升级到8
- 添加`suspended_agent_states`表，用于持久化挂起的Agent状态

```sql
CREATE TABLE IF NOT EXISTS suspended_agent_states (
  conversation_id TEXT PRIMARY KEY,
  suspended_state TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
);
```

### 2. 类型定义扩展 (`packages/core/src/primitives/datastore/types.ts`)
- 添加`SuspendedStateStore`接口
- 在`DataStore`接口中添加`suspendedStateStore`属性

### 3. SQLite Store实现 (`packages/core/src/services/datastore/sqlite/suspended-state-store.ts`)
- 新增`SQLiteSuspendedStateStore`类
- 实现完整的CRUD操作
- 支持过期状态清理

### 4. DataStore集成 (`packages/core/src/services/datastore/sqlite/sqlite-data-store.ts`)
- 导入并初始化`SQLiteSuspendedStateStore`
- 在`SQLiteDataStore`类中添加`suspendedStateStore`属性

### 5. Approval Context重构 (`packages/core/src/composition/inbound/approval-context.ts`)
- 添加`initializeApprovalContext()`函数，绑定SQLite存储
- 修改`setSuspendedState()`：同时保存到内存和SQLite
- 修改`getSuspendedState()`：优先从内存获取，回退到SQLite
- 修改`clearSuspendedState()`：同时清除内存和SQLite
- 启动时自动清理过期状态并恢复有效状态

### 6. Agent Handler集成 (`packages/core/src/composition/inbound/agent-handler.ts`)
- 导入`initializeApprovalContext`
- 在`AgentInboundHandler`构造函数中初始化approval-context

### 7. API端点 (`packages/app/app/api/chat/pending-approvals/route.ts`)
- 新增`GET /api/chat/pending-approvals`端点
- 返回所有待审批的conversation列表

### 8. Web UI恢复 (`packages/app/components/Chat.tsx`)
- 添加`useEffect`在组件挂载时恢复待审批状态
- 从后端API获取待审批状态并设置到`approvalRequests`

### 9. 模块导出 (`packages/core/src/services/datastore/sqlite/index.ts`)
- 导出`SQLiteSuspendedStateStore`

## 数据流

### 挂起流程
1. Agent遇到需要审批的工具调用
2. 调用`setSuspendedState()`保存执行现场
3. 同时保存到内存Map和SQLite数据库
4. 返回审批询问给用户

### 恢复流程
1. Desktop应用重启
2. `initializeApprovalContext()`从SQLite恢复状态到内存
3. Web UI组件挂载时调用`/api/chat/pending-approvals`
4. 后端从SQLite读取待审批状态
5. 前端设置`approvalRequests`状态
6. 用户可以看到并处理待审批操作

## 测试验证

### 测试场景1：基础恢复
1. 启动Agent → 触发审批 → 关闭应用 → 重新打开 → 验证审批UI显示

### 测试场景2：超时清理
1. 触发审批 → 等待5分钟 → 验证状态自动清理

### 测试场景3：多conversation
1. 同时运行多个conversation → 都触发审批 → 重启应用 → 验证所有待审批项恢复

## 注意事项

1. **过期机制**：审批状态5分钟后自动过期
2. **内存缓存**：使用内存Map作为一级缓存，SQLite作为持久化层
3. **错误处理**：数据库操作失败时记录日志但不中断流程
4. **向后兼容**：现有的内存模式仍然工作，SQLite持久化是增强功能
