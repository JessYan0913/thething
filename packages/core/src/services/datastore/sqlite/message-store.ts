// ============================================================
// SQLite Message Store — Immutable Message Tree
// ============================================================
// 存储模型（v11）：
//   - messages 行不可变、只 INSERT，parent_id 链接前一条消息（NULL = 会话根）
//   - 唯一可变状态是 conversations.head_message_id
//   - "当前历史" = 从 head 沿 parent 链走到根
//   - 重新生成/编辑重发 = 移动 head（旧分支原样保留，成为孤儿分支）
//   - 过期运行的写入只会挂出没人指向的分叉，天然无害，无需时序守卫
//
// 三个写原语：
//   commitUserMessage  用户消息（普通发送 / regenerate / 编辑重发 三种语义）
//   appendMessages     assistant 回答追加（head CAS：锚点不再是 head 则不动 head）
//   replaceConversation 开发工具语义：整会话重建为线性链（丢弃分支）

import type { UIMessage } from 'ai';
import type { SqliteDatabase } from '../../../primitives/datastore/types';
import type { MessageStore } from '../../../primitives/datastore/types';
import { nanoid } from 'nanoid';
import type { ConversationStore } from '../../../primitives/datastore/types';
import { logger } from '../../../primitives/logger';

interface MessageRow {
  id: string;
  parent_id: string | null;
  content: string;
}

/**
 * SQLite-based MessageStore implementation (immutable tree)
 */
export class SQLiteMessageStore implements MessageStore {
  constructor(
    private db: SqliteDatabase,
    private conversationStore: ConversationStore
  ) {}

  getMessagesByConversation(conversationId: string): UIMessage[] {
    const head = this.getHead(conversationId);
    if (!head) return [];

    // 一次读出全会话消息，在内存里沿 parent 链回溯（避免递归 SQL，规模上完全够用）
    const rows = this.db
      .prepare('SELECT id, parent_id, content FROM messages WHERE conversation_id = ?')
      .all(conversationId) as unknown as MessageRow[];
    const byId = new Map(rows.map((r) => [r.id, r]));

    const path: UIMessage[] = [];
    let cursor: string | null = head;
    while (cursor) {
      const row = byId.get(cursor);
      if (!row) {
        logger.warn('MessageStore', `Broken parent chain in ${conversationId} at ${cursor}`);
        break;
      }
      path.push(JSON.parse(row.content) as UIMessage);
      cursor = row.parent_id;
    }
    return path.reverse();
  }

  commitUserMessage(conversationId: string, message: UIMessage): string {
    const transaction = this.db.transaction(() => {
      this.ensureConversation(conversationId, [message]);
      const msg = { ...message, id: message.id || nanoid() };

      const existing = this.db
        .prepare('SELECT id, parent_id, content FROM messages WHERE conversation_id = ? AND id = ?')
        .get(conversationId, msg.id) as MessageRow | undefined;

      let headId: string;
      if (!existing) {
        // 普通发送：作为 head 的孩子插入
        this.insertNode(conversationId, msg, this.getHead(conversationId));
        headId = msg.id;
      } else if (JSON.stringify((JSON.parse(existing.content) as UIMessage).parts) === JSON.stringify(msg.parts)) {
        // regenerate：内容未变，head 移回该节点即可（其后的旧回答成为孤儿分支）
        headId = msg.id;
      } else {
        // 编辑重发：同 parent 下插入新节点（新 id），旧版本连同其子树完整保留
        const edited = { ...msg, id: nanoid() };
        this.insertNode(conversationId, edited, existing.parent_id);
        headId = edited.id;
      }

      this.setHead(conversationId, headId);
      this.invalidateSummaryIfAnchorOffPath(conversationId);
      return headId;
    });
    return transaction();
  }

