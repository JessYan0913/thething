# 内置工具与上下文压缩机制适配分析

> 分析日期:2026-07-18
> 分析范围:`packages/core/src/modules/tools/`(read/bash/grep/glob/web-fetch/edit/write/skill/read-wiki-page)、`modules/agent/tools.ts`(工具注册)、与 `modules/compaction/`、`modules/budget/` 的交互
> 前置文档:[context-compaction-analysis.md](./context-compaction-analysis.md)(下称"主文档")

## 结论先行

内置工具本身的输出设计有一个**被低估的优点**:每个工具的结果里都回显了自己的关键输入(read 回显 `path`、bash 回显 `command`、grep 回显 `pattern`、web_fetch 回显 `url`)。这意味着主文档 P0 #1("压缩摘要丢失 args")有一条**比建 toolCallId→input 映射更简单的修法**——extractor 直接从 result 里取回显字段即可。

但当前压缩 extractor 对内置工具**完全没有生效**:注册名(snake_case)和 extractor 键名(首字母大写)不匹配,所有内置工具都在走通用 `defaultExtractor`。这个问题排在主文档 P0 #1 之前——不先修它,修 args 也没有意义。

---

## 一、工具与压缩机制的适配矩阵

| 工具(注册名) | 输出格式 | 回显输入? | 可压缩?(Layer 2) | 专用 extractor 命中? | budget 阈值 | 工具自身截断 |
|---|---|---|---|---|---|---|
| `read_file` | 对象 | ✅ `path` | ✅(小写别名在 DEFAULT_COMPACTABLE) | ❌(键为 `Read`) | 50k chars | 500 行 / 50KB |
| `bash` | 对象 | ✅ `command` | ✅ | ❌(键为 `Bash`) | 100k chars | 200k 硬杀进程 |
| `grep` | **JSON 字符串** | ✅ `pattern` | ✅ | ❌(键为 `Grep`) | 30k chars | 100 条匹配 |
| `glob` | **JSON 字符串** | ✅ `pattern` | ✅ | ❌(键为 `Glob`) | 20k chars | 1000 个文件 |
| `web_fetch` | **JSON 字符串** | ✅ `url` | ✅ | ❌(键为 `WebFetch`) | 20k chars | 50k chars(默认) |
| `edit_file` | 对象(含 diff) | ✅ `path` | ✅ | ❌(键为 `Edit`) | 10k chars | 无 |
| `write_file` | 对象(含 diff) | ✅ `path` | ✅ | ❌(键为 `Write`) | 10k chars | 无 |
| `skill` | text(toModelOutput) | — | ❌ 不在 compactable 列表 | — | default 50k | 无 |
| `read_wiki_page` | 对象(整页内容) | ✅ `name` | ❌ 不在 compactable 列表 | — | default 50k | 无 |
| `agent` / `parallel_agent` | 子 Agent 报告 | — | ❌ 不在 compactable 列表 | — | default 50k | 无 |

---

## 二、疑似 Bug(按严重程度排序)

### 1. Extractor 键名与工具注册名不匹配 — 内置工具的专用 extractor 从未生效(P0,排在主文档 #1 之前)

`agent/tools.ts:42-84` 中工具以 snake_case 注册(`read_file`、`bash`、`grep`…),但 `lifecycle.ts:187-249` 的 `EXTRACTORS` 键是首字母大写(`Read`、`Bash`、`Grep`…)。`extractToolMeta`(`lifecycle.ts:267`)先精确匹配、再去 `mcp_`/`connector_` 前缀匹配——`read_file` 两条路径都不命中,**永远落到 `defaultExtractor`**。

实际压缩效果(`defaultExtractor` 的对象分支只保留 key 名):

- `read_file` → `read_file: {path, content, totalLines, startLine, ...} [N chars]`(**路径值丢失**)
- `bash` → `bash: {stdout, stderr, exitCode, command, ...} [N chars]`(**命令值丢失**)
- `grep`/`glob`/`web_fetch` 返回的是 JSON 字符串 → 走字符串分支,保留前 80 + 后 80 字符——碰巧因为 JSON 开头是 `{"pattern": ...` / `{"success":true,"url":...` 而**偶然**保住了 pattern/url,纯属运气。

注意:可压缩性判断没问题(`DEFAULT_COMPACTABLE` 同时含大小写两套名字,`types.ts:43-60`),坏的只是 meta 提取这一层。

**修法**:统一 EXTRACTORS 键为实际注册名(snake_case),或在 `extractToolMeta` 里加一层名字归一化(`read_file → Read`)。**必须先修这个,主文档 P0 #1 的 args 修复才有意义。**

