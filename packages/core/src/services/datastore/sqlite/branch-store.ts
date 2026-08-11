import type { UIMessage } from 'ai';
import { nanoid } from 'nanoid';
import type {
  BranchStore,
  ConversationBranch,
  ConversationBranchStatus,
  ConversationBranchSummary,
  ConversationCommand,
  ConversationCommandResult,
  ConversationProjection,
  MessageStore,
  SqliteDatabase,
} from '../../../primitives/datastore/types';

interface BranchRow {
  id: string;
  conversation_id: string;
  parent_branch_id: string | null;
  fork_message_id: string | null;
  tip_message_id: string | null;
  name: string | null;
  status: ConversationBranchStatus;
  is_pinned: number;
  created_by: string;
  created_at: string;
  updated_at: string;
}

function mapBranch(row: BranchRow): ConversationBranch {
  return {
    id: row.id,
    conversationId: row.conversation_id,
    parentBranchId: row.parent_branch_id,
    forkMessageId: row.fork_message_id,
    tipMessageId: row.tip_message_id,
    name: row.name,
    status: row.status,
    isPinned: row.is_pinned === 1,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export class SQLiteBranchStore implements BranchStore {
  constructor(
    private db: SqliteDatabase,
    private messageStore: MessageStore,
  ) {}

  ensureMainBranch(conversationId: string): ConversationBranch {
    const active = this.db.prepare(
      `SELECT b.* FROM conversation_branches b
       JOIN conversations c ON c.active_branch_id = b.id
       WHERE c.id = ?`
    ).get(conversationId) as BranchRow | undefined;
    if (active) return mapBranch(active);

    const existing = this.db.prepare(
      `SELECT * FROM conversation_branches
       WHERE conversation_id = ? ORDER BY created_at ASC LIMIT 1`
    ).get(conversationId) as BranchRow | undefined;
    if (existing) {
      this.db.prepare('UPDATE conversations SET active_branch_id = ? WHERE id = ?')
        .run(existing.id, conversationId);
      return mapBranch(existing);
    }

    const conversation = this.db.prepare(
      'SELECT head_message_id FROM conversations WHERE id = ?'
    ).get(conversationId) as { head_message_id: string | null } | undefined;
    if (!conversation) throw new Error(`Conversation ${conversationId} not found`);

    const branch = this.createBranch({
      conversationId,
      parentBranchId: null,
      forkMessageId: null,
      tipMessageId: conversation.head_message_id,
      name: '主分支',
      status: 'active',
      createdBy: 'system',
    });
    this.db.prepare('UPDATE conversations SET active_branch_id = ? WHERE id = ?')
      .run(branch.id, conversationId);
    this.db.prepare('UPDATE messages SET branch_id = ? WHERE conversation_id = ? AND branch_id IS NULL')
      .run(branch.id, conversationId);
    return branch;
  }

  getBranch(branchId: string): ConversationBranch | null {
    const row = this.db.prepare('SELECT * FROM conversation_branches WHERE id = ?')
      .get(branchId) as BranchRow | undefined;
    return row ? mapBranch(row) : null;
  }

  listBranches(conversationId: string, includeArchived = false): ConversationBranch[] {
    const rows = this.db.prepare(
      `SELECT * FROM conversation_branches
       WHERE conversation_id = ?${includeArchived ? '' : " AND status != 'archived'"}
       ORDER BY is_pinned DESC, created_at ASC`
    ).all(conversationId) as unknown as BranchRow[];
    return rows.map(mapBranch);
  }

  createBranch(input: {
    conversationId: string;
    parentBranchId: string | null;
    forkMessageId: string | null;
    tipMessageId: string | null;
    name?: string;
    status?: ConversationBranchStatus;
    createdBy?: string;
  }): ConversationBranch {
    if (input.parentBranchId) this.assertBranch(input.conversationId, input.parentBranchId);
    if (input.forkMessageId) this.assertMessage(input.conversationId, input.forkMessageId);
    if (input.tipMessageId) this.assertMessage(input.conversationId, input.tipMessageId);
    const id = nanoid();
    this.db.prepare(
      `INSERT INTO conversation_branches
         (id, conversation_id, parent_branch_id, fork_message_id, tip_message_id, name, status, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      id,
      input.conversationId,
      input.parentBranchId,
      input.forkMessageId,
      input.tipMessageId,
      input.name ?? null,
      input.status ?? 'candidate',
      input.createdBy ?? 'user',
    );
    this.bumpRevision(input.conversationId);
    return this.getBranch(id)!;
  }

  updateBranch(branchId: string, update: {
    name?: string | null;
    status?: ConversationBranchStatus;
    isPinned?: boolean;
    tipMessageId?: string | null;
  }): ConversationBranch | null {
    const branch = this.getBranch(branchId);
    if (!branch) return null;
    if (update.tipMessageId) this.assertMessage(branch.conversationId, update.tipMessageId);
    if (update.status === 'archived') {
      const active = this.db.prepare('SELECT active_branch_id FROM conversations WHERE id = ?')
        .get(branch.conversationId) as { active_branch_id: string | null } | undefined;
      if (active?.active_branch_id === branchId) {
        throw new Error('Cannot archive the active branch');
      }
    }
    this.db.prepare(
      `UPDATE conversation_branches
       SET name = ?, status = ?, is_pinned = ?, tip_message_id = ?, updated_at = datetime('now')
       WHERE id = ?`
    ).run(
      update.name === undefined ? branch.name : update.name,
      update.status ?? branch.status,
      update.isPinned === undefined ? Number(branch.isPinned) : Number(update.isPinned),
      update.tipMessageId === undefined ? branch.tipMessageId : update.tipMessageId,
      branchId,
    );
    this.bumpRevision(branch.conversationId);
    return this.getBranch(branchId);
  }

  deleteBranch(branchId: string): boolean {
    const branch = this.getBranch(branchId);
    if (!branch) return false;
    const active = this.db.prepare('SELECT active_branch_id FROM conversations WHERE id = ?')
      .get(branch.conversationId) as { active_branch_id: string | null } | undefined;
    if (active?.active_branch_id === branchId) {
      throw new Error('Cannot delete the active branch');
    }
    const child = this.db.prepare('SELECT id FROM conversation_branches WHERE parent_branch_id = ? LIMIT 1')
      .get(branchId);
    if (child) throw new Error('Cannot delete a branch that has child branches');
    const run = this.db.prepare('SELECT id FROM conversation_runs WHERE branch_id = ? LIMIT 1').get(branchId);
    if (run) throw new Error('Cannot delete a branch with run history; archive it instead');
    const summary = this.db.prepare('SELECT id FROM summaries WHERE branch_id = ? LIMIT 1').get(branchId);
    if (summary) throw new Error('Cannot delete a branch with checkpoints; archive it instead');
    this.db.prepare('UPDATE messages SET branch_id = NULL WHERE branch_id = ?').run(branchId);
    const result = this.db.prepare('DELETE FROM conversation_branches WHERE id = ?').run(branchId);
    if (result.changes > 0) this.bumpRevision(branch.conversationId);
    return result.changes > 0;
  }

  switchBranch(conversationId: string, branchId: string): boolean {
    const branch = this.assertBranch(conversationId, branchId);
    if (branch.status === 'archived') throw new Error('Archived branch cannot be activated');
    const transaction = this.db.transaction(() => {
      this.db.prepare(
        `UPDATE conversations SET active_branch_id = ?, head_message_id = ?,
         revision = revision + 1, updated_at = datetime('now') WHERE id = ?`
      ).run(branchId, branch.tipMessageId, conversationId);
      if (branch.forkMessageId && branch.tipMessageId) {
        this.saveSelection(conversationId, branch.forkMessageId, this.firstChildAfterFork(branch));
      }
      return true;
    });
    return transaction();
  }

  getProjection(
    conversationId: string,
    options: { includeMessages?: boolean; includeTree?: boolean } = {},
  ): ConversationProjection {
    const conversation = this.db.prepare(
      'SELECT revision, active_branch_id, head_message_id FROM conversations WHERE id = ?'
    ).get(conversationId) as {
      revision: number;
      active_branch_id: string | null;
      head_message_id: string | null;
    } | undefined;
    if (!conversation) {
      return {
        revision: 0,
        activeBranchId: null,
        activeTipId: null,
        messages: [],
        tree: { revision: 0, activeTipId: null, nodes: [] },
        branches: [],
      };
    }

    // 确保主分支存在（对话已存在但可能还没有 active_branch_id）
    const main = this.ensureMainBranch(conversationId);
    // 重新读 conversation（ensureMainBranch 可能更新了 active_branch_id）
    const updated = this.db.prepare(
      'SELECT revision, active_branch_id, head_message_id FROM conversations WHERE id = ?'
    ).get(conversationId) as {
      revision: number;
      active_branch_id: string | null;
      head_message_id: string | null;
    } | undefined;
    const conv = updated ?? conversation;

    const branches: ConversationBranchSummary[] = this.listBranches(conversationId, true).map((branch) => {
      const count = this.db.prepare('SELECT COUNT(*) AS count FROM messages WHERE branch_id = ?')
        .get(branch.id) as { count: number };
      const tip = branch.tipMessageId
        ? this.db.prepare('SELECT content FROM messages WHERE id = ?').get(branch.tipMessageId) as { content: string } | undefined
        : undefined;
      return {
        ...branch,
        preview: tip ? this.preview(tip.content) : branch.id === main.id ? '新对话' : '空分支',
        messageCount: Number(count.count),
        isCurrent: branch.id === conv.active_branch_id,
      };
    });
    return {
      revision: conv.revision,
      activeBranchId: conv.active_branch_id,
      activeTipId: conv.head_message_id,
      // messages/tree 默认惰性：多数调用方只取标量字段，
      // 全量投影（含 messages/tree）对大会话要全表读巨列 + 树自连接，按需显式请求
      messages: options.includeMessages
        ? this.messageStore.getMessagesByConversation(conversationId)
        : [],
      tree: options.includeTree
        ? this.messageStore.getConversationTree(conversationId)
        : { revision: 0, activeTipId: null, nodes: [] },
      branches,
    };
  }

  executeCommand(conversationId: string, command: ConversationCommand): ConversationCommandResult {
    this.ensureMainBranch(conversationId);
    const transaction = this.db.transaction(() => {
      let branchId = command.type === 'fork' ? command.sourceBranchId : command.branchId;
      let headMessageId: string | null = null;

      if (command.type === 'append') {
        const branch = this.assertBranch(conversationId, command.branchId);
        if (branch.tipMessageId !== command.expectedTipId) {
          throw new Error(`Branch tip conflict: expected ${command.expectedTipId}, actual ${branch.tipMessageId}`);
        }
        this.switchBranchWithoutRevision(conversationId, branch);
        headMessageId = this.messageStore.commitUserMessage(conversationId, command.message);
      } else if (command.type === 'regenerate') {
        const source = this.assertBranch(conversationId, command.branchId);
        this.assertMessage(conversationId, command.messageId);
        const candidate = this.createBranchWithoutRevision({
          conversationId,
          parentBranchId: source.id,
          forkMessageId: command.messageId,
          tipMessageId: command.messageId,
          status: 'candidate',
        });
        branchId = candidate.id;
        this.switchBranchWithoutRevision(conversationId, candidate);
        headMessageId = command.messageId;
      } else if (command.type === 'edit') {
        const source = this.assertBranch(conversationId, command.branchId);
        this.assertMessage(conversationId, command.messageId);
        const parent = this.db.prepare('SELECT parent_id FROM messages WHERE id = ?')
          .get(command.messageId) as { parent_id: string | null };
        const candidate = this.createBranchWithoutRevision({
          conversationId,
          parentBranchId: source.id,
          forkMessageId: parent.parent_id,
          tipMessageId: command.messageId,
          status: 'candidate',
        });
        branchId = candidate.id;
        // Activate the candidate before inserting the replacement so the new
        // immutable node belongs to the candidate and the source tip is untouched.
        this.switchBranchWithoutRevision(conversationId, candidate);
        headMessageId = this.messageStore.commitUserMessage(conversationId, {
          ...command.replacement,
          id: command.messageId,
        });
        this.db.prepare('UPDATE conversation_branches SET tip_message_id = ? WHERE id = ?')
          .run(headMessageId, candidate.id);
      } else if (command.type === 'fork') {
        const source = command.sourceBranchId
          ? this.assertBranch(conversationId, command.sourceBranchId)
          : this.ensureMainBranch(conversationId);
        this.assertMessage(conversationId, command.fromMessageId);

        // 如果 fork 点就是当前分支的 tip，复用当前分支即可，避免创建内容和锚点完全相同的重复分支
        if (source.tipMessageId === command.fromMessageId) {
          branchId = source.id;
          headMessageId = source.tipMessageId;
        } else {
          const branch = this.createBranchWithoutRevision({
            conversationId,
            parentBranchId: source.id,
            forkMessageId: command.fromMessageId,
            tipMessageId: command.fromMessageId,
            name: command.name,
            status: 'active',
          });
          branchId = branch.id;
          this.switchBranchWithoutRevision(conversationId, branch);
          headMessageId = command.fromMessageId;
        }
      } else {
        const branch = this.assertBranch(conversationId, command.branchId);
        this.switchBranchWithoutRevision(conversationId, branch);
        headMessageId = branch.tipMessageId;
      }

      const branch = this.getBranch(branchId);
      if (branch && headMessageId !== branch.tipMessageId) {
        this.db.prepare(
          `UPDATE conversation_branches SET tip_message_id = ?, updated_at = datetime('now') WHERE id = ?`
        ).run(headMessageId, branchId);
      }
      this.bumpRevision(conversationId);
      const revision = (this.db.prepare('SELECT revision FROM conversations WHERE id = ?')
        .get(conversationId) as { revision: number }).revision;
      return { branchId, headMessageId, revision };
    });
    return transaction();
  }

  private createBranchWithoutRevision(input: {
    conversationId: string;
    parentBranchId: string | null;
    forkMessageId: string | null;
    tipMessageId: string | null;
    name?: string;
    status: ConversationBranchStatus;
  }): ConversationBranch {
    const id = nanoid();
    this.db.prepare(
      `INSERT INTO conversation_branches
         (id, conversation_id, parent_branch_id, fork_message_id, tip_message_id, name, status, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'user')`
    ).run(id, input.conversationId, input.parentBranchId, input.forkMessageId, input.tipMessageId, input.name ?? null, input.status);
    return this.getBranch(id)!;
  }

  private switchBranchWithoutRevision(conversationId: string, branch: ConversationBranch): void {
    this.db.prepare(
      'UPDATE conversations SET active_branch_id = ?, head_message_id = ?, updated_at = datetime(\'now\') WHERE id = ?'
    ).run(branch.id, branch.tipMessageId, conversationId);
  }

  private assertBranch(conversationId: string, branchId: string): ConversationBranch {
    const branch = this.getBranch(branchId);
    if (!branch || branch.conversationId !== conversationId) {
      throw new Error(`Branch ${branchId} does not belong to conversation ${conversationId}`);
    }
    return branch;
  }

  private assertMessage(conversationId: string, messageId: string): void {
    const row = this.db.prepare('SELECT id FROM messages WHERE conversation_id = ? AND id = ?')
      .get(conversationId, messageId);
    if (!row) throw new Error(`Message ${messageId} does not belong to conversation ${conversationId}`);
  }

  private bumpRevision(conversationId: string): void {
    this.db.prepare('UPDATE conversations SET revision = revision + 1 WHERE id = ?').run(conversationId);
  }

  private saveSelection(conversationId: string, parentMessageId: string, childId: string | null): void {
    if (!childId) return;
    this.db.prepare(
      `INSERT INTO conversation_branch_selections
         (conversation_id, parent_message_id, selected_child_id)
       VALUES (?, ?, ?)
       ON CONFLICT(conversation_id, parent_message_id)
       DO UPDATE SET selected_child_id = excluded.selected_child_id, updated_at = datetime('now')`
    ).run(conversationId, parentMessageId, childId);
  }

  private firstChildAfterFork(branch: ConversationBranch): string | null {
    if (!branch.forkMessageId || !branch.tipMessageId || branch.forkMessageId === branch.tipMessageId) return null;
    const rows = this.db.prepare('SELECT id, parent_id FROM messages WHERE conversation_id = ?')
      .all(branch.conversationId) as unknown as { id: string; parent_id: string | null }[];
    const byId = new Map(rows.map((row) => [row.id, row]));
    let cursor = branch.tipMessageId;
    let child = cursor;
    while (cursor && cursor !== branch.forkMessageId) {
      child = cursor;
      cursor = byId.get(cursor)?.parent_id ?? '';
    }
    return cursor === branch.forkMessageId ? child : null;
  }

  private preview(content: string): string {
    try {
      const message = JSON.parse(content) as UIMessage;
      return message.parts.filter((part) => part.type === 'text')
        .map((part) => part.type === 'text' ? part.text : '')
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 160) || '非文本消息';
    } catch {
      return '无法预览的消息';
    }
  }
}
