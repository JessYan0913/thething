import { useCallback, useEffect, useState } from "react"
import { ChevronRightIcon, FolderIcon, FileIcon, FileTextIcon, ImageIcon, CodeIcon } from "lucide-react"
import { cn } from "@/lib/utils"

export interface FileItem {
  name: string
  path: string
  type: "dir" | "file"
  size: number
}

interface DirectoryTreeProps {
  /** 根目录路径 */
  rootPath: string
  /** 选中的文件路径 */
  selectedFile?: string | null
  /** 文件选中回调 */
  onFileSelect: (path: string) => void
  /** 额外类名 */
  className?: string
}

/**
 * 目录树组件 — 可折叠的目录浏览树
 * 延迟加载子目录内容，点击文件触发回调
 */
export function DirectoryTree({ rootPath, selectedFile, onFileSelect, className }: DirectoryTreeProps) {
  return (
    <div className={cn("overflow-auto font-mono text-sm", className)}>
      <TreeNode
        name={rootPath.split(/[/\\]/).pop() || "root"}
        path={rootPath}
        depth={0}
        defaultOpen={true}
        selectedFile={selectedFile}
        onFileSelect={onFileSelect}
      />
    </div>
  )
}

interface TreeNodeProps {
  name: string
  path: string
  depth: number
  defaultOpen?: boolean
  selectedFile?: string | null
  onFileSelect: (path: string) => void
}

function TreeNode({ name, path: dirPath, depth, defaultOpen, selectedFile, onFileSelect }: TreeNodeProps) {
  const [isOpen, setIsOpen] = useState(defaultOpen ?? depth < 3)
  const [children, setChildren] = useState<FileItem[] | null>(null)
  const [isLoading, setIsLoading] = useState(false)

  const loadChildren = useCallback(async () => {
    if (children !== null) return
    setIsLoading(true)
    try {
      const res = await fetch(`/api/fs/list?dir=${encodeURIComponent(dirPath)}`)
      if (res.ok) {
        const data = await res.json()
        setChildren(data.items ?? [])
      } else {
        setChildren([])
      }
    } catch {
      setChildren([])
    } finally {
      setIsLoading(false)
    }
  }, [dirPath, children])

  useEffect(() => {
    if (isOpen && children === null) {
      loadChildren()
    }
  }, [isOpen, loadChildren, children])

  const toggle = () => {
    if (!isOpen) {
      setIsOpen(true)
    } else {
      setIsOpen(false)
    }
  }

  const icon = <FolderIcon className="size-3.5 shrink-0 text-blue-500" />

  return (
    <div>
      <button
        onClick={toggle}
        className={cn(
          "flex items-center gap-1 px-1 py-0.5 w-full text-left rounded hover:bg-accent/50 transition-colors",
          "text-xs text-muted-foreground"
        )}
        style={{ paddingLeft: `${depth * 16 + 4}px` }}
      >
        <ChevronRightIcon
          className={cn(
            "size-3 shrink-0 transition-transform",
            isOpen && "rotate-90"
          )}
        />
        {icon}
        <span className="truncate">{name}</span>
      </button>

      {isOpen && (
        <div>
          {isLoading && children === null && (
            <div className="text-xs text-muted-foreground/40 pl-6 py-0.5">加载中...</div>
          )}
          {children !== null && children.length === 0 && (
            <div className="text-xs text-muted-foreground/40 pl-6 py-0.5">空目录</div>
          )}
          {children !== null && children.map((item) => {
            if (item.type === "dir") {
              return (
                <TreeNode
                  key={item.path}
                  name={item.name}
                  path={item.path}
                  depth={depth + 1}
                  selectedFile={selectedFile}
                  onFileSelect={onFileSelect}
                />
              )
            }
            return (
              <FileNode
                key={item.path}
                name={item.name}
                path={item.path}
                depth={depth + 1}
                isSelected={selectedFile === item.path}
                onSelect={onFileSelect}
              />
            )
          })}
        </div>
      )}
    </div>
  )
}

interface FileNodeProps {
  name: string
  path: string
  depth: number
  isSelected: boolean
  onSelect: (path: string) => void
}

function FileNode({ name, path: filePath, depth, isSelected, onSelect }: FileNodeProps) {
  const ext = name.split('.').pop()?.toLowerCase() ?? ''
  const fileIcon = getFileIcon(ext)

  return (
    <button
      onClick={() => onSelect(filePath)}
      className={cn(
        "flex items-center gap-1 px-1 py-0.5 w-full text-left rounded transition-colors",
        "text-xs truncate",
        isSelected
          ? "bg-accent text-accent-foreground font-medium"
          : "text-muted-foreground hover:bg-accent/50"
      )}
      style={{ paddingLeft: `${(depth + 1) * 16 + 4}px` }}
    >
      {fileIcon}
      <span className="truncate">{name}</span>
    </button>
  )
}

function getFileIcon(ext: string): React.ReactNode {
  const className = "size-3.5 shrink-0"
  switch (ext) {
    case "md":
    case "mdx":
      return <FileTextIcon className={cn(className, "text-blue-400")} />
    case "json":
      return <CodeIcon className={cn(className, "text-yellow-500")} />
    case "yaml":
    case "yml":
      return <CodeIcon className={cn(className, "text-orange-500")} />
    case "ts":
    case "tsx":
    case "js":
    case "jsx":
      return <CodeIcon className={cn(className, "text-green-500")} />
    case "png":
    case "jpg":
    case "jpeg":
    case "gif":
    case "svg":
      return <ImageIcon className={cn(className, "text-purple-500")} />
    default:
      return <FileIcon className={cn(className, "text-muted-foreground")} />
  }
}
