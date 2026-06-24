import { useCallback, useEffect, useRef, useState } from "react"
import dynamic from "next/dynamic"
import { Loader2Icon } from "lucide-react"

// ============================================================
// Types
// ============================================================

interface GraphNode {
  id: string
  name: string
  category: string
  description: string
  linkCount: number
}

interface GraphEdge {
  source: string
  target: string
}

// ============================================================
// Category colors (matching MemorySettings)
// ============================================================

const CATEGORY_COLORS: Record<string, string> = {
  user: "#3b82f6",
  agent: "#a855f7",
  project: "#f59e0b",
  domain: "#22c55e",
  entity: "#06b6d4",
}

const CATEGORY_LABELS: Record<string, string> = {
  user: "用户",
  agent: "Agent",
  project: "项目",
  domain: "领域",
  entity: "实体",
}

// ============================================================
// Dynamic import (SSR not supported by canvas-based library)
// ============================================================

const ForceGraph2D = dynamic(() => import("react-force-graph-2d"), {
  ssr: false,
  loading: () => (
    <div className="flex items-center justify-center h-full text-muted-foreground">
      <Loader2Icon className="size-4 animate-spin mr-2" />
      <span className="text-xs">加载图谱引擎...</span>
    </div>
  ),
})

// ============================================================
// Custom node object for canvas rendering
// ============================================================

interface CustomNode extends GraphNode {
  x?: number
  y?: number
}

interface CustomLink {
  source: string | CustomNode
  target: string | CustomNode
}

// ============================================================
// Component
// ============================================================

interface WikiGraphProps {
  onSelectPage?: (filename: string) => void
}

