import path from 'path';
import os from 'os';
import { bootstrap, createContext, configureConnectorInboundRuntime, loadGlobalConfig, type CoreRuntime, type AppContext } from '@the-thing/core';
import { startAllFeishuLongConnections, stopAllFeishuLongConnections } from './feishu-long-connection';

let runtime: CoreRuntime | null = null;
let context: AppContext | null = null;
let initPromise: Promise<CoreRuntime> | null = null;

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
  if (!context) {
    const rt = await getServerRuntime();
    context = await createContext({ runtime: rt });
  }
  return context;
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
