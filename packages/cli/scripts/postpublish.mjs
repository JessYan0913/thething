#!/usr/bin/env node
/**
 * 发布后恢复 - 还原原始 package.json
 */
import { readFileSync, writeFileSync, unlinkSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const pkgPath = resolve(__dirname, '..', 'package.json')
const backupPath = resolve(__dirname, '.deps-backup.json')

// 读取原始依赖
const originalDeps = JSON.parse(readFileSync(backupPath, 'utf-8'))

// 读取当前 package.json
const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'))

// 恢复原始依赖
pkg.dependencies = originalDeps

// 写回
writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n')

// 删除备份文件
unlinkSync(backupPath)

console.log('✓ 已恢复原始 package.json')