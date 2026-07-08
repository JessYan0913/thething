# Plan: Bash 后台进程支持

## Context

当前 bash 工具在执行 `node server.ts`、`npm start` 等永远不会退出的命令时，会一直阻塞直到超时（默认 30s，最大 5min），然后杀掉进程。这导致 Agent 无法启动长时间运行的服务。

## 技术方案

在 bash 工具中添加 `background` 参数。当 `background: true` 时：

1. 使用 `detached: true` 和 `stdio: 'ignore'` 创建子进程
2. 调用 `unref()` 使子进程不阻塞父进程
3. 立即返回 PID 和日志文件路径
4. Agent 可以用普通 bash 命令查看日志、停止进程

### 日志目录

使用 `os.tmpdir()/.thething/bash-logs/` 存放后台进程日志，避免污染项目目录。

## 修改文件

### [bash.ts](packages/core/src/modules/tools/bash.ts)

1. 添加 `background` 参数到 inputSchema
2. 新增 `spawnBackground` 函数：创建 detached 进程，重定向输出到文件
3. 修改 `bashExecute`：当 `background: true` 时调用 `spawnBackground` 并立即返回
4. 更新 tool description 说明后台模式

```typescript
// inputSchema 新增
background: z.boolean().optional().default(false)
  .describe('Run command in background. Use for long-running processes like servers.'),

// 新增函数
function spawnBackground(command: string, cwd: string): { pid: number; logFile: string } {
  const logDir = path.join(os.tmpdir(), '.thething', 'bash-logs');
  fs.mkdirSync(logDir, { recursive: true });
  const logFile = path.join(logDir, `bg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.log`);
  const logStream = fs.createWriteStream(logFile);
  
  const child = spawn(command, [], {
    cwd,
    shell: true,
    detached: true,
    stdio: ['ignore', logStream, logStream],
  });
  child.unref();
  logStream.close();
  
  return { pid: child.pid!, logFile };
}
```

### 修改 `bashExecute` 和 `streamBashExecution`

当 `background: true` 时：
- 跳过流式输出逻辑
- 调用 `spawnBackground`
- 立即 yield 结果：`{ pid, logFile, command, background: true, message: "进程已在后台启动" }`

### description 更新

```
'To start a long-running process (server, dev server), set background: true. ' +
'The command runs detached and returns immediately with pid and logFile. ' +
'Use `cat <logFile>` to check output, `kill <pid>` to stop.'
```

## 实施步骤

1. 修改 `bash.ts`：添加 `background` 参数和 `spawnBackground` 函数
2. 修改 `bashExecute`：处理 background 模式
3. 类型检查验证

## 验证方式

1. 发送 "启动 mcp-circuit-sim 的开发服务器" 消息
2. Agent 使用 `background: true` 执行 `node server.ts`
3. 验证立即返回 PID 和 logFile
4. 验证 Agent 可以用 `cat <logFile>` 查看输出
5. 验证 Agent 可以用 `kill <pid>` 停止进程
