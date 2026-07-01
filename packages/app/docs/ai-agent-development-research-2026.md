# AI Agent 最新发展调研报告（截至 2026 年 7 月）

> **摘要**：本报告系统梳理了 AI Agent 领域在 2025–2026 年的最新发展，涵盖平台与产品的重大发布、核心技术演进、框架生态格局、行业应用现状及未来趋势，旨在为技术决策和产品规划提供参考。

---

## 目录

1. [总体概览：Agent 生态进入平台之争](#1-总体概览agent-生态进入平台之争)
2. [平台与产品：四大玩家的战略布局](#2-平台与产品四大玩家的战略布局)
3. [核心技术演进](#3-核心技术演进)
4. [框架生态格局](#4-框架生态格局)
5. [行业应用与采用现状](#5-行业应用与采用现状)
6. [Agentic AI 光谱与架构模式](#6-agentic-ai-光谱与架构模式)
7. [基础设施与部署](#7-基础设施与部署)
8. [趋势总结与展望](#8-趋势总结与展望)

---

## 1. 总体概览：Agent 生态进入平台之争

2025–2026 年是 AI Agent 从实验性研究转向**平台化竞争**的关键时期。主要标志包括：

| 维度 | 关键变化 |
|------|----------|
| **平台化** | 每个主要 AI 厂商都推出了生产级 Agent SDK/框架 |
| **标准化** | MCP（Model Context Protocol）成为事实上的工具集成标准，A2A 协议处理 Agent 间通信 |
| **治理化** | Linux 基金会成立 **Agentic AI Foundation（AAIF）**，协调开放生态治理 |
| **务实的 ROI 认知** | 尽管投资热潮不减，但《华尔街日报》等媒体指出"很少有企业实现了 AI Agent 的投资回报" |
| **编码 Agent 最成熟** | 软件开发被广泛认为是 Agent 技术最确定的应用场景 |

---

## 2. 平台与产品：四大玩家的战略布局

### 2.1 OpenAI — Responses API + Agents SDK

| 项目 | 状态 |
|------|------|
| **Responses API** | 2025 年 3 月 11 日发布，取代旧的 Assistants API |
| **Agents SDK**（`openai-agents-python`） | 27.6K GitHub Stars, 104 个 Release（v0.17.7），Swarm 的生产级升级版 |
| **MCP 支持** | 2025 年 3 月采用 MCP，9 月扩展至 ChatGPT 第三方集成 |
| **GPT-5.5** | 最新模型参考，Agent SDK 文档已有参考 |

**Agents SDK 核心设计**：
- **轻量级原语**：Agents（智能体）、Handoffs（移交）、Guardrails（护栏）
- **Handoffs（移交）**：Agent 可以将执行委托给另一个 Agent，像调用工具一样灵活
- **Sandbox Agents**（v0.14.0+）：在隔离容器中运行 Agent，支持可恢复会话
- **Sessions**：持久化记忆层（支持 SQLAlchemy, Redis, MongoDB, Dapr）
- **Provider-agnostic**：支持 100+ 其他 LLM（通过 Any-LLM 和 LiteLLM 适配器）
- **Realtime Agents**：语音 Agent，支持 gpt-realtime-2，自动打断检测

**定位**：适用于想要运行时管理轮次、工具执行、护栏和会话的开发者。

### 2.2 Anthropic — Claude 的 Agentic 进化

| 里程碑 | 时间 | 影响 |
|--------|------|------|
| Claude 3.5 Sonnet | 2024.06 | Agentic 编码评测 64%（vs Claude 3 Opus 38%）|
| **Computer Use** | 2024.10 | 通过屏幕截图 + 鼠标/键盘操纵计算机 |
| **MCP 协议** | 2024.11.25 | 开源标准，被称为"AI 的 USB-C 接口" |
| Claude Code | 2025 | **135K GitHub Stars**，最受欢迎的 Agentic 编码工具 |
| **Sonnet 5** | 2026.06.30 | "最 Agentic 的 Sonnet 模型"，接近 Opus 4.8 性能但价格更低 |

**Anthropic 的差异化策略**：
- 不在框架层竞争，而是将 Agentic 能力**内建到模型层**
- **服务端工具**：Web Search、Web Fetch、Code Execution、Advisor、Tool Search
- **客户端工具**：Bash、Text Editor、Computer Use、Memory
- **MCP Connector**：直接在 Messages API 中嵌入 MCP 连接
- 更强调"模型即平台"，减少框架层开销但有锁定风险

**Sonnet 5 定价**：$3/MTok 输入，$15/MTok 输出（Intro 定价 $2/$10，截至 2026 年 8 月 31 日）

### 2.3 Google — Gemini Agents + ADK

| 产品 | 说明 |
|------|------|
| **Antigravity Agent** | 托管在 Google Linux 沙箱中的托管 Agent，支持 Gemini 3.5 Flash |
| **Deep Research Agent** | 自主多步研究合成 Agent |
| **ADK（Agent Development Kit）** | 开源框架（Python/TypeScript/Go/Java/Kotlin），**ADK 2.0** 支持图工作流和协作 Agent |
| **A2A 协议**（Agent-to-Agent）| 2025 年 4 月开源，v1.0.0 生产就绪，50+ 启动合作伙伴 |
| **Gemini Spark** | 面向消费者的 Agent 产品 |
| **GenAI.mil** | 2025 年 12 月为美国国防部推出的平台 |

**A2A 协议 vs MCP 的关系**：
- **MCP**（Model Context Protocol）：垂直方向——模型 ↔ 工具的集成
- **A2A**（Agent-to-Agent）：水平方向——Agent ↔ Agent 的通信
- Google 明确表示两者是互补关系

### 2.4 其他值得关注的平台

| 平台 | 关键信息 |
|------|----------|
| **Salesforce Agentforce** | v2.0（2025 年 9 月），完整企业 Agent 平台，被 IRS、英国警方等政府机构采用 |
| **Microsoft** | Windows 11 Agent（2025 年 11 月测试版），Azure AI Agent 服务 |
| **ByteDance Doubao** | 集成到 ZTE 手机操作系统，但因隐私安全顾虑被微信/支付宝等拦截 |

---

## 3. 核心技术演进

### 3.1 MCP（Model Context Protocol）— 事实标准的确立

| 指标 | 数据 |
|------|------|
| 发布时间 | 2024 年 11 月 25 日（Anthropic） |
| 当前规范版本 | `2025-06-18`（日期版本） |
| 治理 | 已捐献给 Linux 基金会（AAIF） |
| **GitHub 组织关注者** | **48,500** |
| 官方 SDK | 10 个（Python, TS, Java, Kotlin, C#, Go, PHP, Ruby, Rust, Swift） |

**核心架构**：
- **JSON-RPC 2.0** 协议，支持 Stdio（本地）和 Streamable HTTP（远程）
- **三个服务端原语**：Tools（LLM 调用的函数）、Resources（只读数据源）、Prompts（可复用模板）
- **三个客户端原语**：Sampling（请求 LLM 补全）、Elicitation（请求用户输入）、Roots（文件系统边界）

**生态里程碑**：
- 2025 年 3 月：OpenAI 采用 MCP
- 2025 年 4 月：Google 采用 MCP
- 2025 年 12 月：MCP 捐给 AAIF
- 2026 年 4 月：MCP Dev Summit（纽约，约 1,200 人参加）
- **MCP Apps** 扩展（2026 年 1 月）：MCP 服务端可向 Host 传递交互式 UI

> MCP 已经像当年 LSP（Language Server Protocol）标准化 IDE 集成一样，成为 AI 工具集成的通用标准。

### 3.2 A2A（Agent-to-Agent）协议

| 指标 | 数据 |
|------|------|
| 发布 | 2025 年 4 月 9 日（Google Cloud） |
| 当前版本 | **1.0.0**（生产就绪） |
| 设计原则 | 基于 HTTP/SSE/JSON-RPC，安全优先（OAuth2、mTLS、OpenID Connect） |
| 核心概念 | Agent Card（能力发现文档）、Task 生命周期（分钟到天级）、Artifacts（输出结果） |
| 启动伙伴 | 50+，包括 Atlassian、PayPal、Salesforce、SAP、LangChain 等 |

### 3.3 函数调用 / Tool Use 的趋同

- **JSON Schema** 已成为通用的工具定义格式
- **MCP** 正在成为跨厂商的工具连接通用传输层
- **Tool Search/Discovery**：当应用拥有数千个工具时的按需加载模式（OpenAI gpt-5.4+ 支持）
- **严格模式**（`strict: true`）：所有大厂都支持强制 Schema 一致

### 3.4 Agent 记忆与状态管理

记忆仍然是 Agent 领域**最碎片化、最具挑战**的问题：

| 方案 | 代表 | 模式 |
|------|------|------|
| **Blocks 模式** | Letta（23.6K Stars） | 结构化标签化上下文块（如"human"、"persona"） |
| **Checkpoint 模式** | LangGraph | 状态快照 + 回放能力，支持短周期记忆 |
| **Session 模式** | OpenAI Agents SDK | 持久化键值状态，支持 Redis/MongoDB/PostgreSQL |
| **Tool 模式** | Anthropic Claude | 将记忆作为模型明确调用的工具 |
| **Agent File (.af)** | Letta | 序列化有状态 Agent 的开放文件格式（2025 年 4 月） |

Letta 的核心理念：**"RAG 不等于 Agent 记忆"**——RAG 提供检索，但真正的 Agent 记忆需要持久、自管理的状态。

### 3.5 Agent 评估与可观测性

Agent 评估已从特设手动测试发展为**系统化、自动化、CI/CD 集成的流程**：

| 工具 | 关键数据 | 特色 |
|------|----------|------|
| **DeepEval / Confident AI** | 150K+ 开发者，>50% 财富 500 强，1 亿+ 日评估量 | Pytest 原生、"LLM 的单元测试"范式 |
| **LangSmith** | 6,000+ 客户，5/10 世界 500 强 | 全栈平台：可观测 + 评估 + 部署 |
| **Braintrust** | 活跃 | 评估优先：Playground → 实验 → CI/CD → 生产监控 |
| **Letta Evals** | 2025 年 10 月发布 | 专为有状态 Agent 设计 |

**关键趋势**：评估范式正从"一次评测"转向**持续的生产级评估**（Online Evaluations），对生产 trace 进行实时打分。

---

## 4. 框架生态格局

### 4.1 市场全景

| 框架 | GitHub Stars | 状态 | 定位 |
|------|-------------|------|------|
| **LangChain** | **141K** | 活跃 | 高层面快速原型，283K 项目依赖 |
| **LangGraph** | **36.2K** | 活跃 v1.0 | 低层面有状态编排，Uber/Klarna/LinkedIn 生产使用 |
| **CrewAI** | **54.7K** | 活跃 v1.15.1 | 角色化多 Agent 协作，10 万+认证开发者 |
| **AutoGen** | **59.4K**（遗产） | **维护模式** | ⚠️ 已弃用，迁移至 MAF |
| **MS Agent Framework** | **11.8K** | 活跃 v1.0 | AutoGen 生产级后继，.NET + Python |
| **OpenAI Agents SDK** | **27.6K** | 活跃 | 轻量生产级 SDK，104 个 Release |
| **Dify** | **147K** | 活跃 v1.15.0 | 低代码 Agent 平台，最受 star 的平台 |
| **Letta** | **23.6K** | 活跃 | 记忆优先的有状态 Agent |

### 4.2 各框架深度对比

#### LangChain / LangGraph / LangSmith（LangChain 生态系统）

```
LangChain (高层面) → LangGraph (低层面编排) → LangSmith (商业平台)
```

- **LangChain**：快速原型，模型互操作性，广泛集成
- **LangGraph**：图状态管理、Checkpointers（短期记忆）+ Stores（长期记忆）、人机协作
- **LangSmith**：全栈平台（可观测 + 评估 + 部署 + 自动故障检测）
- **Deep Agents**：LangGraph 上的新高层包，面向自主长期运行 Agent
- **LangSmith Engine**（NEW）：自动发现生产故障，在 Trace 和代码中定位根本原因
- **LangSmith Fleet**（NEW）：面向全公司的无代码 Agent

**企业案例**：
- Klarna：案件解决时间减少 80%
- C.H. Robinson：每日 5,500 订单自动化，节省 600+ 工时/天
- Monday Service：评估反馈循环加速 8.7 倍

#### OpenAI Agents SDK（轻量级）

```
核心原语：Agents + Handoffs + Guardrails + Sessions + Sandbox Agents
定位：比直接使用 Responses API 更丰富的运行时管理
```

**最佳场景**：快速构建生产级 Agent，OpenAI 生态优先但支持多模型。

#### CrewAI（多 Agent 协作）

```
两层架构：Crews（高层角色化自主协作）+ Flows（底层事件驱动工作流）
YAML 配置 Agent 和任务（非开发者也可使用）
```

**最佳场景**：需要多个角色化 Agent 协同工作的场景，快速原型到生产。

#### Anthropic Claude Tool Use（模型即平台）

- 不提供独立 SDK/框架，能力内建在 API 层
- 最全面的内置工具集（Web Search, Code Execution, Computer Use 等）
- MCP Connector 直接在 Messages API 中

#### Microsoft Agent Framework（MAF v1.0）

- AutoGen 的生产级后继（AutoGen 已进入维护模式）
- 图编排 + 持久化执行 + OpenTelemetry 可观测
- 支持 A2A 和 MCP 协议
- 2 行额外代码即可部署到 Foundry

### 4.3 竞争格局总结

| 框架 | 最擅长的场景 | 弱点 |
|------|------------|------|
| **LangChain+LangGraph+LangSmith** | 企业生产 Agent，全生命周期 | 复杂度高，LangSmith 厂商锁定风险 |
| **OpenAI Agents SDK** | 快速启动，OpenAI 生态 | 较年轻，生产验证不如 LangChain 广泛 |
| **CrewAI** | 角色化多 Agent 协作，快速原型 | 企业基础设施深度不足 |
| **Anthropic Claude** | 最优秀的 Tool Use 和计算机自动化 | 仅限 Anthropic 模型 |
| **MS Agent Framework** | .NET/Python 企业，Azure 生态 | 新框架，社区规模较小 |
| **Dify** | 低代码构建内部工具 | 复杂逻辑灵活性有限 |

---

## 5. 行业应用与采用现状

### 5.1 主要应用场景（按成熟度排序）

| 场景 | 成熟度 | 代表产品/案例 |
|------|--------|--------------|
| **编码 Agent** | ✅ **最成熟** | Claude Code（135K ⭐）、GitHub Copilot、Cursor、Devin、Codex |
| **客户支持** | ✅ 较成熟 | Salesforce Agentforce、客服 Chatbot |
| **研究 Agent** | ⚡ 快速发展 | OpenAI Deep Research、Google Deep Research Agent |
| **浏览器 Agent** | 🧪 早期 | OpenAI Operator、Google Mariner |
| **业务任务 Agent** | 🧪 早期 | Salesforce Agentforce |
| **自主企业流程** | 🧪 实验性 | 多数企业尚未获得明确 ROI |

### 5.2 政府部署案例

政府机构成为意外的早期采用者：

| 机构 | 平台 | 场景 |
|------|------|------|
| **IRS**（美国国税局）| Salesforce Agentforce | 首席法律顾问、纳税人辩护服务 |
| **DoD**（美国国防部）| Google GenAI.mil | "智能 Agent 工作流" |
| **FDA**（美国食药监局）| N/A | 上市前审查、检查、合规中的 Agent AI |
| **ICE**（美国移民执法局）| N/A | 追逃 |
| **Staffordshire 警察局（英国）** | Salesforce Agentforce | 非紧急 101 电话接听（2026 年起） |

### 5.3 采用现实：ROI 差距

- **AP 美联社（2025 年 4 月）**："很少有 AI Agent 的实际应用"
- **The Information（2025 年 10 月）**："对 AI 能力的期望下降"
- **WSJ 华尔街日报（2025 年 11 月）**："很少有公司从 Agent 部署中获得投资回报"
- **New York Magazine（2025 年 8 月）**：软件开发 = "AI Agent 最确定的应用"

**结论**：Demo 能力与生产可靠性之间的差距仍然显著。编码助手价值最清晰，而更广泛的自主 Agent 仍处于实验阶段。

---

## 6. Agentic AI 光谱与架构模式

### 6.1 Agentic 光谱（Harrison Chase / LangChain）

借鉴 Andrew Ng 的观点，Agentic 是一个光谱而不是二分类：

```
低 Agentic ←------------------------------------------------→ 高 Agentic
     Router → State Machine → Autonomous Agent
```

- **Router**：LLM 将输入路由到不同下游工作流
- **State Machine**：多步 LLM 路由 + 循环执行直到完成
- **Autonomous Agent**：构建工具、记忆并在未来步骤中使用

**核心衡量标准**：LLM 决定系统行为的程度越高，就越 Agentic。

### 6.2 编排模式

| 模式 | 说明 | 代表 |
|------|------|------|
| **Handoff/Delegation** | Agent 委托给专业 Agent | OpenAI Agents SDK |
| **Manager-Orchestrator** | 监督 Agent 协调专业 Agent | LangGraph |
| **Hierarchical** | 嵌套 Agent 结构 | LangGraph subgraphs |
| **Sequential/Pipeline** | Agent 按定义顺序执行 | CrewAI Flows |
| **Collaborative/Role-Based** | 角色化协 Autonomous 协作 | CrewAI Crews |

### 6.3 Agent 架构参考层（Ken Huang 的 7 层模型）

```
Foundation Models
    ↓
Data Operations
    ↓
Agent Frameworks
    ↓
Deployment / Infrastructure
    ↓
Evaluation / Observability
    ↓
Security / Compliance
    ↓
Agent Ecosystem
```

---

## 7. 基础设施与部署

### 7.1 技术栈分层

```
协议层        MCP（模型↔工具）+ A2A（Agent↔Agent）
编排层        LangGraph / CrewAI / MAF / OpenAI Agents SDK
记忆层        Letta / LangGraph Persistence / Sessions
评估层        DeepEval / LangSmith / Braintrust
可观测层      LangSmith / Arize / OpenTelemetry
部署层        LangSmith Agent Server / Foundry / Docker / K8s
安全层        Sandbox / Guardrails / Prompt Injection 防御
```

### 7.2 核心基础设施趋势

1. **沙箱执行成为标配**：所有主流平台都提供隔离执行环境（LangSmith Sandboxes, OpenAI Sandbox Agents, Anthropic 容器化 Computer Use）
2. **可观测性标准化**：OpenTelemetry 正成为 Agent observability 的通用 API
3. **持久化执行**：Checkpointing、容错、time-travel（回放/回滚）成为生产级 Agent 的必备能力
4. **低代码平台快速增长**：Dify（147K ⭐）和 n8n（195K ⭐）反映大量组织希望以更低门槛使用 Agent 技术

---

## 8. 趋势总结与展望

### 8.1 五大趋势

1. **平台战争全面爆发**：OpenAI、Anthropic、Google、Microsoft 全部推出了 Agent 平台，差异化在于智能（Anthropic）、生态（OpenAI）、基础设施（Google）、企业嵌入（Microsoft）

2. **协议层统一**：MCP 和 A2A 成为互补的双协议标准，获得了所有主要玩家的背书——类似 HTTP/TCP 在互联网中的地位

3. **从"能否工作"到"生产可靠"**：2024 年关注 Demo 能力，2025–2026 年关注持久化执行、可观测性、评估、沙箱安全

4. **记忆仍是最大挑战**：多种模式并存（Blocks / Checkpoints / Sessions / Tools），尚无统一方案，Letta 的"RAG ≠ Memory"论断深刻

5. **编码 Agent 领跑，但企业场景逐渐打开**：软件开发是最确定的场景，企业自动化 ROI 仍待验证但政府采用加速

### 8.2 未来展望

- **Agentic 能力民主化**：Sonnet 5 定价策略表明高端 Agentic 能力正在向中端模型渗透
- **多 Agent 系统由实验走向生产**：Handoff 模式和 A2A 协议为跨 Agent 协作提供标准化基础
- **安全与治理成为焦点**：Prompt Injection 和数据泄露风险（AAIF 已开始关注）
- **开源 vs 商业生态分化**：LangChain/CrewAI 代表开源力量，OpenAI Anhtropic 代表商业平台，MCP/A2A 作为连接层

---

## 附录 A：核心数据速查

| 项目 | 数据 |
|------|------|
| Claude Code GitHub Stars | 135K |
| LangChain GitHub Stars | 141K |
| LangGraph GitHub Stars | 36.2K |
| MCP Servers Repo Stars | 87.9K |
| OpenAI Agents SDK Stars | 27.6K |
| AutoGen Stars（遗产） | 59.4K → 维护模式 |
| CrewAI Stars | 54.7K |
| Dify Stars | 147K |
| Letta Stars | 23.6K |
| MS Agent Framework Stars | 11.8K |
| LangSmith 客户数 | 6,000+ |
| DeepEval 日评估量 | 1亿+ |
| A2A 启动合作伙伴 | 50+ |
| MCP Dev Summit 参加人数 | ~1,200 |

## 附录 B：关键时间线

| 时间 | 事件 |
|------|------|
| 2024.06 | Claude 3.5 Sonnet，Agentic 评测 64% |
| 2024.10 | Anthropic Computer Use 发布 |
| 2024.11.25 | MCP 协议发布 |
| 2025.03.11 | OpenAI Responses API + Agents SDK |
| 2025.03 | OpenAI 采用 MCP |
| 2025.04.09 | Google A2A 协议发布 |
| 2025.04 | Google 采用 MCP |
| 2025.09 | LangChain/LangGraph v1.0 Alpha |
| 2025.09 | Salesforce Agentforce v2.0 |
| 2025.12 | AAIF（Agentic AI Foundation）成立，MCP 捐入 |
| 2025.12 | GenAI.mil（Google × DoD）上线 |
| 2026.01 | MCP Apps 扩展发布 |
| 2026.04 | MCP Dev Summit NYC（1,200 人） |
| 2026.06.30 | Claude Sonnet 5 发布，"最 Agentic 的 Sonnet" |

---

> **文档生成日期**：2026 年 7 月 1 日
> **研究方法**：基于官方文档、GitHub 仓库、公司博客、行业报道的综合性调研
