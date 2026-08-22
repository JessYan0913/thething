import path from 'path';
import os from 'os';
import { promises as fs } from 'fs';
import { bootstrap, createContext, resolveProjectLayout, configureConnectorInboundRuntime, loadGlobalConfig, buildModelAliases, loadMcpServers, type CoreRuntime, type AppContext, type GlobalConfig, type ModelEntry } from '@the-thing/core';
import { startAllFeishuLongConnections, stopAllFeishuLongConnections } from './feishu-long-connection';

// Next.js dev 的 HMR 会重新执行本模块，module 级单例随之清空 —— 旧 runtime
// （及其 spawn 的 MCP stdio 子进程）失去引用变成孤儿，新 runtime 又 spawn 一批，
// 每次热更新泄漏一组子进程。把单例挂到 globalThis 上跨 HMR 保活，保证整个
// dev 进程始终只有一个 runtime / 一组 MCP 连接。
interface RuntimeState {
  runtime: CoreRuntime | null;
  context: AppContext | null;
  initPromise: Promise<CoreRuntime> | null;
  /**
   * MCP 连接就绪的 Promise。
   * 由 initializeRuntime() 设置，在 connectAll() 完成后 resolve。
   * MCP API 路由等待此 Promise 以确保返回准确的连接状态。
   */
  mcpReadyPromise: Promise<void> | null;
  mcpReadyResolve: (() => void) | null;
  /** 启动时缓存的全局配置，供 getModelConfig() 使用 */
  cachedGlobalConfig: GlobalConfig | null;
  /** Project Context 缓存（按 projectId 缓存 AppContext） */
  projectContextCache: Map<string, AppContext>;
}

const G: RuntimeState = ((globalThis as unknown as { __thethingRuntimeState?: RuntimeState }).__thethingRuntimeState ??= {
  runtime: null,
  context: null,
  initPromise: null,
  mcpReadyPromise: null,
  mcpReadyResolve: null,
  cachedGlobalConfig: null,
  projectContextCache: new Map(),
});

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
 * 获取模型配置。
 * 从 ~/.thething/models.json 读取（通过 ~/.agents → ~/.thething symlink 兼容协议工具）。
 * 每次调用都从磁盘读取，确保配置更改后立即生效。
 *
 * @param modelId 可选,模型真名(models[] 中的 id)。
 *   - 缺省 → defaultModel
 *   - 'background' → backgroundModel(未配置时回落 defaultModel)
 *   - 其他 → 按 id 查条目;查不到时回落 defaultModel 条目
 * 返回值总是携带 models 列表,供 core 的 provider registry 按名分发凭据。
 */
export function getModelConfig(modelId?: string): {
  apiKey: string;
  baseURL: string;
  modelName?: string;
  models?: ModelEntry[];
  contextLimit?: number;
  enableThinking?: boolean;
} {
  const configDir = path.join(os.homedir(), '.thething');
  const freshConfig = loadGlobalConfig(configDir) || G.cachedGlobalConfig;
  const models = freshConfig?.models ?? [];

  let modelName: string | undefined;
  if (modelId === 'background') {
    modelName = freshConfig?.backgroundModel || freshConfig?.defaultModel;
  } else if (modelId && models.some(m => m.id === modelId)) {
    modelName = modelId;
  } else {
    modelName = freshConfig?.defaultModel;
  }

  const entry = models.find(m => m.id === modelName) ?? models[0];

  return {
    apiKey: entry?.apiKey || '',
    baseURL: entry?.baseURL || '',
    modelName,
    models,
    contextLimit: entry?.contextLimit,
    enableThinking: entry?.enableThinking,
  };
}

// ============================================================
// Runtime 初始化
// ============================================================

