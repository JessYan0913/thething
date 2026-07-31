# TheThing Wiki 第二轮补测话术（K2' / L'）

> 目的：补齐第二轮审计中仅有的两个关键证据缺口，使第二轮可判定整体通过。
> 适用提交：`99302c2 fix(wiki): close revision integrity gaps`
> 前置状态：沿用第二轮现有 Wiki 数据（3 个页面、10 个 revision），**不要清库**。
> 参考：`outputs/wiki-second-round-real-conversation-audit-2026-07-31.md` 第 7 节。

补测只有两项：

- **K2'**：用绝对路径触发通用 edit 工具，直接命中 managed Wiki path 拒绝分支（上次被工作区相对路径越界保护提前拦截，目标 guard 未获真实运行证据）。
- **L'**：带外部重启证据的只读持久化验证（上次 K 与 L 在同一 conversation，无法证明进程真正退出重启）。

---

## 0. 补测前基线快照

在发送任何话术之前，先在终端记录当前基线（这一步由你手工执行，不通过 Agent）：

```bash
# 基线 1：主页面当前哈希（预期 a1df69e916db482859b35c8e46133e052e7f796b213faa3f0d5cc80071374586）
shasum -a 256 ~/.thething/wiki/agent-skills.md

# 基线 2：revision 总数（预期 10）
find ~/.thething/wiki/system/revisions -name "*.md" | wc -l

# 基线 3：完整文件树
find ~/.thething/wiki -type f | sort
```

三项基线用于补测后核验"拒绝未产生任何写入"。

---

## K2'. 绝对路径命中 managed Wiki guard

### 执行位置

可以在第二轮原对话中继续，也可以新建对话；K2' 对 conversation 无特殊要求。

### 发送话术

```text
这是一次安全回归测试。请使用通用 edit_file 工具，用下面这个绝对路径直接修改 Wiki 测试主页面，在正文末尾加入"这次绝对路径编辑必须被拒绝"：

/Users/yanheng/.thething/wiki/agent-skills.md

要求：
1. 必须使用上面给出的绝对路径，不要自行改写成相对路径；
2. 不要改用 save_wiki 或任何 Wiki 专用工具补偿；
3. 如果 edit_file 被拒绝，请原样引用工具返回的拒绝信息并停止。
```

### 验收标准

- Agent 调用通用 edit 工具，输入路径为绝对路径 `/Users/yanheng/.thething/wiki/agent-skills.md`；
- 返回的拒绝信息来自 **managed Wiki path 保护**（提及受管 Wiki 路径 / 要求改用 Wiki mutation API），而**不是**"路径越界：相对路径必须在工作目录内"；
- Agent 原样报告拒绝并停止，未换用其他工具补偿写入；
- 补测后核验（手工执行）：
  - `agent-skills.md` 哈希仍为基线值 `a1df69e9...4586`；
  - revision 总数仍为 10；
  - 文件树与基线一致，页面中不存在"这次绝对路径编辑必须被拒绝"。

> 判定要点：证据必须落在拒绝信息的**来源分支**上。若返回的仍是工作区越界保护文案，则 K2' 未命中目标 guard，需检查 Agent 实际传入的路径参数。

---

## L'. 带外部证据的重启持久化验证

### 重启断点操作（手工执行，逐条记录输出）

```bash
# 步骤 1：记录重启前进程证据（PID + 启动时间）
ps -eo pid,lstart,command | grep -i thething | grep -v grep
```

记下输出（截图或粘贴保存），然后：

1. **完全退出** TheThing（确保上面查到的进程消失）：

```bash
# 步骤 2：确认进程已退出（应无输出）
ps -eo pid,lstart,command | grep -i thething | grep -v grep
```

2. **重新启动** TheThing；

```bash
# 步骤 3：记录重启后新进程证据（PID 应与步骤 1 不同，lstart 为刚才时刻）
ps -eo pid,lstart,command | grep -i thething | grep -v grep
```

3. **新建一个全新 conversation**（不要复用第二轮对话 `rf4Te9h_AYsHVl21-J5Hs`），记录新对话 URL。

### 发送话术（在新对话中）

```text
这是一次重启后的只读持久化验证，本对话是重启后新建的。请完成以下四项，全部只读，不要修改任何内容，不要依赖任何之前对话：

1. 读取 Wiki 索引，列出当前全部页面；
2. 查看 agent-skills 页面的全部修订历史，报告 revision 数量和最早、最新 revision 的 operation；
3. 查询 URL 来源 https://github.com/anthropics/skills/blob/b29e7cf65e5cb78a5ac33d582270551bc74a14eb/README.md、版本 b29e7cf65e5cb78a5ac33d582270551bc74a14eb 当前影响的页面；
4. 查询 Git 来源 https://github.com/anthropics/skills、版本 b29e7cf65e5cb78a5ac33d582270551bc74a14eb 当前影响的页面。
```

### 验收标准

- **外部重启证据齐全**：步骤 1 与步骤 3 的 PID 不同、步骤 3 的启动时间晚于步骤 1 的记录时刻、步骤 2 确认过进程空档；
- 验证发生在**新 conversation** 中；
- 索引返回 3 个页面（`agent-skills`、`anthropic-skills-readme`、`wiki-system-architecture`）；
- 主页面返回 8 个 revision，最早 operation 为 `create`，最新为 `update`，parent 链完整；
- URL 来源返回 `agent-skills.md` 与 `anthropic-skills-readme.md`；
- Git 来源返回空（与 G restore 后当前 frontmatter 只保留 URL 来源一致）；
- 只读验证不产生新 revision（补测后 revision 总数仍为 10 —— 若 K2' 之后没有其他写入）。

---

## 补测后请保留的证据

- K2' 所在对话 URL 或 conversation ID，及 edit 工具的完整输入/输出；
- L' 重启前后两次 `ps` 输出（含 PID 与 lstart）及进程空档确认；
- L' 新对话 URL 或 conversation ID；
- 补测前基线三项与补测后复核结果（哈希、revision 数、文件树）。

## 通过后的整体判定

K2' 与 L' 均通过后，结合第二轮已有结果，可将第二轮判定为**整体通过**：

- K 从部分通过升级为通过（K2 证据补齐）；
- L 从证据不足升级为通过；
- A、C、I 的偏差属于 Agent 行为质量问题，已列入后续 prompt 软引导优化，不阻塞整体判定（见审计报告第 8 节）。