export default function WikiGraph({ onSelectPage }: WikiGraphProps) {
  const [nodes, setNodes] = useState<CustomNode[]>([])
  const [edges, setEdges] = useState<CustomLink[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [hoveredNode, setHoveredNode] = useState<string | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const [dimensions, setDimensions] = useState({ width: 600, height: 400 })
  const fgRef = useRef<any>(null)

  // Load graph data
  useEffect(() => {
    async function load() {
      try {
        const res = await fetch("/api/memory/graph")
        if (res.ok) {
          const data = await res.json()
          setNodes(data.nodes ?? [])
          setEdges(data.edges ?? [])
        }
      } catch {
        setNodes([])
        setEdges([])
      } finally {
        setIsLoading(false)
      }
    }
    load()
  }, [])

  // Track container size
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect
        if (width > 0 && height > 0) {
          setDimensions({ width, height })
        }
      }
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  // Zoom to fit after data loads
  useEffect(() => {
    if (nodes.length > 0 && fgRef.current) {
      setTimeout(() => fgRef.current.zoomToFit(400, 60), 500)
    }
  }, [nodes])

  const handleNodeClick = useCallback(
    (node: CustomNode) => {
      onSelectPage?.(node.id)
    },
    [onSelectPage],
  )

  const handleNodeHover = useCallback((node: CustomNode | null) => {
    setHoveredNode(node?.id ?? null)
  }, [])

  // Canvas node rendering
  const nodeCanvasObject = useCallback(
    (node: CustomNode, ctx: CanvasRenderingContext2D, globalScale: number) => {
      const color = CATEGORY_COLORS[node.category] || "#94a3b8"
      const isHovered = hoveredNode === node.id
      const base = 4 + Math.min(node.linkCount * 1.5, 8)
      const r = base / globalScale
      const fontSize = Math.max(10 / globalScale, 2)
      const label = node.name

      // Glow on hover
      if (isHovered) {
        ctx.beginPath()
        ctx.arc(node.x!, node.y!, r + 4 / globalScale, 0, 2 * Math.PI)
        ctx.fillStyle = color + "25"
        ctx.fill()
      }

      // Node circle
      ctx.beginPath()
      ctx.arc(node.x!, node.y!, r, 0, 2 * Math.PI)
      ctx.fillStyle = color
      ctx.globalAlpha = isHovered ? 1 : 0.85
      ctx.fill()
      ctx.strokeStyle = isHovered ? "#1e293b" : "#fff"
      ctx.lineWidth = (isHovered ? 2 : 1.5) / globalScale
      ctx.stroke()
      ctx.globalAlpha = 1

      // Label
      ctx.font = `${isHovered ? "bold " : ""}${fontSize}px sans-serif`
      ctx.textAlign = "center"
      ctx.textBaseline = "top"
      ctx.fillStyle = isHovered ? "#1e293b" : "#64748b"
      ctx.fillText(label, node.x!, node.y! + r + 2 / globalScale)
    },
    [hoveredNode],
  )

  // Canvas link rendering
  const linkCanvasObject = useCallback(
    (link: CustomLink, ctx: CanvasRenderingContext2D) => {
      const sourceNode = typeof link.source === "object" ? link.source : null
      const targetNode = typeof link.target === "object" ? link.target : null
      if (!sourceNode || !targetNode) return

      const isHighlighted =
        hoveredNode === sourceNode.id || hoveredNode === targetNode.id

      ctx.beginPath()
      ctx.moveTo(sourceNode.x!, sourceNode.y!)
      ctx.lineTo(targetNode.x!, targetNode.y!)
      ctx.strokeStyle = isHighlighted ? "#94a3b8" : "#e2e8f0"
      ctx.lineWidth = isHighlighted ? 1.5 : 0.8
      ctx.stroke()

      // Arrow for highlighted links
      if (isHighlighted) {
        const dx = targetNode.x! - sourceNode.x!
        const dy = targetNode.y! - sourceNode.y!
        const dist = Math.sqrt(dx * dx + dy * dy)
        if (dist > 0) {
          const r = 4 + Math.min(targetNode.linkCount * 1.5, 8)
          const endX = targetNode.x! - (dx / dist) * r
          const endY = targetNode.y! - (dy / dist) * r
          const size = 5
          const angle = Math.atan2(dy, dx)
          ctx.beginPath()
          ctx.moveTo(endX, endY)
          ctx.lineTo(
            endX - size * Math.cos(angle - Math.PI / 6),
            endY - size * Math.sin(angle - Math.PI / 6),
          )
          ctx.lineTo(
            endX - size * Math.cos(angle + Math.PI / 6),
            endY - size * Math.sin(angle + Math.PI / 6),
          )
          ctx.closePath()
          ctx.fillStyle = "#94a3b8"
          ctx.fill()
        }
      }
    },
    [hoveredNode],
  )

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground">
        <Loader2Icon className="size-4 animate-spin mr-2" />
        <span className="text-xs">加载图谱...</span>
      </div>
    )
  }

  if (nodes.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground">
        <p className="text-xs">暂无知识数据</p>
      </div>
    )
  }

  return (
    <div ref={containerRef} className="w-full h-full min-h-0 relative">
      <ForceGraph2D
        ref={fgRef}
        graphData={{ nodes, links: edges }}
        width={dimensions.width}
        height={dimensions.height}
        backgroundColor="transparent"
        nodeCanvasObject={nodeCanvasObject}
        nodePointerAreaPaint={(node: CustomNode, color: string, ctx: CanvasRenderingContext2D, globalScale: number) => {
          const r = 4 + Math.min(node.linkCount * 1.5, 8)
          ctx.beginPath()
          ctx.arc(node.x!, node.y!, r + 4 / globalScale, 0, 2 * Math.PI)
          ctx.fillStyle = color
          ctx.fill()
        }}
        linkCanvasObject={linkCanvasObject}
        linkPointerAreaPaint={() => {}}
        onNodeClick={handleNodeClick}
        onNodeHover={handleNodeHover}
        onBackgroundClick={() => setHoveredNode(null)}
        cooldownTicks={100}
        d3VelocityDecay={0.3}
        minZoom={0.3}
        maxZoom={4}
        enableNodeDrag={true}
        enableZoomInteraction={true}
        enablePanInteraction={true}
      />

      {/* Legend */}
      <div className="absolute bottom-3 left-3 flex flex-wrap gap-2 bg-background/80 backdrop-blur-sm rounded-md px-2 py-1.5 border text-[10px]">
        {Object.entries(CATEGORY_LABELS).map(([key, label]) => (
          <div key={key} className="flex items-center gap-1">
            <span
              className="w-2 h-2 rounded-full"
              style={{ backgroundColor: CATEGORY_COLORS[key] }}
            />
            <span className="text-muted-foreground">{label}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
