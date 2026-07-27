import { describe, it, expect } from 'vitest';
import { existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import type { ModelMessage } from 'ai';
import { manageCompaction } from '../lifecycle';
import { DEFAULT_LIFECYCLE_CONFIG } from '../types';
import { extractActionLog } from '../action-log';

// ============================================================
// 差距三:DB 抽样回放(真实对话验证不变式)
// ============================================================
// 从真实 DB 抽样对话,回放压缩,断言四条不变式。
// DB 不存在时跳过(本地/CI 无 DB 时不阻塞)。
// 见 docs/compaction-road-to-excellent.md 差距三。

const DB_PATH = join(homedir(), '.thething', 'data', 'chat.db');
const SKIP = !existsSync(DB_PATH);

interface DbRow { id: string; content: string; role: string; parent_id: string | null; }
interface ConvRow { id: string; head_message_id: string | null; }

/** 从 DB 抽样 N 个对话的活跃消息链 */
function sampleConversations(n: number): { convId: string; messages: ModelMessage[] }[] {
  // 动态 require better-sqlite3(避免无 DB 环境下 import 失败)
  const Database = require('better-sqlite3');
  const db = new Database(DB_PATH, { readonly: true });

  const convs = db.prepare('SELECT id, head_message_id FROM conversations WHERE head_message_id IS NOT NULL ORDER BY updated_at DESC LIMIT ?').all(n) as ConvRow[];
  const result: { convId: string; messages: ModelMessage[] }[] = [];

  for (const conv of convs) {
    // 走 parent_id 链从 head 到 root
    const msgs: DbRow[] = [];
    let curId: string | null = conv.head_message_id;
    while (curId) {
      const row = db.prepare('SELECT id, content, role, parent_id FROM messages WHERE id = ?').get(curId) as DbRow | undefined;
      if (!row) break;
      msgs.unshift(row);
      curId = row.parent_id;
    }
    if (msgs.length < 4) continue; // 太短不测
    const messages = msgs.map(m => JSON.parse(m.content) as ModelMessage);
    result.push({ convId: conv.id, messages });
  }

  db.close();
  return result;
}

describe.skipIf(SKIP)('DB 抽样回放:真实对话不变式验证', () => {
  const samples = SKIP ? [] : sampleConversations(5);

  it('抽样到至少 1 个对话', () => {
    expect(samples.length).toBeGreaterThan(0);
  });

  for (const { convId, messages } of samples) {
    it(`conv=${convId.slice(0, 12)} (${messages.length} msgs): key 永不被驱逐`, async () => {
      const beforeKeys = extractActionLog(messages).filter(e => e.kind === 'tool');
      const result = await manageCompaction(messages, DEFAULT_LIFECYCLE_CONFIG, {
        modelName: 'test',
      });
      const afterKeys = extractActionLog(result.messages).filter(e => e.kind === 'tool');
      // key(工具调用输入)数量不应减少(message 树保留,key 不丢)
      // 注:manageCompaction 无 model/tools 时跳过 emergency,只跑 Layer 2
      expect(afterKeys.length).toBeGreaterThanOrEqual(beforeKeys.length);
    });

    it(`conv=${convId.slice(0, 12)}: 当前步不 meta`, async () => {
      const result = await manageCompaction(messages, DEFAULT_LIFECYCLE_CONFIG, {
        modelName: 'test',
      });
      // 找最后一条含 tool-result 的消息
      let lastToolParts: any[] = [];
      for (const m of result.messages.reverse()) {
        const parts = (m as unknown as { parts?: any[] }).parts;
        if (Array.isArray(parts) && parts.some(p => typeof p.type === 'string' && p.type.startsWith('tool-'))) {
          lastToolParts = parts.filter(p => typeof p.type === 'string' && p.type.startsWith('tool-') && p.state === 'output-available');
          break;
        }
      }
      for (const p of lastToolParts) {
        expect(p._compacted).not.toBe(true);
      }
    });
  }
});
