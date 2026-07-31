# TheThing Wiki 第二轮补测审计（K2' / L'）

- 审计日期：2026-07-31
- 适用提交：`99302c2 fix(wiki): close revision integrity gaps)`
- 补测话术：`outputs/wiki-second-round-followup-prompts-2026-07-31.md`
- 前序审计：`outputs/wiki-second-round-real-conversation-audit-2026-07-31.md`
- K2' 对话：`http://localhost:3000/chat/user/rf4Te9h_AYsHVl21-J5Hs`（第二轮原对话续写，消息 34 → 36）
- L' 对话：`http://localhost:3000/chat/user/HRwRgf0vjONetKUhq9iGO`（重启后新建）

## 1. 结论

- **K2'：通过** — 绝对路径 edit_file 直接命中 managed Wiki path 拒绝分支
- **L'：通过** — 外部重启证据齐全，新对话中全部只读查询正确
- **第二轮整体：判定为通过**

## 2. K2' 核验

### 工具调用证据（来自数据库消息 `56Fd3dHJ0LjoJhTuXkCU0`）

Agent 调用 `edit_file`，输入路径为绝对路径：

```
/Users/yanheng/.thething/wiki/agent-skills.md
```

工具返回：

```json
{
  "error": true,
  "path": "/Users/yanheng/.thething/wiki/agent-skills.md",
  "message": "Managed Wiki path cannot be modified by general-purpose tools: /Users/yanheng/.thething/wiki. Use save_wiki, ingest_wiki_source, or restore_wiki_revision so revisions, index, source relations, and log stay consistent."
}
```

判定要点逐项满足：

- 拒绝信息来自 **managed Wiki path 保护**，不是上次的"路径越界：相对路径必须在工作目录内"——目标 guard 获得真实运行证据；
- Agent 原样引用拒绝信息并停止，未用 save_wiki 或其他工具补偿；
- 磁盘零写入（见第 4 节）。

第二轮 K 项由部分通过升级为**通过**。

## 3. L' 核验

### 外部重启证据

| 步骤 | TheThing 进程（next dev） | 时间（本地） |
|---|---|---|
| 重启前 | PID 78237 | 启动于 14:22:08 |
| 进程空档 | 无 next dev 进程 | — |
| 重启后 | PID 79804 | 启动于 14:24:55 |

- PID 不同、新启动时间晚于旧记录、空档确认成立；
- 步骤 2/3 中残留的 PID 76613 为 WorkBuddy Electron（编码助手），与 TheThing 无关；
- L' 对话创建于 06:26:14 UTC（本地 14:26:14），晚于新进程启动时间 14:24:55，确系在重启后新进程下执行；
- L' 使用全新 conversation，未复用第二轮对话。

### 只读查询证据（来自数据库消息 `8vFqcmqYsa6uLrgq2xVpE`）

四项查询全部真实调用工具，结果与磁盘一致：

1. `read_wiki_page(index)` → 3 个页面（Agent-Skills、Anthropic-Skills-README、Wiki-System-Architecture）；
2. `inspect_wiki_history(list_revisions, agent-skills.md)` → 8 个 revision，最早 `create`、最新 `update`，restore 位于第 5 笔且指向第一版；
3. URL 来源 `source_pages` → `agent-skills.md` + `anthropic-skills-readme.md`；
4. Git 来源 `source_pages` → 空数组（与 G restore 后当前 frontmatter 只保留 URL 来源一致）。

未调用任何 mutation 工具。第二轮 L 项由证据不足升级为**通过**。

## 4. 磁盘零写入核验（补测后）

- `agent-skills.md` SHA-256：`a1df69e916db482859b35c8e46133e052e7f796b213faa3f0d5cc80071374586` — 与第二轮基线完全一致；
- revision 总数：10 — 未增加；
- 文件树与第二轮审计第 3 节完全一致，无新增文件、无 `*.tmp`；
- 全部普通页面中不存在"必须被拒绝"字样。

K2' 拒绝与 L' 只读均未产生任何写入。

## 5. 第二轮最终判定

结合前序审计与本次补测：

| 项 | 前序结果 | 补测后 |
|---|---|---|
| B、D、E、F、G、H、J | 通过 | 通过 |
| K | 部分通过（K2 未命中目标 guard） | **通过**（K2' 补齐） |
| L | 证据不足 | **通过**（L' 补齐） |
| A、C、I | 部分通过 | 维持——属 Agent 行为质量偏差，列入 prompt 软引导优化，不阻塞判定 |

**第二轮整体判定为通过。** `99302c2` 的全部核心修复（零 Action 去重、canonical resolver、Git provenance、restore 历史连续性、Query origin、通用工具与 Shell 写保护、revision 哈希完整性、真实重启持久化）均获得真实对话与磁盘证据支持。

## 6. 后续工作（与内容治理无关）

1. **P2 · 批量 Action 交叉引用预验证**：同批 Actions 中后续 Action 引用同批将创建的页面时，不应误报"页面不存在"（建立本批次 prospective page set）；
2. **P2 · 排查空 save_wiki 调用**：K1 曾出现一次输入输出均为 null 的空调用；
3. **P2 · prompt 软引导**：更新前先读页面与 index（C、I）、Raw snapshot 已存在时权衡是否另建来源原文页（A）、用户提供原文时传入 source content 以落 snapshot（E）。
