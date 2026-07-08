import path from 'path';
import os from 'os';
import { promises as fs } from 'fs';
import { bootstrap, createContext, resolveProjectLayout, configureConnectorInboundRuntime, loadGlobalConfig, type CoreRuntime, type AppContext, type GlobalConfig } from '@the-thing/core';
import { startAllFeishuLongConnections, stopAllFeishuLongConnections } from './feishu-long-connection';

let runtime: CoreRuntime | null = null;
let context: AppContext | null = null;
let initPromise: Promise<CoreRuntime> | null = null;

/**
 * MCP 连接就绪的 Promise。
 * 由 initializeRuntime() 设置，在 connectAll() 完成后 resolve。
 * MCP API 路由等待此 Promise 以确保返回准确的连接状态。
 */
let mcpReadyPromise: Promise<void> | null = null;
let mcpReadyResolve: (() => void) | null = null;

/** 启动时缓存的全局配置，供 getModelConfig() 使用 */
let cachedGlobalConfig: GlobalConfig | null = null;

// ============================================================
// TheThing RC — ~/.thethingrc
// 固定位置的启动指针文件，回答"运行时数据在哪？"
// 仅用于指向数据目录（默认 ~/.thething），不是产品配置的中心。
// ============================================================

const THETHING_RC_PATH = path.join(os.homedir(), '.thethingrc');

/**
 * 从 ~/.thethingrc 读取运行时数据目录路径。
 * 文件不存在时返回 null，使用默认 ~/.thething/。
 */
export function loadTheThingRC(): { dataDir?: string } | null {
  const _fs = 'fs';
  try {
    const fs = require(_fs) as typeof import('fs');
    if (!fs.existsSync(THETHING_RC_PATH)) return null;
    const content = fs.readFileSync(THETHING_RC_PATH, 'utf-8');
    return JSON.parse(content) as { dataDir?: string };
  } catch {
    return null;
  }
}

/**
 * 保存 ~/.thethingrc，更新数据目录指针。
 */
export async function saveTheThingRC(config: { dataDir?: string }): Promise<void> {
  const _fs2 = 'fs/promises';
  const { default: fs2 } = await import(/* webpackIgnore: true */ _fs2);
  await fs2.writeFile(THETHING_RC_PATH, JSON.stringify(config, null, 2));
}

// ============================================================
// Model Config Helper — 统一读取模型配置，避免各 route 重复加载
// ============================================================

/**
 * 获取当前模型配置。
 * 完全遵循 Dot Agents 协议：仅从 .agents/models.json 读取。
 * 无需环境变量覆盖——配置即文件。
 */
export function getModelConfig(): { apiKey: string; baseURL: string; modelName?: string } {
  return {
    apiKey: cachedGlobalConfig?.apiKey || '',
    baseURL: cachedGlobalConfig?.baseURL || '',
    modelName: cachedGlobalConfig?.modelAliases?.default?.model || undefined,
  };
}

// ============================================================
// Project Context 缓存（按 projectId 缓存 AppContext）
// ============================================================
const projectContextCache: Map<string, AppContext> = new Map();

// ============================================================
// Runtime 初始化
// ============================================================

