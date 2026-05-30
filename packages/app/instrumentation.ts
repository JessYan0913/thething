import { getServerRuntime } from './lib/runtime';

export async function register() {
  // Only run on the server
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    console.log('[Instrumentation] Initializing server runtime...');
    try {
      await getServerRuntime();
      console.log('[Instrumentation] Server runtime initialized successfully');
    } catch (error) {
      console.error('[Instrumentation] Failed to initialize server runtime:', error);
    }
  }
}
