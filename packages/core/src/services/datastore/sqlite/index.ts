// ============================================================
// SQLite Implementation Module Entry
// ============================================================
// Exports SQLite-specific implementations for developers who need
// to mix SQLite with custom implementations.

// Core SQLite DataStore
export { SQLiteDataStore, createSQLiteDataStore } from './sqlite-data-store';

// Individual SQLite Stores (for partial replacement scenarios)
export { SQLiteConversationStore } from './conversation-store';
export { SQLiteMessageStore } from './message-store';
export { SQLiteSummaryStore } from './summary-store';
export { SQLiteCostStore } from './cost-store';
export { SQLiteTodoStore } from './todo-store';
export { SQLiteProjectStore } from './project-store';
export { SQLiteAgentRunStore } from './agent-run-store';
export { SQLiteSuspendedStateStore } from './suspended-state-store';

// Schema utilities (for advanced users)
export { initializeSchema } from './schema';