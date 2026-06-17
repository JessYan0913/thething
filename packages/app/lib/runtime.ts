import path from 'path';
import os from 'os';
import { promises as fs } from 'fs';
import { bootstrap, createContext, configureConnectorInboundRuntime, loadGlobalConfig, type CoreRuntime, type AppContext } from '@the-thing/core';
import { startAllFeishuLongConnections, stopAllFeishuLongConnections } from './feishu-long-connection';

let runtime: CoreRuntime | null = null;
let context: AppContext | null = null;
let initPromise: Promise<CoreRuntime> | null = null;

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

  // Stage 1: 从默认位置读取自定义配置目录
  const defaultGlobalConfigDir = process.env.THETHING_GLOBAL_CONFIG_DIR || path.join(os.homedir(), '.thething');
  const bootConfig = loadGlobalConfig(defaultGlobalConfigDir);
  const configDir = bootConfig?.configDir || defaultGlobalConfigDir;

  // Stage 2: 用真实的 configDir 加载全部配置
  const globalConfig = loadGlobalConfig(configDir);

  runtime = await bootstrap({
    layout: {
      resourceRoot: process.cwd(),
      configDir,
      dataDir: process.env.THETHING_DATA_DIR || path.join(configDir, 'data'),
    },
    connectorConfig: {
      configDir: path.join(configDir, 'connectors'),
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
      apiKey: process.env.THETHING_API_KEY || globalConfig?.apiKey || '',
      baseURL: process.env.THETHING_BASE_URL || globalConfig?.baseURL || '',
      modelName: process.env.THETHING_MODEL || globalConfig?.modelAliases?.default?.model || '',
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