async function initializeRuntime(): Promise<CoreRuntime> {
  const envSnapshot: Record<string, string | undefined> = { ...process.env };

  // Dot Agents 协议：配置目录固定为 ~/.agents/
  const configDir = path.join(os.homedir(), '.agents');

  // 运行时数据目录（TheThing 产品数据）：
  // 1. ~/.thethingrc 中 dataDir 指针（用户配置）
  // 2. 默认 ~/.thething/
  const thethingRC = loadTheThingRC();
  const runtimeDataBase = thethingRC?.dataDir
    ? thethingRC.dataDir.replace(/^~/, os.homedir())
    : path.join(os.homedir(), '.thething');

  // 从 .agents/models.json 读取协议配置
  let bootConfig = loadGlobalConfig(configDir);

  // 迁移兼容：如果 .agents/models.json 不存在，尝试旧的 .thething/config.json
  if (!bootConfig) {
    const legacyPath = path.join(os.homedir(), '.thething', 'config.json');
    try {
      const content = await fs.readFile(legacyPath, 'utf-8');
      bootConfig = JSON.parse(content);
    } catch {
      // 旧配置文件不存在，使用默认值
    }
  }

  const globalConfig = loadGlobalConfig(configDir) || bootConfig;
  cachedGlobalConfig = globalConfig;

  runtime = await bootstrap({
    layout: {
      resourceRoot: process.cwd(),
      configDir,
      dataDir: path.join(runtimeDataBase, 'data'),
      resources: {
        connectors: [path.join(runtimeDataBase, 'connectors')],
        permissions: [path.join(runtimeDataBase, 'permissions')],
        wiki: [path.join(runtimeDataBase, 'wiki')],
      },
    },
    connectorConfig: {
      configDir: path.join(runtimeDataBase, 'connectors'),
    },
    behavior: {
      modelAliases: {
        fast: globalConfig?.modelAliases?.fast ?? { model: '' },
        smart: globalConfig?.modelAliases?.smart ?? { model: '' },
        default: globalConfig?.modelAliases?.default ?? { model: '' },
      },
    },
    env: envSnapshot,
    debug: true,
  });

  context = await createContext({ runtime });

  // 后台异步连接所有 MCP 服务，不阻塞启动流程。
  // 连接状态通过 registry.snapshot() 由调用方按需获取。
  // MCP API 路由通过 mcpReadyPromise 等待连接完成。
  if (context.mcpRegistry) {
    mcpReadyPromise = new Promise<void>((resolve) => {
      mcpReadyResolve = resolve;
    });
    context.mcpRegistry.connectAll()
      .then(() => mcpReadyResolve?.())
      .catch(() => mcpReadyResolve?.())  // 即使失败也 resolve，让 API 可以返回错误状态
      .finally(() => {
        mcpReadyPromise = null;
        mcpReadyResolve = null;
      });
  }

  // Wire up connector inbound: bind AI agent handler to Feishu/WeChat webhooks
  configureConnectorInboundRuntime(runtime.connectorRuntime, {
    appContext: context,
    modelConfig: {
      apiKey: globalConfig?.apiKey || '',
      baseURL: globalConfig?.baseURL || '',
      modelName: globalConfig?.modelAliases?.default?.model || '',
    },
  });

  // Start all Feishu WebSocket long connections
  try {
    await startAllFeishuLongConnections(
      runtime.connectorRegistry,
      runtime.connectorRuntime.inbound.gateway
    );
  } catch (err) {
    console.error('[Runtime] Failed to start Feishu long connections:', err);
  }

  // Start cron scheduler
  runtime.cronScheduler?.start();

  return runtime;
}

export async function getServerRuntime(): Promise<CoreRuntime> {
  if (!runtime) {
    if (initPromise) {
      return initPromise;
    }
    initPromise = initializeRuntime();
    try {
      return await initPromise;
    } finally {
      initPromise = null;
    }
  }
  return runtime;
}

/**
 * 获取当前缓存的 AppContext，未初始化时返回 null（不触发初始化）。
 */
export function getServerContextIfReady(): AppContext | null {
  return context;
}

/**
 * 等待 MCP 连接完成。
 * 如果连接已在进行中，返回当前的 Promise；否则立即 resolve。
 * MCP API 路由使用此函数确保返回准确的连接状态。
 */
export async function waitForMcpReady(): Promise<void> {
  if (mcpReadyPromise) {
    await mcpReadyPromise;
  }
}

export async function getServerContext(): Promise<AppContext> {
  if (context) {
    return context;
  }
  const rt = await getServerRuntime();
  context = await createContext({ runtime: rt });
  return context;
}

/**
 * 获取项目特定的 AppContext（带缓存）。
 * 为项目目录创建独立的 layout，加载该目录下的 .agents/ 资源。
 */
export async function getProjectContext(projectId: string, projectPath: string): Promise<AppContext> {
  const defaultCtx = await getServerContext();

  // 检查缓存
  const cached = projectContextCache.get(projectId);
  if (cached) {
    return cached;
  }

  // 创建项目特定的 layout 和 context
  const projectLayout = resolveProjectLayout(defaultCtx.layout, projectPath);
  const projectCtx = await createContext({ runtime: defaultCtx.runtime, layout: projectLayout });

  // 缓存
  projectContextCache.set(projectId, projectCtx);

  return projectCtx;
}

export async function reloadServerContext(): Promise<AppContext> {
  const ctx = await getServerContext();
  context = await ctx.reload();
  // reload 会断开旧 MCP 连接并创建新注册表，需要重新建立连接
  if (context.mcpRegistry) {
    await context.mcpRegistry.connectAll().catch(() => {});
  }
  return context;
}

export async function getServerDataStore() {
  const rt = await getServerRuntime();
  return rt.dataStore;
}

// Cleanup function to stop all connections
export async function shutdownRuntime(): Promise<void> {
  stopAllFeishuLongConnections();
  if (runtime) {
    await runtime.dispose();
    runtime = null;
    context = null;
  }
}
