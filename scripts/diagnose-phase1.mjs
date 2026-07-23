#!/usr/bin/env node
/**
 * Phase 1 诊断脚本
 *
 * 检查当前 checkpoint 和视图状态
 */

import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

const conversationId = process.argv[2];
if (!conversationId) {
  console.error('Usage: node diagnose-phase1.mjs <conversationId>');
  process.exit(1);
}

console.log(`🔍 诊断 Conversation: ${conversationId}\n`);

// 查找 data 目录
const possiblePaths = [
  join(process.cwd(), '.data'),
  join(process.cwd(), 'data'),
  join(process.cwd(), '.thething-data'),
];

let dataDir = null;
for (const path of possiblePaths) {
  if (existsSync(path)) {
    dataDir = path;
    break;
  }
}

if (!dataDir) {
  console.error('❌ Data directory not found. Tried:', possiblePaths);
  process.exit(1);
}

console.log(`📁 Data directory: ${dataDir}\n`);

// 读取 checkpoint
const checkpointPath = join(dataDir, 'checkpoints', `${conversationId}.json`);
if (!existsSync(checkpointPath)) {
  console.log('❌ No checkpoint found\n');
  process.exit(0);
}

const checkpoint = JSON.parse(readFileSync(checkpointPath, 'utf-8'));

console.log('📊 Checkpoint Info:');
console.log(`  Anchor ID: ${checkpoint.anchorMessageId}`);
console.log(`  Created: ${new Date(checkpoint.createdAt).toLocaleString()}`);
console.log(`  Summary length: ${checkpoint.summary?.length || 0} chars`);
console.log();

if (checkpoint.summary) {
  console.log('📝 Summary (first 200 chars):');
  console.log(`  ${checkpoint.summary.slice(0, 200)}...`);
  console.log();
}

// 读取消息
const messagesPath = join(dataDir, 'messages', `${conversationId}.json`);
if (!existsSync(messagesPath)) {
  console.log('❌ No messages found\n');
  process.exit(0);
}

const messages = JSON.parse(readFileSync(messagesPath, 'utf-8'));
console.log(`📨 Total messages: ${messages.length}`);

// 查找 anchor 消息
const anchorIndex = messages.findIndex(m => m.id === checkpoint.anchorMessageId);
if (anchorIndex >= 0) {
  console.log(`  Anchor found at index: ${anchorIndex}`);
  console.log(`  Messages before anchor: ${anchorIndex}`);
  console.log(`  Messages after anchor: ${messages.length - anchorIndex - 1}`);

  // 模拟视图应用
  const expectedAfterView = messages.length - anchorIndex; // summary + after anchor
  console.log(`\n✨ Expected after view application: ${messages.length} → ${expectedAfterView} messages`);
} else {
  console.log(`  ❌ Anchor message not found in history`);
}

console.log('\n💡 Next steps:');
console.log('  1. Send another message to trigger view application');
console.log('  2. Look for "[Compaction] View applied" in logs');
console.log('  3. If not appearing, check for "[CompactionView] Anchor fingerprint mismatch"');