### 2. 即使修复命名,extractor 与工具的实际输出/输入格式仍不匹配(P0,与主文档 #1 合并修)

三处格式错位,任何一处都会让 extractor 输出空值:

1. **args 字段名**:extractor 找 `args.file_path ?? args.path`(`lifecycle.ts:192`),但内置工具的输入 schema 是 camelCase `filePath`(`read.ts:216`、`edit.ts:21`)。即使按主文档建议把 args 传进来,还是取不到。
2. **字符串 vs 对象**:`grep`/`glob`/`web_fetch` 返回 `JSON.stringify(...)` 字符串(`grep.ts:305`、`glob.ts:57`、`web-fetch.ts:123`),而 Grep extractor 期望 `result.matches` 是数组(`lifecycle.ts:207`)→ 恒得 `0 matches`。
3. **利用输入回显,可以完全绕开 args**:内置工具的结果自带输入回显——`read_file` 有 `result.path`,`bash` 有 `result.command`,`grep` JSON 里有 `pattern`,`web_fetch` 有 `url`。extractor 改为**优先从 result 取回显字段、args 作为 fallback**,主文档 #1 的"建 toolCallId→input 映射"就从必选变为可选,实现成本大幅降低。

**建议修法**(一次性解决 #1、#2 和主文档 #1):
- EXTRACTORS 键改为注册名;
- extractor 内部先 `typeof result === 'string' && result.startsWith('{')` 则 `JSON.parse`;
- 字段提取顺序:result 回显字段 → camelCase args → snake_case args。

### 3. `web_fetch` 与 budget 阈值倒挂 + `originalLength` 恒等于截断后长度(P1)

- 工具自身默认截断阈值 50k chars(`web-fetch.ts:80`),但 budget 模块对 `web_fetch` 的持久化阈值是 20k(`tool-output-manager.ts:136-138`)。结果:抓一个正常网页,工具截到 50k → budget 立刻判超、写盘、上下文里只剩 2k 预览。**中间这 30k 既进过一次上下文又被扔掉,还丢了 20k-50k 之间本可保留的内容**。两者应对齐(工具默认降到 ≤20k,或提高 budget 阈值)。
- `web-fetch.ts:118-130`:先 `content = content.slice(0, maxLength)` 再 `originalLength: content.length` —— **originalLength 恒等于截断后的长度**,模型无法判断损失了多少内容。应在截断前记录。

### 4. `bash` 200k 硬杀进程 vs budget 100k 持久化——中间地带行为不一致(P1)

`bash.ts:15` 的 `BASH_MAX_BUFFER = 200_000`:输出超过 200k 时**直接 SIGTERM 杀掉进程**(`bash.ts:245-252`),命令执行失败、输出不完整。而 budget 对 bash 的处理是 100k 以上持久化到磁盘、保留预览。也就是说:

- 100k–200k 输出:正常完成,写盘,可找回 ✅
- \>200k 输出:进程被杀,任务失败,部分输出 ❌

这与主文档 B("压缩应是分层存储而非有损丢弃")的方向矛盾。**建议**:超过 buffer 后改为把后续输出直接管道到磁盘文件(复用 `tool-result-storage`),进程跑完,返回预览 + 文件路径——和 background 模式的 logFile 机制(`bash.ts:185-210`)是同一套思路,代码可以合并。

### 5. `skill`、`read_wiki_page`、`agent` 输出不受任何生命周期管理(P1)

三类大输出工具既不在 `DEFAULT_COMPACTABLE`、也不在 `protectedTools`(默认空,`types.ts:14`),Layer 2 对它们是 no-op:

- **`skill`**:一次调用注入完整技能 body + 目录树(实测常见 5k-50k chars),任务结束后这坨指令**永远留在上下文里**。跨多个任务的长会话中,几次 skill 调用就能吃掉几万 token。技能指令在执行期间必须保留、执行完后价值急剧下降——是最典型的"应按 step 老化"的输出(主文档 A)。
- **`read_wiki_page`**:返回整页 wiki 内容,与 `read_file` 性质完全相同,却享受永不压缩的待遇。应加入 compactable 列表,extractor 输出 `ReadWiki '<pageName>' → N chars`。
- **`agent`/`parallel_agent`**:子 Agent 的最终报告可能很大,同样不老化。子 Agent 报告通常是"结论",压缩需谨慎,但至少超大报告应走持久化路径。

**建议**:`skill` 和 `read_wiki_page` 加入 compactable(skill 需要"当前任务结束后才压缩"的语义——可先用较大的 keepRecentTurns 兜底);agent 报告纳入 budget 持久化。

---

## 三、Token 效率优化(非 bug,但收益直接)

### A. 对象结果经 JSON 序列化的转义开销 —— `read_file` 是重灾区

`read_file` 返回对象,AI SDK 会以 JSON(`{type:'json'}`)形式发给 API:代码内容里每个换行变 `\n`、每个引号变 `\"`,再叠加 content 字段本身已含的行号前缀和 code fence。对代码文件,这层转义带来 **5%-15% 的纯浪费 token**,且每次 read 都在付。

`skill` 工具已经示范了正确做法:用 `toModelOutput` 把结果转成 text 输出(`skill.ts:194-205`)。`read_file`/`bash` 应同样提供 `toModelOutput`,把 content/stdout 以纯文本形式发送,结构化字段留给 UI 渲染层。

### B. `grep`/`glob` 的 pretty-print JSON + 重复键名

`grep.ts:305` / `glob.ts:57` 用 `JSON.stringify(result, null, 2)`:2 空格缩进 + 每条 match 重复 `"file"/"line"/"content"` 键 + 每条都是**绝对路径全量重复**。100 条匹配的输出里,真正的信息(路径+行号+内容)可能不到一半。

grep 其实已有紧凑格式:`formatMatches` 的 `file:line: content` 文本(`grep.ts:235`),但只在传 `context` 参数时启用。**建议**:默认就用文本格式输出匹配列表(相同目录的文件可再按文件分组去重路径前缀),JSON 只留元信息字段。

### C. `glob` 默认 limit 1000 过大

1000 个文件路径 ≈ 30-50k chars,一次就打到 budget 阈值(20k)触发写盘。参考 Claude Code 的默认 100。模型极少需要一次看 1000 个路径——需要的话可以分页。**建议默认 limit 降到 100-200**。

### D. `grep` 无 per-file 上限

单个文件命中几十次时(如搜一个常用符号),100 条 limit 全被一个文件吃掉。建议默认每文件最多 5-10 条 + `N more matches in this file` 提示,总量分给更多文件——这对"定位代码在哪"的主要用例是纯收益。

---

## 四、与主文档优化方向的联动

| 主文档条目 | 工具侧的配合动作 |
|---|---|
| P0 #1(extractToolMeta args=null) | **先修本文档 #1(键名),再按 #2 用 result 回显字段替代 args 映射**——比建映射简单 |
| B(Layer 2 压缩落盘可恢复) | bash 超 buffer 改为落盘(本文档 #4);工具已有 `tool-result-storage` 可直接复用 |
| C1(错误结果不压缩) | bash 的 `error:true` / 非零 exitCode、web_fetch 的 `success:false` 结果都有明确标记,Layer 2 判断时直接读这些字段即可,工具侧无需改动 |
| C2(同文件重复读取去重) | `read_file` 结果自带 `path` 字段,去重逻辑可直接用它,无需 args |
| A(老化维度改 step 计数) | skill 输出是最需要 step 老化的案例(本文档 #5),可作为该项改造的验收用例 |

---

## 五、优先级建议

| 优先级 | 事项 | 类型 | 工作量 |
|---|---|---|---|
| P0 | 修 EXTRACTORS 键名不匹配(#1)+ extractor 改用 result 回显字段、兼容 JSON 字符串结果(#2) | bug | 小 |
| P1 | `web_fetch` 阈值对齐 + originalLength 修复(#3) | bug | 小 |
| P1 | `skill`/`read_wiki_page` 纳入生命周期管理(#5) | 遗漏 | 小 |
| P1 | `bash` 超 buffer 从杀进程改为落盘(#4) | 架构 | 中 |
| P2 | `grep`/`glob` 默认文本格式 + glob limit 降为 100-200 + grep per-file 上限(B/C/D) | token 效率 | 小 |
| P2 | `read_file`/`bash` 加 `toModelOutput` 纯文本输出(A) | token 效率 | 小 |
| P3 | `agent` 报告纳入 budget 持久化(#5) | 架构 | 中 |

**总体判断**:内置工具的输出设计(输入回显、结构化截断提示、budget 分级阈值)底子不错,但和压缩层之间存在一条从未被测试覆盖的断层——**名字对不上、格式对不上**,导致压缩层为内置工具专门写的 extractor 一行都没跑过。P0 两项修完(预计改动集中在 `lifecycle.ts` 一个文件),主文档的 P0 #1 也同时解决;P1 三项完成后,工具层与压缩层才真正形成主文档设想的"分层存储"闭环。
