import path from 'path';
import os from 'os';
import { bootstrap, createContext, configureConnectorInboundRuntime, loadGlobalConfig, type CoreRuntime, type AppContext } from '@the-thing/core';
import { startAllFeishuLongConnections, stopAllFeishuLongConnections } from './feishu-long-connection';

let runtime: CoreRuntime | null = null;
let context: AppContext | null = null;
let initPromise: Promise<CoreRuntime> | null = null;

async function initializeRuntime(): Promise<CoreRuntime> {
  const envSnapshot: Record<string, string | undefined> = { ...process.env };
  const globalConfig = loadGlobalConfig();

  runtime = await bootstrap({
    layout: {
      resourceRoot: process.cwd(),
      dataDir: process.env.THETHING_DATA_DIR,
    },
    connectorConfig: {
      configDir: path.join(os.homedir(), '.thething', 'connectors'),
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
