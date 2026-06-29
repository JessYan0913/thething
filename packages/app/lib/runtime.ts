import path from 'path';
import os from 'os';
import { promises as fs } from 'fs';
import { bootstrap, createContext, resolveProjectLayout, configureConnectorInboundRuntime, loadGlobalConfig, type CoreRuntime, type AppContext, type GlobalConfig } from '@the-thing/core';
import { startAllFeishuLongConnections, stopAllFeishuLongConnections } from './feishu-long-connection';

let runtime: CoreRuntime | null = null;
let context: AppContext | null = null;
let initPromise: Promise<CoreRuntime> | null = null;

/** 启动时缓存的全局配置，供 getModelConfig() 使用 */
let cachedGlobalConfig: GlobalConfig | null = null;

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
const projectContextCache: Map<string, { context: AppContext; skillDirMtimes: Map<string, number> }> = new Map();

// ============================================================
// Skills 磁盘变更检测（mtime 指纹）
// ============================================================

/** 上次加载时记录的 skills 目录及其子目录 mtime */
let skillDirMtimes: Map<string, number> = new Map();

/** 采集 skills 目录及子目录的 mtime */
async function collectSkillDirMtimes(rt: CoreRuntime): Promise<Map<string, number>> {
  const mtimes = new Map<string, number>();
  const dirs = rt.layout.resources.skills;
  for (const dir of dirs) {
    try {
      const stat = await fs.stat(dir);
      mtimes.set(dir, stat.mtimeMs);
      // 扫描子目录（每个技能文件夹），检测已有技能的内容修改
      const entries = await fs.readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory()) {
          const subStat = await fs.stat(path.join(dir, entry.name));
          mtimes.set(path.join(dir, entry.name), subStat.mtimeMs);
        }
      }
    } catch {
      // 目录不存在，跳过
    }
  }
  return mtimes;
}

/** 检查 skills 目录自上次加载后是否有磁盘变更 */
async function isSkillDirStale(rt: CoreRuntime): Promise<boolean> {
  const current = await collectSkillDirMtimes(rt);
  if (current.size !== skillDirMtimes.size) return true;
  for (const [dir, mtime] of current) {
    if (skillDirMtimes.get(dir) !== mtime) return true;
  }
  return false;
}

async function initializeRuntime(): Promise<CoreRuntime> {
  const envSnapshot: Record<string, string | undefined> = { ...process.env };

  // Dot Agents 协议路径：~/.agents/ 为配置目录
  const defaultConfigDir = path.join(os.homedir(), '.agents');

  // 运行时数据目录：~/.thething/
  const runtimeDataBase = path.join(os.homedir(), '.thething');

  // 从 .agents/models.json 读取配置
  let bootConfig = loadGlobalConfig(defaultConfigDir);

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

  const rawConfigDir = bootConfig?.configDir || defaultConfigDir;
  const configDir = rawConfigDir.replace(/^~/, os.homedir());

  // 从最终 configDir 加载全部配置（会从 .agents/models.json 读取）
  const globalConfig = loadGlobalConfig(configDir) || bootConfig;
  cachedGlobalConfig = globalConfig;

  runtime = await bootstrap({
    layout: {
      resourceRoot: process.cwd(),
      configDir,
      // 运行时数据保持在 ~/.thething/ 下
      dataDir: process.env.THETHING_DATA_DIR || path.join(runtimeDataBase, 'data'),
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

  // 启动时主动连接所有 MCP 服务，保持与运行时一致的状态
  if (context.mcpRegistry) {
    await context.mcpRegistry.connectAll().catch(() => {});
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

export async function getServerContext(): Promise<AppContext> {
  if (context) {
    // 轻量级检查：skills 目录是否有磁盘变更（新增/修改/删除技能）
    const stale = await isSkillDirStale(context.runtime).catch(() => false);
    if (stale) {
      console.log('[Runtime] Skills 目录已变更，自动重新加载');
      context = await context.reload();
      if (context.mcpRegistry) {
        await context.mcpRegistry.connectAll().catch(() => {});
      }
    }
    return context;
  }
  const rt = await getServerRuntime();
  context = await createContext({ runtime: rt });
  // 记录初始 mtime 指纹
  skillDirMtimes = await collectSkillDirMtimes(rt);
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
    // 检查项目的 skills 目录是否有变更
    const projectLayout = resolveProjectLayout(defaultCtx.layout, projectPath);
    const currentMtimes = await collectProjectSkillDirMtimes(projectLayout).catch(() => new Map());
    const stale = currentMtimes.size !== cached.skillDirMtimes.size ||
      [...currentMtimes].some(([dir, mtime]) => cached.skillDirMtimes.get(dir) !== mtime);
    if (!stale) {
      return cached.context;
    }
    // 缓存过期，清理旧连接
    if (cached.context.mcpRegistry) {
      await cached.context.mcpRegistry.disconnectAll().catch(() => {});
    }
  }

  // 创建项目特定的 layout 和 context
  const projectLayout = resolveProjectLayout(defaultCtx.layout, projectPath);
  const projectCtx = await createContext({ runtime: defaultCtx.runtime, layout: projectLayout });

  // 记录 mtime 并缓存
  const skillMtimes = await collectProjectSkillDirMtimes(projectLayout).catch(() => new Map());
  projectContextCache.set(projectId, { context: projectCtx, skillDirMtimes: skillMtimes });

  return projectCtx;
}

/** 采集项目 layout 下 skills 目录的 mtime */
async function collectProjectSkillDirMtimes(projectLayout: { resources: { skills: readonly string[] } }): Promise<Map<string, number>> {
  const mtimes = new Map<string, number>();
  for (const dir of projectLayout.resources.skills) {
    try {
      const stat = await fs.stat(dir);
      mtimes.set(dir, stat.mtimeMs);
      const entries = await fs.readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory()) {
          const subStat = await fs.stat(path.join(dir, entry.name));
          mtimes.set(path.join(dir, entry.name), subStat.mtimeMs);
        }
      }
    } catch {
      // 目录不存在，跳过
    }
  }
  return mtimes;
}

export async function reloadServerContext(): Promise<AppContext> {
  const ctx = await getServerContext();
  context = await ctx.reload();
  // reload 会断开旧 MCP 连接并创建新注册表，需要重新建立连接
  if (context.mcpRegistry) {
    await context.mcpRegistry.connectAll().catch(() => {});
  }
  // 重置 mtime 缓存，让下次 getServerContext() 记录新的 mtime
  skillDirMtimes = await collectSkillDirMtimes(context.runtime);
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
