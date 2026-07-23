#!/usr/bin/env node
/**
 * 修复 BOM 问题
 *
 * 检测并移除所有 .ts 文件开头的 UTF-8 BOM (EF BB BF)
 */

import { readFileSync, writeFileSync, readdirSync, statSync } from 'fs';
import { join, relative } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const projectRoot = join(__dirname, '..');

console.log('🔧 检测并修复 BOM 问题...\n');

/**
 * 递归扫描目录
 */
function* walkDir(dir) {
  const files = readdirSync(dir);
  for (const file of files) {
    const fullPath = join(dir, file);
    const stat = statSync(fullPath);
    if (stat.isDirectory()) {
      // 跳过 node_modules 和 .git
      if (file === 'node_modules' || file === '.git' || file === 'dist' || file === 'build') {
        continue;
      }
      yield* walkDir(fullPath);
    } else if (file.endsWith('.ts') || file.endsWith('.tsx')) {
      yield fullPath;
    }
  }
}

let totalFiles = 0;
let bomFiles = 0;
let fixedFiles = 0;

const coreDir = join(projectRoot, 'packages/core/src');
const appDir = join(projectRoot, 'packages/app');

console.log(`📁 扫描目录: ${relative(projectRoot, coreDir)}`);
console.log(`📁 扫描目录: ${relative(projectRoot, appDir)}`);
console.log();

for (const dir of [coreDir, appDir]) {
  for (const filePath of walkDir(dir)) {
    totalFiles++;

    const buffer = readFileSync(filePath);
    const hasBOM = buffer[0] === 0xEF && buffer[1] === 0xBB && buffer[2] === 0xBF;

    if (hasBOM) {
      bomFiles++;
      const relativePath = relative(projectRoot, filePath);
      console.log(`🔍 发现 BOM: ${relativePath}`);

      try {
        // 移除 BOM
        const content = buffer.slice(3);
        writeFileSync(filePath, content);
        fixedFiles++;
        console.log(`  ✅ 已修复`);
      } catch (err) {
        console.error(`  ❌ 修复失败: ${err.message}`);
      }
    }
  }
}

console.log();
console.log('📊 统计:');
console.log(`  总文件数: ${totalFiles}`);
console.log(`  发现 BOM: ${bomFiles}`);
console.log(`  成功修复: ${fixedFiles}`);
console.log();

if (fixedFiles > 0) {
  console.log('✅ BOM 问题已修复！');
  console.log('下一步: cd packages/core && pnpm typecheck');
} else if (bomFiles === 0) {
  console.log('✅ 没有发现 BOM 问题');
} else {
  console.error('❌ 部分文件修复失败');
  process.exit(1);
}
