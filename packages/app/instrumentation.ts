export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    console.log('[Instrumentation] Initializing server runtime...');
    try {
      const { getServerRuntime } = await import('./lib/runtime');
      await getServerRuntime();
      console.log('[Instrumentation] Server runtime initialized successfully');
    } catch (error) {
      console.error('[Instrumentation] Failed to initialize server runtime:', error);
    }
  }
}
