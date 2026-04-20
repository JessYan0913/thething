#!/usr/bin/env node
/**
 * 发布前准备 - 移除已打包的 workspace 依赖
 * 只保留 better-sqlite3（原生模块必须外部安装）
 */
import { readFileSync, writeFileSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const pkgPath = resolve(__dirname, '..', 'package.json')
const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'))

// 保存原始依赖用于恢复
const originalDeps = pkg.dependencies

// 发布版本：只保留原生模块依赖
pkg.dependencies = {
  'better-sqlite3': originalDeps['better-sqlite3'] || '^12.8.0'
}

// 写入修改后的 package.json
writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n')

// 保存原始依赖到临时文件供 postpublish 恢复
writeFileSync(resolve(__dirname, '.deps-backup.json'), JSON.stringify(originalDeps))

console.log('✓ 已移除已打包的依赖，只保留 better-sqlite3')