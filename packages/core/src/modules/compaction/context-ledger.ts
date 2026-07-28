// ============================================================
// Context Ledger - 上下文压缩台账 + pin 注册表
// ============================================================
// 记录本会话内被压缩/截断的工具输出（何物、何时、如何找回），
// 并维护 pin 集合（模型主动 pin + 读循环熔断自动 pin）。
//
// 台账不注入消息流（避免每步破坏 prompt cache），模型通过
// context_pin 工具的 list 动作按需查询。
// 见 docs/context-compaction-architecture.md 读循环事故复盘。

/** 单条压缩记录 */
export interface CompactionRecord {
  /** 时间戳 */
  at: number;
  /** 工具名 */
  toolName: string;
  /** 文件路径（语义类工具） */
  path?: string;
  /** 工具调用 ID */
  toolCallId?: string;
  /** 压缩动作：meta = 替换为元信息；truncated = 可见截断；eviction = TTL 移除 */
  action: 'meta' | 'truncated' | 'eviction';
  /** 原始输出大小（chars） */
  originalSize: number;
  /** 找回方式（落盘路径 / re-read 提示） */
  recovery?: string;
}

const MAX_RECORDS = 300;

export class ContextLedger {
  /** 模型主动 pin 的路径 */
  private modelPins = new Set<string>();
  /** 读循环熔断自动 pin 的路径 → 触发时的读取次数 */
  private autoPins = new Map<string, number>();
  /** 已上报过读循环的路径（遥测去重） */
  private reportedLoops = new Set<string>();
  /** 压缩记录（环形上限 MAX_RECORDS） */
  private records: CompactionRecord[] = [];
  /** 被 meta 化(内容丢失)的路径集合--re-read 这些路径 = 压缩过头信号 */
  private compactedPaths = new Set<string>();
  /** 已上报过 overcompaction 的路径(遥测去重) */
  private reportedOvercompaction = new Set<string>();

  /** 模型主动 pin：该路径的最新读取结果豁免压缩 */
  pin(path: string): void {
    this.modelPins.add(path);
  }

  /** 解除 pin（同时清除自动 pin，允许重新老化） */
  release(path: string): boolean {
    const had = this.modelPins.has(path) || this.autoPins.has(path);
    this.modelPins.delete(path);
    this.autoPins.delete(path);
    this.reportedLoops.delete(path);
    return had;
  }

  /** 读循环熔断自动 pin */
  autoPin(path: string, readCount: number): void {
    this.autoPins.set(path, readCount);
  }

  /** 当前生效的 pin 集合（模型 pin ∪ 自动 pin） */
  get pinnedPaths(): Set<string> {
    const all = new Set(this.modelPins);
    for (const p of this.autoPins.keys()) all.add(p);
    return all;
  }

  /** 读循环上报去重：首次返回 true 并标记，后续返回 false */
  shouldReportLoop(path: string): boolean {
    if (this.reportedLoops.has(path)) return false;
    this.reportedLoops.add(path);
    return true;
  }

  /** 记录一次压缩动作 */
  recordCompaction(rec: Omit<CompactionRecord, 'at'>): void {
    this.records.push({ at: Date.now(), ...rec });
    if (this.records.length > MAX_RECORDS) {
      this.records = this.records.slice(-MAX_RECORDS);
    }
    // meta 化(内容丢失)的路径登记--后续 re-read 即"压缩过头"信号。
    // truncated 不算(内容仍可见,模型只是少看了一段)。
    if (rec.action === 'meta' && rec.path) {
      this.compactedPaths.add(rec.path);
    }
  }

  /** 该路径是否曾被 meta 化(内容丢失)?re-read 它 = 压缩过头 */
  wasCompacted(path: string): boolean {
    return this.compactedPaths.has(path);
  }

  /**
   * 记录一次 re-read。若该路径曾被 meta 化,即为"压缩过头"(overcompaction):
   * 模型 re-read 说明压缩删了它需要的内容。返回是否 overcompaction。
   * 首次 overcompaction 上报(去重),后续重复只计数不报。
   */
  recordReRead(path: string): boolean {
    if (!this.wasCompacted(path)) return false;
    // 压缩过头:模型在 re-read 一个被 meta 化的文件。自动 pin + 上报(首次)。
    this.autoPin(path, 1); // 标记为已 pin,下次读取豁免压缩
    return this.reportedOvercompaction.has(path) ? false : (this.reportedOvercompaction.add(path), true);
  }

  /** 台账文本（供 context_pin list 返回给模型） */
  formatLedger(): string {
    const lines: string[] = [];

    const pins = [...this.modelPins];
    const autos = [...this.autoPins.entries()];
    lines.push(`Pinned paths (${pins.length + autos.length}):`);
    for (const p of pins) lines.push(`  - ${p} (pinned by you)`);
    for (const [p, count] of autos) lines.push(`  - ${p} (auto-pinned: read ${count} times, kept in full)`);
    if (pins.length === 0 && autos.length === 0) lines.push('  (none)');

    lines.push('');
    lines.push(`Recent compactions (${this.records.length}, newest last):`);
    if (this.records.length === 0) {
      lines.push('  (none)');
    } else {
      for (const r of this.records.slice(-30)) {
        const target = r.path ?? r.toolCallId ?? '';
        const recovery = r.recovery ? ` | recover: ${r.recovery}` : '';
        lines.push(`  - [${r.action}] ${r.toolName} ${target} (${r.originalSize} chars)${recovery}`);
      }
    }

    return lines.join('\n');
  }

  /**
   * 记录 TTL 老化移除的消息概要。
   * 被移除的工具结果可通过 context_pin list 查询台账找回。
   */
  recordEviction(toolName: string, path?: string): void {
    this.recordCompaction({
      toolName,
      path,
      action: 'eviction',
      originalSize: 0,
      recovery: path ? `re-read with read_file` : 'use context_pin to query ledger',
    });
  }
}
