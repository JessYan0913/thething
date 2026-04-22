// ============================================================
// Extensions Layer - 扩展层
// ============================================================
// 提供可插拔的扩展功能：
// - mcp: MCP 协议支持
// - connector: Connector Gateway（外部工具连接）
// - skills: 技能系统
// - subagents: 子代理系统
// - memory: 记忆系统
// - permissions: 权限管理
// - system-prompt: 系统提示构建
// ============================================================

export * from './mcp';
export * from './connector';
export * from './skills';
export * from './subagents';
export * from './memory';
export * from './permissions';
export * from './system-prompt';