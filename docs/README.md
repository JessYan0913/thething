# TheThing 技术文档索引

## 核心架构

### 上下文管理
- [context-compaction-architecture.md](./context-compaction-architecture.md) - 上下文压缩机制完整架构（四层保证 + 后台 Checkpoint）

## 功能设计

### Agent 系统
- [sub-agent-optimization.md](./sub-agent-optimization.md) - 子 Agent 优化设计
- [session-source-and-system-prompt.md](./session-source-and-system-prompt.md) - 会话来源与系统提示词

### 知识管理
- [memory-system-design.md](./memory-system-design.md) - 记忆系统设计
- [llm-wiki.md](./llm-wiki.md) - LLM Wiki 功能
- [wiki-redesign.md](./wiki-redesign.md) - Wiki 重设计

### 工具与集成
- [chat-tool-mcp-chain-issues.md](./chat-tool-mcp-chain-issues.md) - MCP 链路问题分析

## UX 设计
- [clickable-file-path-design.md](./clickable-file-path-design.md) - 可点击文件路径设计

## 竞品分析
- [pi-comparison.md](./pi-comparison.md) - Pi 产品对比分析

---

## 文档维护原则

1. **已实施功能删除设计文档** - 设计文档仅保留到功能落地，落地后删除或改写为架构文档
2. **架构文档持续更新** - 反映当前实际实现，标注最后更新日期
3. **过时内容立即删除** - 避免误导，保持文档与代码同步

最后更新：2026-07-23
