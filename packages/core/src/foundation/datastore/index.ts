// ============================================================
// Data Storage Abstraction Layer - Module Entry
// ============================================================
//
// Provides interfaces for persisting conversation data, messages,
// summaries, and costs.
//
// Note: Memory storage is handled by the file-based memory system
// in ${DEFAULT_PROJECT_CONFIG_DIR_NAME}/memory/, not by DataStore.
//
// @example Recommended usage (via CoreRuntime)
// ```typescript
// import { bootstrap } from '@the-thing/core';
//
// const runtime = await bootstrap({ dataDir: './data' });
// const store = runtime.dataStore;
// store.conversationStore.createConversation('conv-123', 'My Chat');
// // ...
// await runtime.dispose();
// ```
//
// @example Standalone usage (scripts / CLI tools)
// ```typescript
// import { createDefaultDataStore } from '@the-thing/core';
//
// const store = createDefaultDataStore({ dataDir: './data' });
// store.conversationStore.createConversation('conv-123', 'My Chat');
// store.close();
// ```
//
// @example Testing (isolated in-memory store)
// ```typescript
// import { createInMemoryDataStore } from '@the-thing/core';
//
// const store = createInMemoryDataStore();
// // Use store in tests — each call creates a fresh isolated instance
// ```
//
// @example Partial replacement (mix SQLite with custom)
// ```typescript
// import { createSQLiteDataStore, type DataStore } from '@the-thing/core';
//
// const sqlite = createSQLiteDataStore();
// const customStore: DataStore = {
//   ...sqlite,
//   costStore: new RedisCostStore(), // Only replace cost storage
// };
// ```

// ============================================================================
// Types (interfaces and data models - no implementation dependencies)
// ============================================================================
export * from './types';

// ============================================================================
// Factory Functions
// ============================================================================
export {
  createDefaultDataStore,
  createInMemoryDataStore,
} from './store';

// ============================================================================
// SQLite Implementation (for developers who need SQLite-specific features)
// ============================================================================
export {
  SQLiteDataStore,
  createSQLiteDataStore,
  SQLiteConversationStore,
  SQLiteMessageStore,
  SQLiteSummaryStore,
  SQLiteCostStore,
  initializeSchema,
} from './sqlite';