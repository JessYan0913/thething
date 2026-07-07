# 前端命令重构总结

## 重构目标

学习 CCB (Claude Code Best) 项目的命令设计模式，重构我们的 `/` 命令处理逻辑：
- **前端命令**：在前端执行，不发送给 AI（如切换 agent、model、mode）
- **AI 命令**：发送给 AI 执行（如调用 skill）

## 重构内容

### 1. 创建命令解析器

**文件**: `packages/app/lib/command-parser.ts`

```typescript
// 区分前端命令和 AI 命令
export type CommandResult = 
  | { type: 'frontend'; command: string; args: string }
  | { type: 'ai'; command: string; args: string }
  | { type: 'none'; text: string };
```

**命令分类**:
| 类型 | 命令 | 处理方式 |
|------|------|---------|
| 前端命令 | `/agent xxx` | 切换 agent，清空输入 |
| 前端命令 | `/model xxx` | 切换 model，清空输入 |
| 前端命令 | `/mode xxx` | 切换审批模式，清空输入 |
| AI 命令 | `/skill xxx` | 发送给 AI 调用 skill |

### 2. 修改消息发送逻辑

**文件**: `packages/app/components/Chat.tsx`

修改 `handleSend` 函数：
```typescript
const handleSend = useCallback(
  async ({ text, files }: PromptInputMessage) => {
    const trimmed = text.trim();
    if (!trimmed && files.length === 0) return;

    // 解析命令
    const commandResult = parseCommand(trimmed);

    // 前端命令：执行后不发送消息
    if (commandResult.type === 'frontend') {
      switch (commandResult.command) {
        case 'agent':
          handleAgentChange(commandResult.args || 'auto');
          break;
        case 'model':
          handleModelChange(commandResult.args || 'default');
          break;
        case 'mode':
          handleApprovalModeChange(commandResult.args || 'smart');
          break;
      }
      // 清空输入框
      const textarea = document.querySelector('textarea[name="message"]') as HTMLTextAreaElement;
      if (textarea) {
        textarea.value = '';
        textarea.focus();
      }
      return;
    }

    // AI 命令或普通消息：发送给 AI
    sendMessage({ text, files: files.length > 0 ? files : undefined });
  },
  [sendMessage, handleAgentChange, handleModelChange, handleApprovalModeChange],
);
```

## 架构优势

### 单一职责
- 命令解析逻辑集中在 `command-parser.ts`
- 消息发送逻辑在 `handleSend`

### 可扩展性
新增命令只需修改 `parseCommand` 函数：
1. 添加命令到 `FRONTEND_COMMANDS` 或 `AI_COMMANDS`
2. 在 `handleSend` 中添加相应的处理逻辑

### 清晰的边界
- 前端命令：不消耗 token，立即生效
- AI 命令：作为用户消息发送给 AI

## 使用示例

### 前端命令（不发送给 AI）
```
/agent explore     → 切换到 explore agent，清空输入
/model fast        → 切换到 fast model，清空输入
/mode full-trust   → 切换到完全信任模式，清空输入
```

### AI 命令（发送给 AI）
```
/skill docx 编辑文档    → AI 调用 docx skill 编辑文档
/skill pdf 生成报告    → AI 调用 pdf skill 生成报告
```

## 待优化

1. **命令提示**：可以在输入时显示命令参数提示
2. **命令验证**：验证命令参数的有效性
3. **命令历史**：记录最近使用的命令
4. **自定义命令**：支持用户自定义命令
