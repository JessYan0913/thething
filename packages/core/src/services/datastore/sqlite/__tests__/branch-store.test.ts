import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { UIMessage } from 'ai';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createSQLiteDataStore, type SQLiteDataStore } from '../sqlite-data-store';
import { getDatabase } from '../native-loader';

function msg(id: string, role: 'user' | 'assistant', text: string): UIMessage {
  return { id, role, parts: [{ type: 'text', text }] } as UIMessage;
}

describe('SQLiteBranchStore', () => {
  let tmpDir: string;
  let store: SQLiteDataStore;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'branch-store-test-'));
    store = createSQLiteDataStore({ dataDir: tmpDir });
    store.conversationStore.createConversation('c1');
  });

  afterEach(() => {
    store.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('creates a stable main branch and projection', () => {
    store.messageStore.commitUserMessage('c1', msg('u1', 'user', 'hello'));
    const main = store.branchStore.ensureMainBranch('c1');
    const again = store.branchStore.ensureMainBranch('c1');
    expect(again.id).toBe(main.id);

    const projection = store.branchStore.getProjection('c1');
    expect(projection.activeBranchId).toBe(main.id);
    expect(projection.branches).toHaveLength(1);
    expect(projection.branches[0]).toMatchObject({ name: '主分支', isCurrent: true });
  });

  it('executes append with optimistic tip validation', () => {
    const main = store.branchStore.ensureMainBranch('c1');
    const result = store.branchStore.executeCommand('c1', {
      type: 'append',
      branchId: main.id,
      message: msg('u1', 'user', 'q1'),
      expectedTipId: null,
    });
    expect(result.headMessageId).toBe('u1');
    expect(store.branchStore.getBranch(main.id)?.tipMessageId).toBe('u1');

    expect(() => store.branchStore.executeCommand('c1', {
      type: 'append',
      branchId: main.id,
      message: msg('u2', 'user', 'q2'),
      expectedTipId: null,
    })).toThrow('Branch tip conflict');
  });

  it('creates and switches a formal fork', () => {
    const main = store.branchStore.ensureMainBranch('c1');
    store.branchStore.executeCommand('c1', {
      type: 'append', branchId: main.id, message: msg('u1', 'user', 'q1'), expectedTipId: null,
    });
    store.messageStore.appendMessages('c1', [msg('a1', 'assistant', 'r1')], 'u1');

    const fork = store.branchStore.executeCommand('c1', {
      type: 'fork', sourceBranchId: main.id, fromMessageId: 'u1', name: 'Alternative',
    });
    expect(fork.branchId).not.toBe(main.id);
    expect(store.branchStore.getBranch(fork.branchId)).toMatchObject({
      parentBranchId: main.id,
      forkMessageId: 'u1',
      name: 'Alternative',
      status: 'active',
    });
    expect(store.branchStore.getProjection('c1').activeBranchId).toBe(fork.branchId);

    expect(store.branchStore.switchBranch('c1', main.id)).toBe(true);
    expect(store.messageStore.getMessagesByConversation('c1').map((message) => message.id))
      .toEqual(['u1', 'a1']);
  });

  it('supports rename, pin, archive and safe deletion', () => {
    const main = store.branchStore.ensureMainBranch('c1');
    const branch = store.branchStore.createBranch({
      conversationId: 'c1',
      parentBranchId: main.id,
      forkMessageId: null,
      tipMessageId: null,
      status: 'candidate',
    });
    expect(store.branchStore.updateBranch(branch.id, {
      name: 'Research', status: 'active', isPinned: true,
    })).toMatchObject({ name: 'Research', status: 'active', isPinned: true });
    expect(store.branchStore.updateBranch(branch.id, { status: 'archived' })?.status).toBe('archived');
    expect(() => store.branchStore.updateBranch(main.id, { status: 'archived' }))
      .toThrow('Cannot archive the active branch');
    expect(store.branchStore.deleteBranch(branch.id)).toBe(true);
    expect(store.branchStore.getBranch(branch.id)).toBeNull();
    expect(() => store.branchStore.deleteBranch(main.id)).toThrow('Cannot delete the active branch');
  });

  it('records immutable run outcomes', () => {
    const main = store.branchStore.ensureMainBranch('c1');
    const run = store.conversationRunStore.createRun({
      id: 'run-1', conversationId: 'c1', branchId: main.id, expectedTipId: null, model: 'test-model',
    });
    expect(run.status).toBe('running');
    store.conversationRunStore.finishRun(run.id, { status: 'committed', resultTipId: 'a1' });
    expect(store.conversationRunStore.getRun(run.id)).toMatchObject({
      status: 'committed', resultTipId: 'a1', model: 'test-model',
    });
  });

  it('creates a candidate branch for regenerate without stealing the source message', () => {
    const main = store.branchStore.ensureMainBranch('c1');
    store.branchStore.executeCommand('c1', {
      type: 'append', branchId: main.id, message: msg('u1', 'user', 'q1'), expectedTipId: null,
    });
    store.messageStore.appendMessages('c1', [msg('a1', 'assistant', 'r1')], 'u1');

    const result = store.branchStore.executeCommand('c1', {
      type: 'regenerate', branchId: main.id, messageId: 'u1',
    });
    expect(store.branchStore.getBranch(result.branchId)).toMatchObject({
      parentBranchId: main.id,
      forkMessageId: 'u1',
      tipMessageId: 'u1',
      status: 'candidate',
    });

    store.branchStore.switchBranch('c1', main.id);
    expect(store.messageStore.getMessagesByConversation('c1').map((message) => message.id))
      .toEqual(['u1', 'a1']);
  });

  it('creates an edited immutable sibling owned by the candidate branch', () => {
    const main = store.branchStore.ensureMainBranch('c1');
    store.branchStore.executeCommand('c1', {
      type: 'append', branchId: main.id, message: msg('u1', 'user', 'original'), expectedTipId: null,
    });
    store.messageStore.appendMessages('c1', [msg('a1', 'assistant', 'answer')], 'u1');

    const result = store.branchStore.executeCommand('c1', {
      type: 'edit', branchId: main.id, messageId: 'u1', replacement: msg('u1', 'user', 'edited'),
    });
    expect(result.headMessageId).not.toBe('u1');
    expect(store.messageStore.getMessagesByConversation('c1').map((message) =>
      message.parts.find((part) => part.type === 'text')?.text,
    )).toEqual(['edited']);

    store.branchStore.switchBranch('c1', main.id);
    expect(store.messageStore.getMessagesByConversation('c1').map((message) => message.id))
      .toEqual(['u1', 'a1']);
  });

  it('persists selected children when switching between deep paths', () => {
    const main = store.branchStore.ensureMainBranch('c1');
    store.messageStore.commitUserMessage('c1', msg('u1', 'user', 'q1'));
    store.messageStore.appendMessages('c1', [msg('a1', 'assistant', 'r1'), msg('u2', 'user', 'q2')], 'u1');
    store.messageStore.switchHead('c1', 'u1', false);
    store.messageStore.appendMessages('c1', [msg('a2', 'assistant', 'r2'), msg('u3', 'user', 'q3')], 'u1');

    expect(store.messageStore.switchHead('c1', 'a1', true)).toBe(true);
    expect(store.messageStore.getMessagesByConversation('c1').map((message) => message.id))
      .toEqual(['u1', 'a1', 'u2']);
    expect(store.messageStore.switchHead('c1', 'u1', true)).toBe(true);
    expect(store.messageStore.getMessagesByConversation('c1').map((message) => message.id))
      .toEqual(['u1', 'a1', 'u2']);
    expect(store.branchStore.getBranch(main.id)?.tipMessageId).toBe('u2');
  });

  it('isolates summary invalidation to the active branch', () => {
    const main = store.branchStore.ensureMainBranch('c1');
    store.messageStore.commitUserMessage('c1', msg('u1', 'user', 'q1'));
    store.summaryStore.saveSummary('c1', 'main summary', 0, 10, 'u1');
    const branch = store.branchStore.createBranch({
      conversationId: 'c1', parentBranchId: main.id, forkMessageId: 'u1', tipMessageId: 'u1', status: 'active',
    });
    store.branchStore.switchBranch('c1', branch.id);
    store.summaryStore.saveSummary('c1', 'branch summary', 0, 10, 'u1');
    store.messageStore.commitUserMessage('c1', msg('u2', 'user', 'q2'));

    expect(store.summaryStore.getSummaryByConversation('c1', main.id)?.summary).toBe('main summary');
    expect(store.summaryStore.getSummaryByConversation('c1', branch.id)?.summary).toBe('branch summary');
  });

  it('migrates a v13 database to a stable main branch', () => {
    store.close();
    const dbPath = path.join(tmpDir, 'chat.db');
    fs.rmSync(dbPath, { force: true });
    const Database = getDatabase();
    const db = new Database(dbPath);
    db.exec(`
      CREATE TABLE conversations (
        id TEXT PRIMARY KEY,
        title TEXT DEFAULT 'New Conversation',
        head_message_id TEXT DEFAULT NULL,
        context_usage REAL DEFAULT NULL,
        context_total INTEGER DEFAULT NULL,
        context_limit INTEGER DEFAULT NULL,
        revision INTEGER NOT NULL DEFAULT 0,
        source TEXT DEFAULT 'user',
        source_id TEXT DEFAULT NULL,
        channel_id TEXT DEFAULT NULL,
        project_id TEXT DEFAULT NULL,
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now'))
      );
      CREATE TABLE messages (
        id TEXT PRIMARY KEY,
        conversation_id TEXT NOT NULL,
        parent_id TEXT,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        created_at TEXT DEFAULT (datetime('now'))
      );
      CREATE TABLE summaries (
        id TEXT PRIMARY KEY,
        conversation_id TEXT NOT NULL,
        summary TEXT NOT NULL,
        compacted_at TEXT DEFAULT (datetime('now')),
        last_message_order INTEGER NOT NULL,
        pre_compact_token_count INTEGER NOT NULL,
        anchor_message_id TEXT DEFAULT NULL
      );
      CREATE TABLE agent_runs (
        conversation_id TEXT PRIMARY KEY,
        status TEXT NOT NULL DEFAULT 'running',
        step_count INTEGER DEFAULT 0,
        accumulated_text TEXT DEFAULT '',
        tools_used TEXT DEFAULT '[]',
        error TEXT,
        pending_approval_id TEXT,
        started_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now'))
      );
      CREATE TABLE stream_chunks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        conversation_id TEXT NOT NULL,
        sequence INTEGER NOT NULL,
        chunk_data TEXT NOT NULL,
        created_at TEXT DEFAULT (datetime('now'))
      );
      CREATE TABLE agent_status (
        agent_id TEXT PRIMARY KEY,
        is_busy INTEGER NOT NULL DEFAULT 0,
        current_todo_id TEXT,
        updated_at TEXT DEFAULT (datetime('now'))
      );
      CREATE TABLE suspended_agent_states (
        conversation_id TEXT PRIMARY KEY,
        suspended_state TEXT NOT NULL,
        created_at TEXT NOT NULL,
        expires_at TEXT NOT NULL
      );
      INSERT INTO conversations (id, head_message_id, revision) VALUES ('legacy', 'a1', 7);
      INSERT INTO messages (id, conversation_id, parent_id, role, content)
        VALUES ('u1', 'legacy', NULL, 'user', '${JSON.stringify(msg('u1', 'user', 'legacy')).replace(/'/g, "''")}');
      INSERT INTO messages (id, conversation_id, parent_id, role, content)
        VALUES ('a1', 'legacy', 'u1', 'assistant', '${JSON.stringify(msg('a1', 'assistant', 'answer')).replace(/'/g, "''")}');
      INSERT INTO summaries (id, conversation_id, summary, last_message_order, pre_compact_token_count, anchor_message_id)
        VALUES ('s1', 'legacy', 'legacy summary', 1, 10, 'a1');
      PRAGMA user_version = 13;
    `);
    db.close();

    store = createSQLiteDataStore({ dataDir: tmpDir });
    const conversation = store.conversationStore.getConversation('legacy');
    expect(conversation?.activeBranchId).toBe('main:legacy');
    expect(store.branchStore.getBranch('main:legacy')).toMatchObject({
      name: '主分支', tipMessageId: 'a1', createdBy: 'migration',
    });
    expect(store.summaryStore.getSummaryByConversation('legacy')?.branchId).toBe('main:legacy');
  });

  it('requires archiving instead of deleting governed branch history', () => {
    const main = store.branchStore.ensureMainBranch('c1');
    const branch = store.branchStore.createBranch({
      conversationId: 'c1', parentBranchId: null, forkMessageId: null, tipMessageId: null, status: 'active',
    });
    store.conversationRunStore.createRun({ id: 'governed-run', conversationId: 'c1', branchId: branch.id });
    expect(() => store.branchStore.deleteBranch(branch.id)).toThrow('run history');
    expect(store.branchStore.updateBranch(branch.id, { status: 'archived' })?.status).toBe('archived');
    expect(store.branchStore.getBranch(main.id)).not.toBeNull();
  });

  it('isolates summaries by active branch', () => {
    const main = store.branchStore.ensureMainBranch('c1');
    store.summaryStore.saveSummary('c1', 'main summary', 0, 10, null);
    const branch = store.branchStore.createBranch({
      conversationId: 'c1', parentBranchId: main.id, forkMessageId: null, tipMessageId: null, status: 'active',
    });
    store.branchStore.switchBranch('c1', branch.id);
    store.summaryStore.saveSummary('c1', 'branch summary', 0, 10, null);
    expect(store.summaryStore.getSummaryByConversation('c1')?.summary).toBe('branch summary');
    store.branchStore.switchBranch('c1', main.id);
    expect(store.summaryStore.getSummaryByConversation('c1')?.summary).toBe('main summary');
  });
});
