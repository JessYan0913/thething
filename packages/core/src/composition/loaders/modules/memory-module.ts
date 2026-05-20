// ============================================================
// Memory Module - AppModule adapter for memory loader
// ============================================================

import type { AppModule, ModuleContext } from '../module-types';
import { loadMemory, clearMemoryCache, type LoadMemoryOptions, type MemoryEntry } from '../memory';

export function createMemoryModule(loadOptions?: LoadMemoryOptions): AppModule<MemoryEntry[]> {
  let loadedMemory: MemoryEntry[] = [];

  return {
    name: 'memory',

    async init(context: ModuleContext): Promise<void> {
      const options: LoadMemoryOptions = {
        cwd: context.cwd,
        configDirName: context.configDirName,
        dirs: context.resourceDirs.memory,
        ...loadOptions,
      };
      loadedMemory = await loadMemory(options);
    },

    snapshot(): MemoryEntry[] {
      return loadedMemory;
    },

    async dispose(): Promise<void> {
      clearMemoryCache();
      loadedMemory = [];
    },
  };
}