async function initializeRuntime(): Promise<CoreRuntime> {
  const envSnapshot: Record<string, string | undefined> = { ...process.env };

  // TheThing 统一数据目录：~/.thething
  // 通过 ~/.agents → ~/.thething symlink 兼容 Dot Agents Protocol 和 Agent Skills 生态
  const configDir = path.join(os.homedir(), '.thething');

  // 运行时数据目录（TheThing 产品数据）：
  // 1. ~/.thethingrc 中 dataDir 指针（用户配置）
  // 2. 默认 ~/.thething/
  const thethingRC = loadTheThingRC();
  const runtimeDataBase = thethingRC?.dataDir
    ? thethingRC.dataDir.replace(/^~/, os.homedir())
    : path.join(os.homedir(), '.thething');

  // 从 ~/.thething/models.json 读取配置
  let bootConfig = loadGlobalConfig(configDir);

  // 迁移兼容：如果 models.json 不存在，尝试旧的 config.json
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
  G.cachedGlobalConfig = globalConfig;

  const runtime = await bootstrap({
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
      // 别名两档语义:fast=后台任务模型,smart/default=主模型(见 core alias.ts)
      modelAliases: buildModelAliases({
        defaultModel: globalConfig?.defaultModel,
        backgroundModel: globalConfig?.backgroundModel,
        defaultContextLimit: globalConfig?.models?.find(m => m.id === globalConfig?.defaultModel)?.contextLimit,
        backgroundContextLimit: globalConfig?.models?.find(m => m.id === globalConfig?.backgroundModel)?.contextLimit,
      }),
    },
    env: envSnapshot,
    debug: true,
  });

  const context = await createContext({ runtime });
  G.runtime = runtime;
  G.context = context;

  // 后台异步连接所有 MCP 服务，不阻塞启动流程。
  // 连接状态通过 registry.snapshot() 由调用方按需获取。
  // MCP API 路由通过 mcpReadyPromise 等待连接完成。
  if (context.mcpRegistry) {
    G.mcpReadyPromise = new Promise<void>((resolve) => {
      G.mcpReadyResolve = resolve;
    });
    context.mcpRegistry.connectAll()
      .then(() => G.mcpReadyResolve?.())
      .catch(() => G.mcpReadyResolve?.())  // 即使失败也 resolve，让 API 可以返回错误状态
      .finally(() => {
        G.mcpReadyPromise = null;
        G.mcpReadyResolve = null;
      });
  }

  // Wire up connector inbound: bind AI agent handler to Feishu/WeChat webhooks
  const defaultEntry = globalConfig?.models?.find(m => m.id === globalConfig?.defaultModel) ?? globalConfig?.models?.[0];
  configureConnectorInboundRuntime(runtime.connectorRuntime, {
    appContext: context,
    modelConfig: {
      apiKey: defaultEntry?.apiKey || '',
      baseURL: defaultEntry?.baseURL || '',
      modelName: globalConfig?.defaultModel || '',
      models: globalConfig?.models,
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
  if (!G.runtime) {
    if (G.initPromise) {
      return G.initPromise;
    }
    G.initPromise = initializeRuntime();
    try {
      return await G.initPromise;
    } finally {
      G.initPromise = null;
    }
  }
  return G.runtime;
}

/**
 * 获取当前缓存的 AppContext，未初始化时返回 null（不触发初始化）。
 */
export function getServerContextIfReady(): AppContext | null {
  return G.context;
}

/**
 * 等待 MCP 连接完成。
 * 如果连接已在进行中，返回当前的 Promise；否则立即 resolve。
 * MCP API 路由使用此函数确保返回准确的连接状态。
 */
export async function waitForMcpReady(): Promise<void> {
  if (G.mcpReadyPromise) {
    await G.mcpReadyPromise;
  }
}

export async function getServerContext(): Promise<AppContext> {
  if (G.context) {
    return G.context;
  }
  const rt = await getServerRuntime();
  G.context ??= await createContext({ runtime: rt });
  return G.context;
}

/**
 * 获取项目特定的 AppContext（带缓存）。
 * 为项目目录创建独立的 layout，加载该目录下的资源。
 */
export async function getProjectContext(projectId: string, projectPath: string): Promise<AppContext> {
  const defaultCtx = await getServerContext();

  // 检查缓存
  const cached = G.projectContextCache.get(projectId);
  if (cached) {
    return cached;
  }

  // 创建项目特定的 layout 和 context
  const projectLayout = resolveProjectLayout(defaultCtx.layout, projectPath);
  const projectCtx = await createContext({ runtime: defaultCtx.runtime, layout: projectLayout });

  // 后台预连接项目级 MCP（loadAllTools 的幂等 connectAll 是兜底，这里让首轮就有连接）
  projectCtx.mcpRegistry.connectAll().catch(() => {});

  // 缓存
  G.projectContextCache.set(projectId, projectCtx);

  return projectCtx;
}

export async function reloadServerContext(): Promise<AppContext> {
  const ctx = await getServerContext();
  G.context = await ctx.reload();
  // reload 会断开旧 MCP 连接并创建新注册表，需要重新建立连接
  await G.context.mcpRegistry.connectAll().catch(() => {});
  return G.context;
}

/**
 * MCP 配置写盘后定向同步运行时（不做全量 context reload）。
 *
 * 对比 reloadServerContext 的三个优势：
 * 1. 只同步 MCP 子系统，不无差别重启全部 stdio 子进程；
 * 2. 全局 + 所有已缓存项目 context 一起同步（reload 只碰全局 context）；
 * 3. 不丢 layout（项目 context reload 会退回默认 layout 的现存 bug）。
 *
 * diff 应用同步完成，连接建立后台化（connect: false + connectAll），
 * 让 API 快速返回；前端已有 5s 轮询能看到真实连接进度。
 */
export async function syncMcpRuntime(): Promise<void> {
  const ctx = G.context;
  if (!ctx) return; // runtime 未初始化 → 启动时会读到最新磁盘配置
  const homeDir = os.homedir();
  const targets = [ctx, ...G.projectContextCache.values()];
  for (const c of targets) {
    try {
      const configs = await loadMcpServers({
        cwd: c.layout.resourceRoot,
        homeDir,
        configDir: c.layout.configDir,
      });
      await c.mcpRegistry.syncServers(configs, { connect: false });
      // 后台补连：不阻塞 API 响应
      c.mcpRegistry.connectAll().catch(() => {});
    } catch (e) {
      console.warn('[SyncMcpRuntime]', `Failed to sync MCP for ${c.layout.resourceRoot}: ${e instanceof Error ? e.message : e}`);
    }
  }
}

export async function getServerDataStore() {
  const rt = await getServerRuntime();
  return rt.dataStore;
}

// Cleanup function to stop all connections
export async function shutdownRuntime(): Promise<void> {
  stopAllFeishuLongConnections();
  if (G.runtime) {
    await G.runtime.dispose();
    G.runtime = null;
    G.context = null;
  }
}
