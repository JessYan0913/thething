import { bootstrap, createContext, configureConnectorInboundRuntime, loadGlobalConfig, type CoreRuntime, type AppContext } from '@the-thing/core';

let runtime: CoreRuntime | null = null;
let context: AppContext | null = null;
let initPromise: Promise<CoreRuntime> | null = null;

async function initializeRuntime(): Promise<CoreRuntime> {
  const envSnapshot: Record<string, string | undefined> = { ...process.env };

  runtime = await bootstrap({
    layout: {
      resourceRoot: process.cwd(),
      dataDir: process.env.THETHING_DATA_DIR,
    },
    env: envSnapshot,
    debug: true,
  });

  context = await createContext({ runtime });

  // Wire up connector inbound: bind AI agent handler to Feishu/WeChat webhooks
  const globalConfig = loadGlobalConfig();
  configureConnectorInboundRuntime(runtime.connectorRuntime, {
    appContext: context,
    modelConfig: {
      apiKey: process.env.THETHING_API_KEY || globalConfig?.apiKey || '',
      baseURL: process.env.THETHING_BASE_URL || globalConfig?.baseURL || '',
      modelName: process.env.THETHING_MODEL || globalConfig?.modelAliases?.default || '',
    },
  });

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
