// ============================================================
// Data Storage Abstraction Layer - Module Entry
// ============================================================
//
// Provides interfaces for persisting conversation data, messages,
// summaries, and costs.
//
// Note: Memory storage is handled by the file-based memory system
// in .thething/memory/, not by DataStore.
//
// @example Basic usage (default SQLite)
// ```typescript
// import { getGlobalDataStore } from '@thething/core/datastore';
//
// const store = getGlobalDataStore();
// store.conversationStore.createConversation('conv-123', 'My Chat');
// ```
//
// @example Custom implementation
// ```typescript
// import { setGlobalDataStore, type DataStore } from '@thething/core/datastore';
//
// setGlobalDataStore(new MyPostgresDataStore());
// ```
//
// @example Partial replacement (mix SQLite with custom)
// ```typescript
// import { createSQLiteDataStore, setGlobalDataStore } from '@thething/core/datastore';
//
// const sqlite = createSQLiteDataStore();
// setGlobalDataStore({
//   ...sqlite,
//   costStore: new RedisCostStore(), // Only replace cost storage
// });
// ```

// ============================================================================
// Types (interfaces and data models - no implementation dependencies)
// ============================================================================
export * from './types';

// ============================================================================
// Global Instance Management
// ============================================================================
export {
  getGlobalDataStore,
  setGlobalDataStore,
  configureDataStore,
  configureDatabase,
  resetGlobalDataStore,
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
  initializeCostSchema,
} from './sqlite';