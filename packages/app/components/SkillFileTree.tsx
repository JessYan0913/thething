import { useState } from "react"
import { ChevronRightIcon, FileIcon, FolderIcon, FolderOpenIcon } from "lucide-react"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { cn } from "@/lib/utils"

export interface SkillFileNode {
  name: string
  path: string
  type: "file" | "directory"
  children?: SkillFileNode[]
}

interface SkillFileTreeProps {
  nodes: SkillFileNode[]
  selectedPath?: string | null
  onSelect: (path: string) => void
}

export function SkillFileTree({ nodes, selectedPath, onSelect }: SkillFileTreeProps) {
  if (!nodes || nodes.length === 0) {
    return <div className="text-xs text-muted-foreground p-2">没有文件</div>
  }

  return (
    <div className="py-1">
      {nodes.map((node) => (
        <TreeNode key={node.path} node={node} selectedPath={selectedPath} onSelect={onSelect} depth={0} />
      ))}
    </div>
  )
}

interface TreeNodeProps {
  node: SkillFileNode
  selectedPath?: string | null
  onSelect: (path: string) => void
  depth: number
}

function TreeNode({ node, selectedPath, onSelect, depth }: TreeNodeProps) {
  const [isOpen, setIsOpen] = useState(depth === 0)
  const isSelected = selectedPath === node.path
  const paddingLeft = depth * 12

  if (node.type === "directory") {
    return (
      <Collapsible open={isOpen} onOpenChange={setIsOpen}>
        <CollapsibleTrigger
          className={cn(
            "flex items-center gap-1.5 py-1 px-2 text-xs hover:bg-muted/50 rounded-md cursor-pointer whitespace-nowrap w-full",
            isSelected && "bg-primary/10 text-primary",
          )}
          style={{ paddingLeft }}
        >
          <ChevronRightIcon
            className={cn(
              "size-3.5 shrink-0 text-muted-foreground transition-transform duration-200",
              isOpen && "rotate-90",
            )}
          />
          {isOpen ? (
            <FolderOpenIcon className="size-3.5 shrink-0 text-blue-500" />
          ) : (
            <FolderIcon className="size-3.5 shrink-0 text-muted-foreground" />
          )}
          <span className="truncate">{node.name}</span>
        </CollapsibleTrigger>
        <CollapsibleContent>
          {node.children && node.children.length > 0 && (
            <div className="border-l border-muted/30 ml-2.5 pl-1">
              {node.children.map((child) => (
                <TreeNode
                  key={child.path}
                  node={child}
                  selectedPath={selectedPath}
                  onSelect={onSelect}
                  depth={depth + 1}
                />
              ))}
            </div>
          )}
        </CollapsibleContent>
      </Collapsible>
    )
  }

  return (
    <button
      onClick={() => onSelect(node.path)}
      className={cn(
        "flex items-center gap-1.5 py-1 px-2 text-xs hover:bg-muted/50 rounded-md cursor-pointer text-left whitespace-nowrap w-full",
        isSelected && "bg-primary/10 text-primary font-medium",
      )}
      style={{ paddingLeft: paddingLeft + 18 }}
    >
      <FileIcon className="size-3.5 shrink-0 text-muted-foreground" />
      <span className="truncate">{node.name}</span>
    </button>
  )
}