  appendMessages(conversationId: string, messages: UIMessage[], afterMessageId?: string): boolean {
    if (messages.length === 0) return true;
    const transaction = this.db.transaction(() => {
      this.ensureConversation(conversationId, messages);
      const anchor = afterMessageId ?? this.getHead(conversationId);

      let parentId: string | null = anchor;
      for (const message of messages) {
        const msg = { ...message, id: message.id || nanoid() };

        // 同内容去重：同一 parent 下已有相同 parts 的消息 → 复用而非重复插入
        const dupId = this.findDupByContent(conversationId, parentId, msg);
        if (dupId) {
          logger.debug('MessageStore', `appendMessages: skip duplicate (same parts as ${dupId}) under ${parentId ?? 'root'}`);
          parentId = dupId;
          continue;
        }

        this.insertNode(conversationId, msg, parentId);
        parentId = msg.id;
      }

      // head CAS：仅当 head 仍指向锚点时才推进。
      // 被顶替的旧运行到这里 head 早已移走 → 新写入的链只是孤儿分支，直接返回 false。
      const currentHead = this.getHead(conversationId);
      if (currentHead !== anchor) {
        logger.debug(
          'MessageStore',
          `appendMessages: head moved (${anchor} → ${currentHead}), new chain left as orphan branch`
        );
        return false;
      }
      this.setHead(conversationId, parentId);
      return true;
    });
    return transaction();
  }

  replaceConversation(conversationId: string, messages: UIMessage[]): void {
    // 破坏性重建为单一线性链：仅供 workbench PATCH / CLI 会话保存使用
    const transaction = this.db.transaction(() => {
      this.ensureConversation(conversationId, messages);
      this.db.prepare('DELETE FROM messages WHERE conversation_id = ?').run(conversationId);

      const seenIds = new Set<string>();
      let parentId: string | null = null;
      for (const message of messages) {
        let msg = { ...message, id: message.id || nanoid() };
        if (seenIds.has(msg.id)) {
          logger.warn('MessageStore', `replaceConversation: duplicate id ${msg.id}, reassigning`);
          msg = { ...msg, id: nanoid() };
        }
        seenIds.add(msg.id);
        this.insertNode(conversationId, msg, parentId);
        parentId = msg.id;
      }
      this.setHead(conversationId, parentId);
      this.invalidateSummaryIfAnchorOffPath(conversationId);
    });
    transaction();
  }

  // ── 分支查询 / 切换 ─────────────────────────────────────────

  getBranchInfo(conversationId: string): {
    branches: Record<string, string[]>;
    headChildId: string | null;
  } {
    const branches: Record<string, string[]> = {};
    const head = this.getHead(conversationId);
    if (!head) return { branches, headChildId: null };

    const activePath = this.getMessagesByConversation(conversationId);
    // 兄弟按 rowid（插入顺序）排列，created_at 秒级精度在快速重发时会并列
    const siblingsStmt = this.db.prepare(
      `SELECT id FROM messages
         WHERE conversation_id = ? AND parent_id IS ? ORDER BY rowid ASC`
    );

    let parentOfCurrent: string | null = null;
    for (const msg of activePath) {
      const siblings = (siblingsStmt.all(conversationId, parentOfCurrent) as unknown as { id: string }[])
        .map((r) => r.id);
      if (siblings.length > 1) {
        branches[msg.id] = siblings;
      }
      parentOfCurrent = msg.id;
    }

    // head 处于分叉点（非叶子）时，给出回到"之后消息"的入口：head 的最新孩子
    const headChildren = (siblingsStmt.all(conversationId, head) as unknown as { id: string }[]);
    const headChildId = headChildren.length > 0 ? headChildren[headChildren.length - 1].id : null;

    return { branches, headChildId };
  }

  switchHead(conversationId: string, messageId: string, descendToTip = true): boolean {
    const transaction = this.db.transaction(() => {
      const target = this.db
        .prepare('SELECT id FROM messages WHERE conversation_id = ? AND id = ?')
        .get(conversationId, messageId);
      if (!target) return false;

      let tip = messageId;
      if (descendToTip) {
        // 沿"每层最新的孩子"下行到叶子——恢复该分支上最后的对话位置
        const childStmt = this.db.prepare(
          `SELECT id FROM messages
             WHERE conversation_id = ? AND parent_id = ? ORDER BY rowid DESC LIMIT 1`
        );
        for (;;) {
          const child = childStmt.get(conversationId, tip) as { id: string } | undefined;
          if (!child) break;
          tip = child.id;
        }
      }

      this.setHead(conversationId, tip);
      this.invalidateSummaryIfAnchorOffPath(conversationId);
      return true;
    });
    return transaction();
  }

