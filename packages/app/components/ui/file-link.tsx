'use client'

import { ExternalLinkIcon, CopyIcon, FolderOpenIcon } from 'lucide-react'
import { useState, useCallback } from 'react'
import { cn } from '@/lib/utils'

interface FileLinkProps {
  /** 完整的文件路径 */
  href: string
  /** 链接显示文本 */
  children: React.ReactNode
  /** 额外类名 */
  className?: string
}

/**
 * 文件路径链接组件
 *
 * 渲染为可点击的文件链接，支持：
 * - 显示相对路径（从 URL 中提取）
 * - 悬停时显示完整绝对路径
 * - 点击在 Finder 中查看
 * - 一键复制路径到剪贴板
 */
export function FileLink({ href, children, className }: FileLinkProps) {
  const [copied, setCopied] = useState(false)
  const [isHovered, setIsHovered] = useState(false)

  // 从 href 中提取完整路径
  // href 可能是 file:// 协议或绝对路径
  const fullPath = href.startsWith('file://')
    ? decodeURIComponent(href.slice(7))
    : href

  // 计算相对路径（从项目根目录）
  const projectRoot = '/Users/yanheng/Documents/work/thething'
  const relativePath = fullPath.startsWith(projectRoot)
    ? fullPath.slice(projectRoot.length + 1)
    : fullPath.split('/').pop() || fullPath

  const handleCopy = useCallback(async (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    try {
      await navigator.clipboard.writeText(fullPath)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch (err) {
      console.error('复制失败:', err)
    }
  }, [fullPath])

  const handleOpenInFinder = useCallback(async (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    try {
      const res = await fetch('/api/fs?action=open&path=' + encodeURIComponent(fullPath))
      if (!res.ok) {
        console.error('打开失败:', res.statusText)
      }
    } catch (err) {
      console.error('打开失败:', err)
    }
  }, [fullPath])

  return (
    <span
      className={cn(
        "group/file-link relative inline-flex items-center gap-1",
        "text-primary hover:underline cursor-pointer",
        className
      )}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      {/* 主链接 */}
      <a
        href={href}
        className="inline-flex items-center gap-1"
        title={fullPath}
        onClick={(e) => {
          e.preventDefault()
          handleOpenInFinder(e)
        }}
      >
        {children}
        <ExternalLinkIcon className="size-3 opacity-0 group-hover/file-link:opacity-100 transition-opacity" />
      </a>

      {/* 操作按钮 */}
      {isHovered && (
        <span className="inline-flex items-center gap-0.5 ml-1">
          <button
            onClick={handleCopy}
            className="p-0.5 rounded hover:bg-muted transition-colors"
            title={copied ? "已复制" : "复制路径"}
          >
            <CopyIcon className={cn(
              "size-3 transition-colors",
              copied ? "text-green-500" : "text-muted-foreground hover:text-foreground"
            )} />
          </button>
          <button
            onClick={handleOpenInFinder}
            className="p-0.5 rounded hover:bg-muted transition-colors"
            title="在 Finder 中查看"
          >
            <FolderOpenIcon className="size-3 text-muted-foreground hover:text-foreground" />
          </button>
        </span>
      )}

      {/* 悬停提示 */}
      {isHovered && (
        <span className="absolute left-0 top-full mt-1 px-2 py-1 text-xs font-mono bg-popover text-popover-foreground border rounded shadow-lg whitespace-nowrap z-50">
          {fullPath}
        </span>
      )}
    </span>
  )
}
