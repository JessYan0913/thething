// ============================================================
// Data Store - Global Instance Management
// ============================================================
// Provides global singleton management for DataStore.
// Default uses SQLite implementation from sqlite/ module.

import type {
  DataStore,
  SQLiteDataStoreConfig,
} from './types';
import { SQLiteDataStore, createSQLiteDataStore } from './sqlite';

// ============================================================================
// Global Instance Management
// ============================================================================

let globalDataStore: DataStore | null = null;

/**
 * Get the global data store instance.
 * Creates default SQLite store if not already set.
 */
export function getGlobalDataStore(): DataStore {
  if (!globalDataStore) {
    globalDataStore = new SQLiteDataStore();
  }
  return globalDataStore;
}

/**
 * Set a custom global data store.
 * Call this before any data operations to use custom implementation.
 */
export function setGlobalDataStore(store: DataStore): void {
  if (globalDataStore && globalDataStore.isConnected()) {
    console.warn(
      '[DataStore] Previous store was connected. Consider closing it first.'
    );
  }
  globalDataStore = store;
}

/**
 * Configure the data store with SQLite configuration.
 * Must be called before first getGlobalDataStore() invocation.
 */
export function configureDataStore(config: SQLiteDataStoreConfig): void {
  if (globalDataStore) {
    console.warn(
      '[DataStore] Store already initialized. configureDataStore() must be called before first use.'
    );
    return;
  }
  globalDataStore = new SQLiteDataStore(config);
}

/**
 * Legacy configuration function.
 * @deprecated Use configureDataStore() instead.
 */
export function configureDatabase(config: SQLiteDataStoreConfig): void {
  configureDataStore(config);
}

/**
 * Reset the global store (for testing).
 * Closes existing connection if connected.
 */
export function resetGlobalDataStore(): void {
  if (globalDataStore && globalDataStore.isConnected()) {
    globalDataStore.close();
  }
  globalDataStore = null;
}

// Re-export SQLite utilities for convenience
export { SQLiteDataStore, createSQLiteDataStore } from './sqlite';