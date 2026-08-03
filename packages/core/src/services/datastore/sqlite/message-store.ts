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
// 四个写原语：
//   commitUserMessage         用户消息（普通发送 / regenerate / 编辑重发 三种语义）
//   commitAssistantContinuation assistant 工具消息的不可变状态推进
//   appendMessages            assistant 回答追加（head CAS：锚点不再是 head 则不动 head）
//   replaceConversation       开发工具语义：整会话重建为线性链（丢弃分支）

import type { UIMessage } from 'ai';
import type {
  ConversationStore,
  ConversationTree,
  MessageStore,
  SqliteDatabase,
} from '../../../primitives/datastore/types';
import { nanoid } from 'nanoid';
import { logger } from '../../../primitives/logger';

interface MessageRow {
  id: string;
  parent_id: string | null;
  content: string;
}

interface TreeMessageRow extends MessageRow {
  role: 'user' | 'assistant' | 'system';
  created_at: string;
  child_count: number;
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

  getConversationTree(conversationId: string): ConversationTree {
    const transaction = this.db.transaction(() => {
      const conversation = this.db
        .prepare('SELECT head_message_id, revision FROM conversations WHERE id = ?')
        .get(conversationId) as { head_message_id: string | null; revision: number } | undefined;
      if (!conversation) return { revision: 0, activeTipId: null, nodes: [] };

      const rows = this.db
        .prepare(
          `SELECT m.id, m.parent_id, m.role, m.content, m.created_at,
                  COUNT(c.id) AS child_count
             FROM messages m
             LEFT JOIN messages c
               ON c.conversation_id = m.conversation_id AND c.parent_id = m.id
            WHERE m.conversation_id = ?
            GROUP BY m.id
            ORDER BY m.rowid ASC`
        )
        .all(conversationId) as unknown as TreeMessageRow[];

      const byId = new Map(rows.map((row) => [row.id, row]));
      const activeIds = new Set<string>();
      let cursor = conversation.head_message_id;
      while (cursor) {
        const row = byId.get(cursor);
        if (!row) break;
        activeIds.add(cursor);
        cursor = row.parent_id;
      }

      return {
        revision: conversation.revision,
        activeTipId: conversation.head_message_id,
        nodes: rows.map((row) => ({
          id: row.id,
          parentId: row.parent_id,
          role: row.role,
          preview: this.getMessagePreview(row.content),
          createdAt: row.created_at,
          childCount: Number(row.child_count),
          isActivePath: activeIds.has(row.id),
        })),
      };
    });
    return transaction();
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
      this.updateActiveBranchTip(conversationId, headId);
      this.bumpRevision(conversationId);
      this.invalidateSummaryIfAnchorOffPath(conversationId);
      return headId;
    });
    return transaction();
  }

  commitAssistantContinuation(conversationId: string, message: UIMessage): string {
    if (message.role !== 'assistant') {
      throw new Error('Assistant continuation must have role assistant');
    }

    const transaction = this.db.transaction(() => {
      const headId = this.getHead(conversationId);
      if (!headId) {
        throw new Error(`Assistant continuation has no active head in conversation ${conversationId}`);
      }
      const existing = this.db
        .prepare('SELECT id, parent_id, content FROM messages WHERE conversation_id = ? AND id = ?')
        .get(conversationId, headId) as MessageRow | undefined;
      if (!existing) {
        throw new Error(`Active assistant continuation head ${headId} is missing from conversation ${conversationId}`);
      }

      const previous = JSON.parse(existing.content) as UIMessage;
      if (previous.role !== 'assistant') {
        throw new Error(`Assistant continuation head ${headId} is not an assistant message`);
      }
      // 幂等：客户端自动续跑可能重复发送同一状态（双击/竞态），
      // parts 与 head 完全一致时直接复用当前版本，不再插入新节点
      if (JSON.stringify(previous.parts) === JSON.stringify(message.parts)) {
        return headId;
      }
      if (!this.hasMatchingToolCall(previous, message)) {
        const prevToolCalls = previous.parts
          .filter(p => (p as { toolCallId?: unknown }).toolCallId)
          .map(p => `${(p as { toolCallId: string }).toolCallId}=${(p as { state?: string }).state}`);
        const nextToolCalls = message.parts
          .filter(p => (p as { toolCallId?: unknown }).toolCallId)
          .map(p => `${(p as { toolCallId: string }).toolCallId}=${(p as { state?: string }).state}`);
        logger.error(
          'MessageStore',
          `commitAssistantContinuation: head ${headId} (${previous.id}) toolCalls=[${prevToolCalls.join(', ')}] ` +
          `incoming toolCalls=[${nextToolCalls.join(', ')}] ` +
          `head.parent_id=${existing.parent_id} head.role=${previous.role}`,
        );
        throw new Error(`Assistant continuation does not match the active tool call in conversation ${conversationId}`);
      }

      const continued = { ...message, id: nanoid() };
      this.insertNode(conversationId, continued, existing.parent_id);
      this.setHead(conversationId, continued.id);
      this.updateActiveBranchTip(conversationId, continued.id);
      this.bumpRevision(conversationId);
      return continued.id;
    });
    return transaction();
  }

  appendMessages(conversationId: string, messages: UIMessage[], afterMessageId?: string): boolean {
    if (messages.length === 0) return true;
    const transaction = this.db.transaction(() => {
      this.ensureConversation(conversationId, messages);
      const anchor = afterMessageId ?? this.getHead(conversationId);

      let parentId: string | null = anchor;
      let treeChanged = false;
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
        treeChanged = true;
        parentId = msg.id;
      }

      // head CAS：仅当 head 仍指向锚点时才推进。
      // 被顶替的旧运行到这里 head 早已移走 → 新写入的链只是孤儿分支，直接返回 false。
      const currentHead = this.getHead(conversationId);
      if (currentHead !== anchor) {
        if (treeChanged) this.bumpRevision(conversationId);
        logger.debug(
          'MessageStore',
          `appendMessages: head moved (${anchor} → ${currentHead}), new chain left as orphan branch`
        );
        return false;
      }
      this.setHead(conversationId, parentId);
      this.updateActiveBranchTip(conversationId, parentId);
      if (treeChanged || currentHead !== parentId) this.bumpRevision(conversationId);
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
      this.updateActiveBranchTip(conversationId, parentId);
      this.bumpRevision(conversationId);
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
    const activeBranchId = this.getActiveBranchId(conversationId);

    // 查 siblings 时带上 branch_id，用于区分 fork（不同分支的 user 消息不应显示为版本）
    const siblingsStmt = this.db.prepare(
      `SELECT m.id, m.role, m.branch_id FROM messages m
         WHERE m.conversation_id = ? AND m.parent_id IS ? ORDER BY m.rowid ASC`
    );

    let parentOfCurrent: string | null = null;
    for (const msg of activePath) {
      const allSiblings = (siblingsStmt.all(conversationId, parentOfCurrent) as unknown as {
        id: string; role: string; branch_id: string | null;
      }[]);

      // 对 user 消息按 branch_id 过滤：fork 产生的不同分支消息不应显示为版本切换
      // 对 assistant 消息保留全部：regenerate 产生的候选回答应该可切换
      const filtered = msg.role === 'user' && activeBranchId
        ? allSiblings.filter((s) => s.branch_id === activeBranchId || s.branch_id == null)
        : allSiblings;

      if (filtered.length > 1) {
        branches[msg.id] = filtered.map((s) => s.id);
      }
      parentOfCurrent = msg.id;
    }

    // head 处于分叉点（非叶子）时，给出回到"之后消息"的入口：head 的最新孩子
    const headChildren = (this.db.prepare(
      `SELECT id FROM messages WHERE conversation_id = ? AND parent_id = ? ORDER BY rowid ASC`
    ).all(conversationId, head) as unknown as { id: string }[]);
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
          `SELECT m.id FROM messages m
             LEFT JOIN conversation_branch_selections s
               ON s.conversation_id = m.conversation_id
              AND s.parent_message_id = m.parent_id
              AND s.selected_child_id = m.id
            WHERE m.conversation_id = ? AND m.parent_id = ?
            ORDER BY CASE WHEN s.selected_child_id IS NOT NULL THEN 0 ELSE 1 END,
                     m.rowid DESC LIMIT 1`
        );
        for (;;) {
          const child = childStmt.get(conversationId, tip) as { id: string } | undefined;
          if (!child) break;
          tip = child.id;
        }
      }

      this.setHead(conversationId, tip);
      this.updateActiveBranchTip(conversationId, tip);
      this.saveSelectedPath(conversationId, tip);
      this.bumpRevision(conversationId);
      this.invalidateSummaryIfAnchorOffPath(conversationId);
      return true;
    });
    return transaction();
  }

  // ── private helpers ─────────────────────────────────────────

  private insertNode(conversationId: string, msg: UIMessage, parentId: string | null): void {
    if (parentId) {
      const parent = this.db
        .prepare('SELECT id FROM messages WHERE conversation_id = ? AND id = ?')
        .get(conversationId, parentId);
      if (!parent) {
        throw new Error(`Parent message ${parentId} does not belong to conversation ${conversationId}`);
      }
    }
    const activeBranch = this.getActiveBranchId(conversationId);
    this.db
      .prepare(
        'INSERT INTO messages (id, conversation_id, parent_id, branch_id, role, content) VALUES (?, ?, ?, ?, ?, ?)'
      )
      .run(msg.id, conversationId, parentId, activeBranch, msg.role, JSON.stringify(msg));
  }

  /**
   * 流式客户端和服务端持久化可能为同一 assistant 消息分配不同 id。
   * continuation 只能匹配当前 head 上已有的同一个 toolCallId，避免任意 assistant 覆盖。
   *
   * 合法状态转移：
   *   approval-requested → approval-responded   （审批工具续跑）
   *   approval-responded → output-available/error（审批后执行结果）
   *   input-available → output-available/error   （客户端工具续跑，如 ask_user_question）
   *   output-available/error → 同状态           （续跑流结束后 onEnd 落库：工具 part 状态
   *                                              不变，但消息追加了新的 reasoning/text parts）
   */
  private hasMatchingToolCall(previous: UIMessage, next: UIMessage): boolean {
    const previousStates = new Map<string, unknown>();
    for (const part of previous.parts) {
      const toolPart = part as { toolCallId?: unknown; state?: unknown };
      if (typeof toolPart.toolCallId === 'string') {
        previousStates.set(toolPart.toolCallId, toolPart.state);
      }
    }

    return next.parts.some((part) => {
      const toolPart = part as { toolCallId?: unknown; state?: unknown };
      if (typeof toolPart.toolCallId !== 'string') return false;
      const previousState = previousStates.get(toolPart.toolCallId);
      // 客户端工具 (input-available → output-available/error)
      if (previousState === 'input-available') {
        return toolPart.state === 'output-available' || toolPart.state === 'output-error';
      }
      // 审批工具 (approval-requested → approval-responded → output-available/error)
      if (previousState === 'approval-requested' && toolPart.state === 'approval-responded') {
        return true;
      }
      if (previousState === 'approval-responded' &&
          (toolPart.state === 'output-available' || toolPart.state === 'output-error')) {
        return true;
      }
      // 同终态扩展（onEnd 落库续跑结果：同一 toolCallId 状态不变，消息新增其他 parts）
      if ((previousState === 'output-available' || previousState === 'output-error') &&
          toolPart.state === previousState) {
        return true;
      }
      return false;
    });
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

  private updateActiveBranchTip(conversationId: string, tipMessageId: string | null): void {
    this.db.prepare(
      `UPDATE conversation_branches SET tip_message_id = ?, updated_at = datetime('now')
       WHERE id = (SELECT active_branch_id FROM conversations WHERE id = ?)`
    ).run(tipMessageId, conversationId);
  }

  private saveSelectedPath(conversationId: string, tipMessageId: string): void {
    const rows = this.db.prepare(
      'SELECT id, parent_id FROM messages WHERE conversation_id = ?'
    ).all(conversationId) as unknown as { id: string; parent_id: string | null }[];
    const byId = new Map(rows.map((row) => [row.id, row]));
    const pairs: Array<{ parentId: string; childId: string }> = [];
    let cursor: string | null = tipMessageId;
    while (cursor) {
      const row = byId.get(cursor);
      if (!row) break;
      if (row.parent_id) pairs.push({ parentId: row.parent_id, childId: row.id });
      cursor = row.parent_id;
    }
    const statement = this.db.prepare(
      `INSERT INTO conversation_branch_selections
         (conversation_id, parent_message_id, selected_child_id)
       VALUES (?, ?, ?)
       ON CONFLICT(conversation_id, parent_message_id)
       DO UPDATE SET selected_child_id = excluded.selected_child_id, updated_at = datetime('now')`
    );
    for (const pair of pairs) statement.run(conversationId, pair.parentId, pair.childId);
  }

  private getActiveBranchId(conversationId: string): string | null {
    const row = this.db.prepare('SELECT active_branch_id FROM conversations WHERE id = ?')
      .get(conversationId) as { active_branch_id: string | null } | undefined;
    return row?.active_branch_id ?? null;
  }

  private bumpRevision(conversationId: string): void {
    this.db
      .prepare('UPDATE conversations SET revision = revision + 1 WHERE id = ?')
      .run(conversationId);
  }

  private getMessagePreview(content: string): string {
    try {
      const message = JSON.parse(content) as UIMessage;
      const text = message.parts
        ?.filter((part) => part.type === 'text')
        .map((part) => part.type === 'text' ? part.text : '')
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim();
      if (text) return text.slice(0, 160);
      const file = message.parts?.find((part) => part.type === 'file') as { filename?: string } | undefined;
      if (file) return file.filename ? `附件：${file.filename}` : '附件';
      return message.role === 'assistant' ? '助手消息' : message.role === 'user' ? '用户消息' : '系统消息';
    } catch {
      return '无法预览的消息';
    }
  }

  /** compaction 摘要锚点已不在活跃路径上 → 删除摘要（防"幽灵历史"混入增量摘要） */
  private invalidateSummaryIfAnchorOffPath(conversationId: string): void {
    try {
      const activeBranchId = this.getActiveBranchId(conversationId);
      const summary = activeBranchId
        ? this.db
            .prepare(
              `SELECT anchor_message_id FROM summaries
                 WHERE conversation_id = ? AND branch_id = ?
                 ORDER BY compacted_at DESC LIMIT 1`
            )
            .get(conversationId, activeBranchId) as { anchor_message_id: string | null } | undefined
        : this.db
            .prepare(
              `SELECT anchor_message_id FROM summaries
                 WHERE conversation_id = ? AND branch_id IS NULL
                 ORDER BY compacted_at DESC LIMIT 1`
            )
            .get(conversationId) as { anchor_message_id: string | null } | undefined;
      if (!summary?.anchor_message_id) return;

      const activeIds = new Set(
        this.getMessagesByConversation(conversationId).map((m) => m.id)
      );
      if (!activeIds.has(summary.anchor_message_id)) {
        if (activeBranchId) {
          this.db.prepare('DELETE FROM summaries WHERE conversation_id = ? AND branch_id = ?')
            .run(conversationId, activeBranchId);
        } else {
          this.db.prepare('DELETE FROM summaries WHERE conversation_id = ? AND branch_id IS NULL')
            .run(conversationId);
        }
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
