import Database from 'better-sqlite3';
import { v4 as uuidv4 } from 'uuid';
import type {
  Stream,
  StreamChunk,
  StreamData,
  StreamStatus,
  DatabaseConfig,
} from './types.js';

/**
 * SQLite 数据库操作类
 */
export class StreamDatabase {
  private db: Database.Database;
  private defaultTtlMs: number;

  constructor(config: DatabaseConfig) {
    this.db = new Database(config.path);
    this.defaultTtlMs = config.defaultTtlMs ?? 24 * 60 * 60 * 1000; // 24 小时

    this.initialize();
  }

  /**
   * 初始化数据库表
   */
  private initialize(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS streams (
        id TEXT PRIMARY KEY,
        chat_id TEXT NOT NULL,
        status TEXT DEFAULT 'active',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        expires_at DATETIME NOT NULL
      );

      CREATE TABLE IF NOT EXISTS stream_chunks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        stream_id TEXT NOT NULL,
        type TEXT NOT NULL,
        data TEXT NOT NULL,
        timestamp INTEGER NOT NULL,
        sequence INTEGER NOT NULL,
        FOREIGN KEY (stream_id) REFERENCES streams(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_streams_chat_id ON streams(chat_id);
      CREATE INDEX IF NOT EXISTS idx_streams_status ON streams(status);
      CREATE INDEX IF NOT EXISTS idx_streams_expires ON streams(expires_at);
      CREATE INDEX IF NOT EXISTS idx_stream_chunks_stream_id ON stream_chunks(stream_id);
      CREATE INDEX IF NOT EXISTS idx_stream_chunks_sequence ON stream_chunks(stream_id, sequence);
    `);

    // 启用外键约束
    this.db.pragma('foreign_keys = ON');
  }

  /**
   * 创建新流
   */
  createStream(chatId: string, ttlMs?: number): Stream {
    const id = uuidv4();
    const now = new Date();
    const expiresAt = new Date(now.getTime() + (ttlMs ?? this.defaultTtlMs));

    const stmt = this.db.prepare(`
      INSERT INTO streams (id, chat_id, status, created_at, updated_at, expires_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `);

    stmt.run(id, chatId, 'active', now.toISOString(), now.toISOString(), expiresAt.toISOString());

    return {
      id,
      chatId,
      status: 'active',
      createdAt: now,
      updatedAt: now,
      expiresAt,
    };
  }

  /**
   * 获取流信息
   */
  getStream(streamId: string): Stream | null {
    const stmt = this.db.prepare(`
      SELECT id, chat_id, status, created_at, updated_at, expires_at
      FROM streams WHERE id = ?
    `);

    const row = stmt.get(streamId) as any;
    if (!row) return null;

    return {
      id: row.id,
      chatId: row.chat_id,
      status: row.status as StreamStatus,
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at),
      expiresAt: new Date(row.expires_at),
    };
  }

  /**
   * 获取流数据（包含所有数据块）
   */
  getStreamData(streamId: string): StreamData | null {
    const stream = this.getStream(streamId);
    if (!stream) return null;

    const chunks = this.getStreamChunks(streamId);

    return {
      ...stream,
      chunks,
    };
  }

  /**
   * 获取流的所有数据块
   */
  getStreamChunks(streamId: string, fromSequence?: number): StreamChunk[] {
    let sql = `
      SELECT type, data, timestamp, sequence
      FROM stream_chunks
      WHERE stream_id = ?
    `;
    const params: any[] = [streamId];

    if (fromSequence !== undefined) {
      sql += ' AND sequence > ?';
      params.push(fromSequence);
    }

    sql += ' ORDER BY sequence ASC';

    const stmt = this.db.prepare(sql);
    const rows = stmt.all(...params) as any[];

    return rows.map((row) => ({
      type: row.type,
      data: JSON.parse(row.data),
      timestamp: row.timestamp,
      sequence: row.sequence,
    }));
  }

  /**
   * 添加数据块到流
   */
  addChunk(streamId: string, chunk: Omit<StreamChunk, 'sequence'>): StreamChunk | null {
    const stream = this.getStream(streamId);
    if (!stream || stream.status !== 'active') {
      return null;
    }

    // 获取当前最大序号
    const maxSeqStmt = this.db.prepare(`
      SELECT COALESCE(MAX(sequence), 0) as max_seq
      FROM stream_chunks WHERE stream_id = ?
    `);
    const { max_seq } = maxSeqStmt.get(streamId) as any;
    const sequence = max_seq + 1;

    // 插入数据块
    const insertStmt = this.db.prepare(`
      INSERT INTO stream_chunks (stream_id, type, data, timestamp, sequence)
      VALUES (?, ?, ?, ?, ?)
    `);

    insertStmt.run(streamId, chunk.type, JSON.stringify(chunk.data), chunk.timestamp, sequence);

    // 更新流的更新时间
    const updateStmt = this.db.prepare(`
      UPDATE streams SET updated_at = ? WHERE id = ?
    `);
    updateStmt.run(new Date().toISOString(), streamId);

    return {
      ...chunk,
      sequence,
    };
  }

  /**
   * 更新流状态
   */
  updateStreamStatus(streamId: string, status: StreamStatus): boolean {
    const stmt = this.db.prepare(`
      UPDATE streams SET status = ?, updated_at = ? WHERE id = ?
    `);

    const result = stmt.run(status, new Date().toISOString(), streamId);
    return result.changes > 0;
  }

  /**
   * 完成流
   */
  completeStream(streamId: string): boolean {
    return this.updateStreamStatus(streamId, 'completed');
  }

  /**
   * 停止流
   */
  stopStream(streamId: string): boolean {
    return this.updateStreamStatus(streamId, 'stopped');
  }

  /**
   * 获取聊天的所有活跃流
   */
  getActiveStreamsByChatId(chatId: string): Stream[] {
    const stmt = this.db.prepare(`
      SELECT id, chat_id, status, created_at, updated_at, expires_at
      FROM streams
      WHERE chat_id = ? AND status = 'active'
      ORDER BY created_at DESC
    `);

    const rows = stmt.all(chatId) as any[];
    return rows.map((row) => ({
      id: row.id,
      chatId: row.chat_id,
      status: row.status as StreamStatus,
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at),
      expiresAt: new Date(row.expires_at),
    }));
  }

  /**
   * 清理过期流
   */
  cleanupExpiredStreams(): number {
    const now = new Date().toISOString();

    // 删除过期的流（级联删除数据块）
    const deleteStmt = this.db.prepare(`
      DELETE FROM streams WHERE expires_at < ?
    `);

    const result = deleteStmt.run(now);
    return result.changes;
  }

  /**
   * 删除流
   */
  deleteStream(streamId: string): boolean {
    const stmt = this.db.prepare(`
      DELETE FROM streams WHERE id = ?
    `);

    const result = stmt.run(streamId);
    return result.changes > 0;
  }

  /**
   * 获取流统计信息
   */
  getStats(): {
    totalStreams: number;
    activeStreams: number;
    completedStreams: number;
    stoppedStreams: number;
    totalChunks: number;
  } {
    const totalStreams = (this.db.prepare('SELECT COUNT(*) as count FROM streams').get() as any).count;
    const activeStreams = (this.db.prepare("SELECT COUNT(*) as count FROM streams WHERE status = 'active'").get() as any).count;
    const completedStreams = (this.db.prepare("SELECT COUNT(*) as count FROM streams WHERE status = 'completed'").get() as any).count;
    const stoppedStreams = (this.db.prepare("SELECT COUNT(*) as count FROM streams WHERE status = 'stopped'").get() as any).count;
    const totalChunks = (this.db.prepare('SELECT COUNT(*) as count FROM stream_chunks').get() as any).count;

    return {
      totalStreams,
      activeStreams,
      completedStreams,
      stoppedStreams,
      totalChunks,
    };
  }

  /**
   * 关闭数据库连接
   */
  close(): void {
    this.db.close();
  }
}
