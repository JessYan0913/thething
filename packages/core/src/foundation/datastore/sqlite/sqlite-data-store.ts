// ============================================================
// SQLite DataStore Implementation
// ============================================================
// Provides all sub-stores with a shared SQLite database connection.
// Note: Memory storage is file-based, not database-based.
//
// 重要变更（2026-04）：
// - DEFAULT_DATA_DIR 已迁移到 ResolvedLayout.dataDir
// - DEFAULT_DB_FILENAME 已迁移到 ResolvedLayout.filenames.db
//
// 调用方应从 runtime.layout 获取配置并传入 SQLiteDataStoreConfig
// 此处保留 defaults 导入作为 fallback
// ============================================================

import path from 'path';
import fs from 'fs';
import type { SqliteDatabase } from '../types';
import { getDatabase } from './native-loader';
import { initializeSchema } from './schema';
import type {
  DataStore,
  SQLiteDataStoreConfig,
  ConversationStore,
  MessageStore,
  SummaryStore,
  CostStore,
  TaskStore,
} from '../types';
import { SQLiteConversationStore } from './conversation-store';
import { SQLiteMessageStore } from './message-store';
import { SQLiteSummaryStore } from './summary-store';
import { SQLiteCostStore } from './cost-store';
import { SQLiteTaskStore } from './task-store';

// 从统一配置模块导入常量（作为 fallback）
import {
  DEFAULT_DATA_DIR,
  DEFAULT_DB_FILENAME,
} from '../../../config/defaults';

// 默认数据目录：cwd/.data（硬编码默认值，不读取环境变量）
const getDefaultDataDir = () => path.join(process.cwd(), DEFAULT_DATA_DIR);

// ============================================================================
// SQLite DataStore Implementation
// ============================================================================

/**
 * SQLite-based DataStore implementation.
 * Provides sub-stores with a shared database connection.
 *
 * Note: Memory storage is handled by the file-based memory system
 * in .siact/memory/, not by this DataStore.
 */
export class SQLiteDataStore implements DataStore {
  private db: SqliteDatabase;
  private _isConnected: boolean = true;

  readonly conversationStore: ConversationStore;
  readonly messageStore: MessageStore;
  readonly summaryStore: SummaryStore;
  readonly costStore: CostStore;
  readonly taskStore: TaskStore;

  constructor(config: SQLiteDataStoreConfig = {}) {
    const dataDir = config.dataDir || getDefaultDataDir();
    const dbPath = path.join(dataDir, DEFAULT_DB_FILENAME);

    // Ensure directory exists
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }

    const Database = getDatabase();
    this.db = new Database(dbPath);

    // Configure SQLite
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');

    // Initialize schema
    initializeSchema(this.db);

    // Initialize sub-stores with shared connection
    this.conversationStore = new SQLiteConversationStore(this.db);
    this.summaryStore = new SQLiteSummaryStore(this.db);
    this.costStore = new SQLiteCostStore(this.db);
    this.taskStore = new SQLiteTaskStore(this.db);
    // MessageStore needs conversationStore for auto-creating conversations
    this.messageStore = new SQLiteMessageStore(this.db, this.conversationStore);
  }

  close(): void {
    if (this.db && this.db.open) {
      this.db.close();
      this._isConnected = false;
    }
  }

  isConnected(): boolean {
    return this._isConnected && this.db.open;
  }

  transaction<T>(fn: () => T): T {
    const tx = this.db.transaction(fn);
    return tx();
  }

  async backup(destination: string): Promise<void> {
    await this.db.backup(destination);
  }
}

/**
 * Create a new SQLite data store instance.
 * Does not affect the global store - useful for isolated testing.
 */
export function createSQLiteDataStore(
  config?: SQLiteDataStoreConfig
): SQLiteDataStore {
  return new SQLiteDataStore(config);
}