  // ── private helpers ─────────────────────────────────────────

  private insertNode(conversationId: string, msg: UIMessage, parentId: string | null): void {
    this.db
      .prepare(
        'INSERT INTO messages (id, conversation_id, parent_id, role, content) VALUES (?, ?, ?, ?, ?)'
      )
      .run(msg.id, conversationId, parentId, msg.role, JSON.stringify(msg));
  }

  /** 同 parent 下查同内容消息，用于 appendMessages 去重 */
  private findDupByContent(conversationId: string, parentId: string | null, msg: UIMessage): string | null {
    const rows = parentId !== null
      ? this.db
          .prepare('SELECT id, content FROM messages WHERE conversation_id = ? AND parent_id = ?')
          .all(conversationId, parentId) as { id: string; content: string }[]
      : this.db
          .prepare('SELECT id, content FROM messages WHERE conversation_id = ? AND parent_id IS NULL')
          .all(conversationId) as { id: string; content: string }[];

    const msgPartsJson = JSON.stringify(msg.parts);
    for (const row of rows) {
      try {
        const existing = JSON.parse(row.content) as UIMessage;
        if (existing.role === msg.role && JSON.stringify(existing.parts) === msgPartsJson) {
          return row.id;
        }
      } catch { /* malformed content, skip */ }
    }
    return null;
  }

  private getHead(conversationId: string): string | null {
    const row = this.db
      .prepare('SELECT head_message_id FROM conversations WHERE id = ?')
      .get(conversationId) as { head_message_id: string | null } | undefined;
    return row?.head_message_id ?? null;
  }

  private setHead(conversationId: string, messageId: string | null): void {
    this.db
      .prepare(
        "UPDATE conversations SET head_message_id = ?, updated_at = datetime('now') WHERE id = ?"
      )
      .run(messageId, conversationId);
  }

  /** compaction 摘要锚点已不在活跃路径上 → 删除摘要（防"幽灵历史"混入增量摘要） */
  private invalidateSummaryIfAnchorOffPath(conversationId: string): void {
    try {
      const summary = this.db
        .prepare(
          `SELECT anchor_message_id FROM summaries
             WHERE conversation_id = ? ORDER BY compacted_at DESC LIMIT 1`
        )
        .get(conversationId) as { anchor_message_id: string | null } | undefined;
      if (!summary?.anchor_message_id) return;

      const activeIds = new Set(
        this.getMessagesByConversation(conversationId).map((m) => m.id)
      );
      if (!activeIds.has(summary.anchor_message_id)) {
        this.db.prepare('DELETE FROM summaries WHERE conversation_id = ?').run(conversationId);
        logger.debug(
          'MessageStore',
          `Invalidated compaction summary for ${conversationId}: anchor ${summary.anchor_message_id} off active path`
        );
      }
    } catch (err) {
      logger.warn('MessageStore', `Summary invalidation check failed: ${err}`);
    }
  }

  private ensureConversation(conversationId: string, messages: UIMessage[]): void {
    const existing = this.conversationStore.getConversation(conversationId);
    if (existing) return;
    // Auto-generate title from first user message
    const firstUserMessage = messages.find((m) => m.role === 'user');
    const title = firstUserMessage
      ? firstUserMessage.parts
          .filter((p) => p.type === 'text')
          .map((p) => (p.type === 'text' ? p.text : ''))
          .join('')
          .slice(0, 50) || 'New Conversation'
      : 'New Conversation';
    this.conversationStore.createConversation(conversationId, title, { source: 'user' });
  }
}
