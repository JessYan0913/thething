import { getDb } from '../db';
import type { MemoryType } from './memory-types';
import { scanMemoryFiles } from './memory-scan';
import { nanoid } from 'nanoid';

export interface MemoryRecord {
  id: string;
  ownerType: 'user' | 'team' | 'project';
  ownerId: string;
  memoryType: MemoryType;
  name: string;
  description: string | null;
  filePath: string;
  createdAt: string;
  updatedAt: string;
  recallCount: number;
  lastRecalledAt: string | null;
}

export function createMemoryRecord(params: {
  ownerType: 'user' | 'team' | 'project';
  ownerId: string;
  memoryType: MemoryType;
  name: string;
  description: string | null;
  filePath: string;
}): string {
  const db = getDb();
  const id = nanoid();

  db.prepare(`
    INSERT INTO memories (id, owner_type, owner_id, memory_type, name, description, file_path)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(id, params.ownerType, params.ownerId, params.memoryType, params.name, params.description, params.filePath);

  return id;
}

export function getMemoriesByOwner(ownerType: string, ownerId: string): MemoryRecord[] {
  const db = getDb();
  const rows = db.prepare(`
    SELECT *, (SELECT COUNT(*) FROM memory_usage WHERE memory_id = memories.id) as usage_count
    FROM memories
    WHERE owner_type = ? AND owner_id = ?
    ORDER BY updated_at DESC
  `).all(ownerType, ownerId) as Array<Record<string, unknown>>;

  return rows.map(mapMemoryRow);
}

export function recordMemoryRecall(memoryId: string, conversationId?: string): void {
  const db = getDb();
  const id = nanoid();

  const tx = db.transaction(() => {
    db.prepare(`
      INSERT INTO memory_usage (id, memory_id, conversation_id)
      VALUES (?, ?, ?)
    `).run(id, memoryId, conversationId || null);

    db.prepare(`
      UPDATE memories
      SET recall_count = recall_count + 1, last_recalled_at = datetime('now')
      WHERE id = ?
    `).run(memoryId);
  });

  tx();
}

export function updateMemoryRecord(id: string, updates: {
  name?: string;
  description?: string | null;
  filePath?: string;
}): void {
  const db = getDb();
  const fields: string[] = [];
  const values: unknown[] = [];

  if (updates.name !== undefined) {
    fields.push('name = ?');
    values.push(updates.name);
  }
  if (updates.description !== undefined) {
    fields.push('description = ?');
    values.push(updates.description);
  }
  if (updates.filePath !== undefined) {
    fields.push('file_path = ?');
    values.push(updates.filePath);
  }

  if (fields.length === 0) return;

  fields.push('updated_at = datetime(\'now\')');
  values.push(id);

  db.prepare(`
    UPDATE memories
    SET ${fields.join(', ')}
    WHERE id = ?
  `).run(...values);
}

export function deleteMemoryRecord(id: string): void {
  const db = getDb();
  db.prepare('DELETE FROM memories WHERE id = ?').run(id);
}

export async function syncMemoriesFromFiles(
  memoryDir: string,
  ownerType: 'user' | 'team' | 'project',
  ownerId: string,
): Promise<void> {
  const memories = await scanMemoryFiles(memoryDir);

  const db = getDb();
  const tx = db.transaction(() => {
    db.prepare(`DELETE FROM memories WHERE owner_type = ? AND owner_id = ?`).run(ownerType, ownerId);

    for (const memory of memories) {
      createMemoryRecord({
        ownerType,
        ownerId,
        memoryType: memory.type,
        name: memory.name,
        description: memory.description || null,
        filePath: memory.filePath,
      });
    }
  });

  tx();
}

function mapMemoryRow(row: Record<string, unknown>): MemoryRecord {
  return {
    id: row.id as string,
    ownerType: row.owner_type as MemoryRecord['ownerType'],
    ownerId: row.owner_id as string,
    memoryType: row.memory_type as MemoryType,
    name: row.name as string,
    description: row.description as string | null,
    filePath: row.file_path as string,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
    recallCount: (row.recall_count as number) || 0,
    lastRecalledAt: (row.last_recalled_at as string) || null,
  };
}
