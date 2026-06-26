"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import type { SkillFileNode } from "@/components/SkillFileTree"

// ============================================================
// Helpers
// ============================================================

function findFirstFile(nodes: SkillFileNode[]): SkillFileNode | null {
  for (const node of nodes) {
    if (node.type === "file") return node
    if (node.children) {
      const found = findFirstFile(node.children)
      if (found) return found
    }
  }
  return null
}

// ============================================================
// Hook
// ============================================================

/**
 * 加载技能文件树 + 默认文件内容，并提供文件切换能力。
 *
 * - 自动处理路由参数变化时的重新加载
 * - 使用 AbortController 防止竞态条件
 * - 首次加载时同时获取文件树和默认文件内容
 */
export function useSkillFiles(folderName: string | undefined) {
  const [tree, setTree] = useState<SkillFileNode[] | null>(null)
  const [selectedPath, setSelectedPath] = useState<string | null>(null)
  const [fileContent, setFileContent] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const latestFileRef = useRef<string | null>(null)

  // ── 加载文件树 + 默认文件 ────────────────────────────────
  useEffect(() => {
    if (!folderName) return

    const ctrl = new AbortController()

    setIsLoading(true)
    setTree(null)
    setFileContent(null)
    setSelectedPath(null)

    ;(async () => {
      try {
        const res = await fetch(
          `/api/skills/detail?name=${encodeURIComponent(folderName)}`,
          { signal: ctrl.signal },
        )
        if (ctrl.signal.aborted) return

        const data = await res.json()
        const nodeTree: SkillFileNode[] = data.tree ?? []
        const defaultPath: string | null =
          data.skillMdPath ?? findFirstFile(nodeTree)?.path ?? null

        if (ctrl.signal.aborted) return
        setTree(nodeTree)
        setSelectedPath(defaultPath)

        // 获取默认文件内容
        if (defaultPath) {
          const fileRes = await fetch(
            `/api/skills/file?name=${encodeURIComponent(folderName)}&path=${encodeURIComponent(defaultPath)}`,
            { signal: ctrl.signal },
          )
          if (ctrl.signal.aborted) return

          const fileData = await fileRes.json()
          setFileContent(fileData.content ?? null)
        }

      } catch {
        if (!ctrl.signal.aborted) {
          setTree([])
          setFileContent(null)
        }
      } finally {
        if (!ctrl.signal.aborted) {
          setIsLoading(false)
        }
      }
    })()

    return () => ctrl.abort()
  }, [folderName])

  // ── 选择文件 ─────────────────────────────────────────────
  const selectFile = useCallback(
    async (path: string) => {
      if (!folderName || path === selectedPath) return

      latestFileRef.current = path
      setSelectedPath(path)
      setIsLoading(true)

      try {
        const res = await fetch(
          `/api/skills/file?name=${encodeURIComponent(folderName)}&path=${encodeURIComponent(path)}`,
        )
        const data = await res.json()
        // 防止并发请求的竞态：只处理最新的文件选择
        if (latestFileRef.current !== path) return
        setFileContent(data.content ?? null)
      } catch {
        if (latestFileRef.current === path) setFileContent(null)
      } finally {
        if (latestFileRef.current === path) setIsLoading(false)
      }
    },
    [folderName, selectedPath],
  )

  // ── 刷新文件树 ─────────────────────────────────────────────
  const refresh = useCallback(async () => {
    if (!folderName) return

    setIsLoading(true)
    try {
      const res = await fetch(
        `/api/skills/detail?name=${encodeURIComponent(folderName)}`,
      )
      const data = await res.json()
      const nodeTree: SkillFileNode[] = data.tree ?? []
      setTree(nodeTree)

      // 如果当前选中的文件不在新树中，选择第一个文件
      if (selectedPath) {
        const exists = nodeTree.some((n) => n.path === selectedPath)
        if (!exists) {
          const defaultPath = data.skillMdPath ?? findFirstFile(nodeTree)?.path ?? null
          setSelectedPath(defaultPath)
          if (defaultPath) {
            const fileRes = await fetch(
              `/api/skills/file?name=${encodeURIComponent(folderName)}&path=${encodeURIComponent(defaultPath)}`,
            )
            const fileData = await fileRes.json()
            setFileContent(fileData.content ?? null)
          }
        }
      }
    } catch {
      // ignore
    } finally {
      setIsLoading(false)
    }
  }, [folderName, selectedPath])

  return {
    tree,
    selectedPath,
    fileContent,
    isLoading,
    selectFile,
    refresh,
  }
}
