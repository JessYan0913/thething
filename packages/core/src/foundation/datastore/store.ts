// ============================================================
// Data Store - Factory Functions
// ============================================================
// Provides factory functions for creating DataStore instances.
// The recommended approach is to use bootstrap() to create a CoreRuntime,
// which manages the DataStore lifecycle.

import type {
  DataStore,
  SQLiteDataStoreConfig,
} from './types';
import { SQLiteDataStore } from './sqlite';

// Re-export SQLite utilities for convenience
export { SQLiteDataStore, createSQLiteDataStore } from './sqlite';

/**
 * Create a default SQLite data store instance.
 * Suitable for scripts and CLI tools that don't need fine-grained lifecycle control.
 *
 * For server applications, prefer creating a `CoreRuntime` via `bootstrap()`
 * and accessing `runtime.dataStore`.
 */
export function createDefaultDataStore(config?: SQLiteDataStoreConfig): DataStore {
  return new SQLiteDataStore(config);
}

/**
 * Create an in-memory data store for testing.
 * Each call creates an isolated, ephemeral SQLite instance.
 */
export function createInMemoryDataStore(): DataStore {
  return new SQLiteDataStore({ dataDir: ':memory:' });
}
