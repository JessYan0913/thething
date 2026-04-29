// ============================================================
// @the-thing/core — 使用指南
// ============================================================
//
// 本包提供三层 API：
//
// 1. 高层 API（推荐）— 直接 import
//    - bootstrap()      显式初始化基础设施，返回 CoreRuntime
//    - createContext()  加载所有配置（skills、mcp、connector 等）
//    - createAgent()    创建 Agent，消费 AppContext
//
//    示例（新 API）：
//    ```typescript
//    import { bootstrap, createContext, createAgent } from '@the-thing/core';
//
//    // 三步，每步的输入输出关系一目了然
//    const runtime = await bootstrap({ dataDir: './data' });
//    const context = await createContext({ runtime, cwd: process.cwd() });
//    const { agent, adjustedMessages } = await createAgent({
//      context,
//      conversationId: 'conv-1',
//      messages,
//      model: {
//        apiKey: process.env.API_KEY!,
//        baseURL: process.env.BASE_URL!,
//        modelName: 'qwen-max',
//      },
//    });
//    ```
//
// 2. 中层 API — import from '@the-thing/core/api'
//    - loadAll()        并行加载所有模块
//    - loadSkills()     单独加载 Skills
//    - loadMcpServers() 单独加载 MCP 服务器
//    - loadConnectors() 单独加载 Connector
//
//    示例：
//    ```typescript
//    import { loadSkills } from '@the-thing/core/api';
//    const skills = await loadSkills({ cwd: '/path/to/project' });
//    ```
//
// 3. 底层 API — import from '@the-thing/core/foundation'
//    - parser/          文件解析（Frontmatter、YAML、JSON）
//    - scanner/         目录扫描
//    - paths/           路径计算（纯函数 + 便捷版本）
//    - datastore/       数据存储
//    - model/           模型提供者和能力配置
//
//    示例：
//    ```typescript
//    import { parseFrontmatterFile } from '@the-thing/core/foundation/parser';
//    const result = parseFrontmatterFile('/path/to/file.md');
//    ```
//
// ============================================================

// ============================================================
// 高层 API（推荐入口）
// ============================================================
export { bootstrap, type CoreRuntime, type BootstrapOptions } from './bootstrap';
export { createAgent, createContext } from './api/app';
export type {
  AppContext,
  CreateAgentOptions,
  CreateAgentResult,
  CreateContextOptions,
  ModelConfig,
  ReloadOptions,
  LoadEvent,
  LoadSourceInfo,
  LoadError,
} from './api/app/types';
export { type ConnectorRegistry } from './extensions/connector';

// ============================================================
// 配置（常量和类型）
// ============================================================
export * from './config';

// ============================================================
// 分层导出（供高级用户）
// ============================================================

// 基础设施层
export * from './foundation';

// 运行时层
export * from './runtime';

// 扩展层
export * from './extensions';

// API 层
export * from './api';

// ============================================================
// Native 模块加载（SEA 支持）
// ============================================================
export { loadBetterSqlite3, getDatabase } from './foundation/datastore/sqlite/native-loader';
export type {
  SqliteDatabase,
  SqliteDatabaseConstructor,
  SqliteDatabaseOptions,
  SqliteStatement,
} from './foundation/datastore/types';