import { useCallback, useEffect, useRef, useState, useMemo } from "react"
import dynamic from "next/dynamic"
import {
  Loader2Icon, ZoomInIcon, ZoomOutIcon, Maximize2Icon,
  XIcon, ArrowRightIcon,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

const noop = () => {}

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
// Category config
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
  categoryFilter?: string | null
  searchQuery?: string
}

export default function WikiGraph({
  onSelectPage,
  categoryFilter: externalFilter,
  searchQuery,
}: WikiGraphProps) {
  const [allNodes, setAllNodes] = useState<CustomNode[]>([])
  const [allEdges, setAllEdges] = useState<CustomLink[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [localFilter, setLocalFilter] = useState<string | null>(null)
  const [redrawTick, setRedrawTick] = useState(0)
  const fgRef = useRef<any>(null)
  const observerRef = useRef<ResizeObserver | null>(null)
  const [dimensions, setDimensions] = useState({ width: 600, height: 400 })
  const containerRef = useRef<HTMLDivElement>(null)

  // Use refs for hover/selected to avoid re-creating canvas callbacks
  // (which would reinitialize the force simulation)
  const hoveredNodeRef = useRef<CustomNode | null>(null)
  const selectedNodeRef = useRef<CustomNode | null>(null)
  // Separate state for UI elements (tooltip, detail panel) — only drives React rendering
  const [hoveredUI, setHoveredUI] = useState<CustomNode | null>(null)
  const [selectedUI, setSelectedUI] = useState<CustomNode | null>(null)

  const activeFilter = externalFilter ?? localFilter

  // Load graph data
  useEffect(() => {
    async function load() {
      try {
        const res = await fetch("/api/memory/graph")
        if (res.ok) {
          const data = await res.json()
          setAllNodes(data.nodes ?? [])
          setAllEdges(data.edges ?? [])
        }
      } catch {
        setAllNodes([])
        setAllEdges([])
      } finally {
        setIsLoading(false)
      }
    }
    load()
  }, [])

  // Filter nodes
  const filteredNodeIds = useMemo(() => {
    const ids = new Set<string>()
    for (const node of allNodes) {
      if (activeFilter && node.category !== activeFilter) continue
      if (searchQuery?.trim()) {
        const q = searchQuery.trim().toLowerCase()
        const match =
          node.name.toLowerCase().includes(q) ||
          node.description.toLowerCase().includes(q)
        if (!match) continue
      }
      ids.add(node.id)
    }
    return ids
  }, [allNodes, activeFilter, searchQuery])

  const nodes = useMemo(
    () => allNodes.filter((n) => filteredNodeIds.has(n.id)),
    [allNodes, filteredNodeIds],
  )

  const edges = useMemo(
    () =>
      allEdges.filter(
        (e) =>
          filteredNodeIds.has(
            typeof e.source === "object" ? e.source.id : e.source,
          ) &&
          filteredNodeIds.has(
            typeof e.target === "object" ? e.target.id : e.target,
          ),
      ),
    [allEdges, filteredNodeIds],
  )

  // Memoize graphData to avoid reinitializing the force simulation on every render
  const graphData = useMemo(
    () => ({ nodes, links: edges }),
    [nodes, edges],
  )

  // Callback ref: tracks container size via ResizeObserver
  const measureRef = useCallback((el: HTMLDivElement | null) => {
    observerRef.current?.disconnect()
    if (!el) return

    const rect = el.getBoundingClientRect()
    if (rect.width > 0 && rect.height > 0) {
      setDimensions({ width: rect.width, height: rect.height })
    }

    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect
        if (width > 0 && height > 0) {
          setDimensions({ width, height })
        }
      }
    })
    observer.observe(el)
    observerRef.current = observer
  }, [])

  const setContainerRef = useCallback(
    (el: HTMLDivElement | null) => {
      ;(containerRef as React.MutableRefObject<HTMLDivElement | null>).current =
        el
      measureRef(el)
    },
    [measureRef],
  )

  // Zoom to fit after data loads
  useEffect(() => {
    if (nodes.length > 0 && fgRef.current) {
      setTimeout(() => fgRef.current.zoomToFit(400, 60), 500)
    }
  }, [nodes.length])

  // Force a canvas redraw by triggering a re-render (graphData is memoized so simulation won't restart)
  const requestRedraw = useCallback(() => {
    setRedrawTick((t) => t + 1)
  }, [])

  const handleNodeClick = useCallback(
    (node: CustomNode) => {
      const prev = selectedNodeRef.current
      const next = prev?.id === node.id ? null : node
      selectedNodeRef.current = next
      setSelectedUI(next)
      requestRedraw()
    },
    [requestRedraw],
  )

  const handleBackgroundClick = useCallback(() => {
    selectedNodeRef.current = null
    setSelectedUI(null)
    requestRedraw()
  }, [requestRedraw])

  const handleNodeHover = useCallback(
    (node: CustomNode | null) => {
      hoveredNodeRef.current = node
      setHoveredUI(node)
      requestRedraw()
    },
    [requestRedraw],
  )

  // Zoom controls
  const handleZoomIn = useCallback(() => {
    fgRef.current?.zoom(1.4, 400)
  }, [])

  const handleZoomOut = useCallback(() => {
    fgRef.current?.zoom(0.7, 400)
  }, [])

  const handleZoomFit = useCallback(() => {
    fgRef.current?.zoomToFit(400, 60)
  }, [])

  // Connected nodes for selected node
  const connectedNodes = useMemo(() => {
    if (!selectedUI) return []
    const connected = new Set<string>()
    for (const edge of allEdges) {
      const src = typeof edge.source === "object" ? edge.source.id : edge.source
      const tgt = typeof edge.target === "object" ? edge.target.id : edge.target
      if (src === selectedUI.id) connected.add(tgt)
      if (tgt === selectedUI.id) connected.add(src)
    }
    return allNodes.filter((n) => connected.has(n.id))
  }, [selectedUI, allEdges, allNodes])

  // ── Canvas callbacks (stable — no hover/selected in deps) ──

  const nodeCanvasObject = useCallback(
    (node: CustomNode, ctx: CanvasRenderingContext2D, globalScale: number) => {
      const color = CATEGORY_COLORS[node.category] || "#94a3b8"
      const isHovered = hoveredNodeRef.current?.id === node.id
      const isSelected = selectedNodeRef.current?.id === node.id
      const base = 5 + Math.min(node.linkCount * 2, 10)
      const r = base / globalScale
      const fontSize = Math.max(11 / globalScale, 2)
      const label = node.name

      // Glow on hover/selected
      if (isHovered || isSelected) {
        ctx.beginPath()
        ctx.arc(node.x!, node.y!, r + 5 / globalScale, 0, 2 * Math.PI)
        ctx.fillStyle = color + (isSelected ? "30" : "20")
        ctx.fill()
      }

      // Node circle
      ctx.beginPath()
      ctx.arc(node.x!, node.y!, r, 0, 2 * Math.PI)
      ctx.fillStyle = color
      ctx.globalAlpha = isHovered || isSelected ? 1 : 0.85
      ctx.fill()
      ctx.strokeStyle = isSelected ? "#1e293b" : isHovered ? "#475569" : "#fff"
      ctx.lineWidth = (isSelected ? 2.5 : isHovered ? 2 : 1.5) / globalScale
      ctx.stroke()
      ctx.globalAlpha = 1

      // Label
      ctx.font = `${isHovered || isSelected ? "bold " : ""}${fontSize}px sans-serif`
      ctx.textAlign = "center"
      ctx.textBaseline = "top"
      ctx.fillStyle = isHovered || isSelected ? "#1e293b" : "#64748b"
      ctx.fillText(label, node.x!, node.y! + r + 3 / globalScale)
    },
    [],
  )

  const linkCanvasObject = useCallback(
    (link: CustomLink, ctx: CanvasRenderingContext2D) => {
      const sourceNode = typeof link.source === "object" ? link.source : null
      const targetNode = typeof link.target === "object" ? link.target : null
      if (!sourceNode || !targetNode) return

      const isHighlighted =
        hoveredNodeRef.current?.id === sourceNode.id ||
        hoveredNodeRef.current?.id === targetNode.id ||
        selectedNodeRef.current?.id === sourceNode.id ||
        selectedNodeRef.current?.id === targetNode.id

      ctx.beginPath()
      ctx.moveTo(sourceNode.x!, sourceNode.y!)
      ctx.lineTo(targetNode.x!, targetNode.y!)
      ctx.strokeStyle = isHighlighted ? "#94a3b8" : "#e2e8f0"
      ctx.lineWidth = isHighlighted ? 1.5 : 0.6
      ctx.stroke()

      // Arrow for highlighted links
      if (isHighlighted) {
        const dx = targetNode.x! - sourceNode.x!
        const dy = targetNode.y! - sourceNode.y!
        const dist = Math.sqrt(dx * dx + dy * dy)
        if (dist > 0) {
          const r = 5 + Math.min(targetNode.linkCount * 2, 10)
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
    [],
  )

  const nodePointerAreaPaint = useCallback(
    (node: CustomNode, color: string, ctx: CanvasRenderingContext2D, globalScale: number) => {
      const r = 5 + Math.min(node.linkCount * 2, 10)
      ctx.beginPath()
      ctx.arc(node.x!, node.y!, r + 5 / globalScale, 0, 2 * Math.PI)
      ctx.fillStyle = color
      ctx.fill()
    },
    [],
  )

  if (isLoading) {
    return (
      <div className="absolute inset-0 flex items-center justify-center text-muted-foreground">
        <Loader2Icon className="size-4 animate-spin mr-2" />
        <span className="text-xs">加载图谱...</span>
      </div>
    )
  }

  if (allNodes.length === 0) {
    return (
      <div className="absolute inset-0 flex items-center justify-center text-muted-foreground">
        <p className="text-xs">暂无知识数据</p>
      </div>
    )
  }

  return (
    <div className="relative w-full h-full min-h-0">
      {/* Graph canvas */}
      <div ref={setContainerRef} className="absolute inset-0 min-h-0">
        <ForceGraph2D
          ref={fgRef}
          graphData={graphData}
          width={dimensions.width}
          height={dimensions.height}
          backgroundColor="transparent"
          nodeCanvasObject={nodeCanvasObject}
          linkCanvasObject={linkCanvasObject}
          linkPointerAreaPaint={noop}
          nodePointerAreaPaint={nodePointerAreaPaint}
          onNodeClick={handleNodeClick}
          onNodeHover={handleNodeHover}
          onBackgroundClick={handleBackgroundClick}
          cooldownTicks={100}
          d3VelocityDecay={0.3}
          minZoom={0.3}
          maxZoom={4}
          enableNodeDrag={true}
          enableZoomInteraction={true}
          enablePanInteraction={true}
        />
      </div>

      {/* Hover tooltip */}
      {hoveredUI && !selectedUI && (
        <div className="pointer-events-none absolute top-14 left-3 z-10 bg-background/95 backdrop-blur-sm border rounded-lg shadow-lg px-3 py-2 max-w-55">
          <div className="flex items-center gap-1.5 mb-1">
            <span
              className="w-2 h-2 rounded-full shrink-0"
              style={{ backgroundColor: CATEGORY_COLORS[hoveredUI.category] }}
            />
            <span className="font-medium text-xs truncate">
              {hoveredUI.name}
            </span>
          </div>
          <p className="text-[10px] text-muted-foreground leading-relaxed line-clamp-2">
            {hoveredUI.description || "暂无描述"}
          </p>
          <p className="text-[10px] text-muted-foreground/60 mt-1">
            {CATEGORY_LABELS[hoveredUI.category]} · {hoveredUI.linkCount}{" "}
            关联
          </p>
        </div>
      )}

      {/* Zoom controls */}
      <div className="absolute top-3 right-3 flex flex-col gap-1 z-10">
        <Button
          variant="outline"
          size="icon"
          className="size-7 bg-background/80 backdrop-blur-sm"
          onClick={handleZoomIn}
        >
          <ZoomInIcon className="size-3.5" />
        </Button>
        <Button
          variant="outline"
          size="icon"
          className="size-7 bg-background/80 backdrop-blur-sm"
          onClick={handleZoomOut}
        >
          <ZoomOutIcon className="size-3.5" />
        </Button>
        <Button
          variant="outline"
          size="icon"
          className="size-7 bg-background/80 backdrop-blur-sm"
          onClick={handleZoomFit}
        >
          <Maximize2Icon className="size-3.5" />
        </Button>
      </div>

      {/* Category filter (local, only when no external filter) */}
      {!externalFilter && (
        <div className="absolute top-3 left-3 z-10 flex flex-wrap gap-1 bg-background/80 backdrop-blur-sm rounded-md px-2 py-1.5 border">
          <button
            className={cn(
              "text-[10px] px-1.5 py-0.5 rounded cursor-pointer transition-colors",
              !localFilter
                ? "bg-primary/10 text-primary font-medium"
                : "text-muted-foreground hover:text-foreground",
            )}
            onClick={() => setLocalFilter(null)}
          >
            全部
          </button>
          {Object.entries(CATEGORY_LABELS).map(([key, label]) => (
            <button
              key={key}
              className={cn(
                "text-[10px] px-1.5 py-0.5 rounded cursor-pointer transition-colors flex items-center gap-1",
                localFilter === key
                  ? "font-medium"
                  : "text-muted-foreground hover:text-foreground",
              )}
              onClick={() => setLocalFilter(localFilter === key ? null : key)}
            >
              <span
                className="w-1.5 h-1.5 rounded-full shrink-0"
                style={{ backgroundColor: CATEGORY_COLORS[key] }}
              />
              {label}
            </button>
          ))}
        </div>
      )}

      {/* Selected node detail panel */}
      {selectedUI && (
        <div className="absolute bottom-3 left-3 right-3 z-10 bg-background/95 backdrop-blur-sm border rounded-lg shadow-lg p-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 mb-1.5">
                <span
                  className="w-2.5 h-2.5 rounded-full shrink-0"
                  style={{
                    backgroundColor: CATEGORY_COLORS[selectedUI.category],
                  }}
                />
                <span className="font-medium text-sm">
                  {selectedUI.name}
                </span>
                <span className="text-[10px] text-muted-foreground px-1.5 py-0.5 rounded-full bg-muted">
                  {CATEGORY_LABELS[selectedUI.category]}
                </span>
              </div>
              {selectedUI.description && (
                <p className="text-xs text-muted-foreground leading-relaxed mb-2">
                  {selectedUI.description}
                </p>
              )}
              <div className="flex items-center gap-3 text-[10px] text-muted-foreground/60">
                <span>{selectedUI.linkCount} 个关联</span>
                {connectedNodes.length > 0 && (
                  <span>
                    关联:{" "}
                    {connectedNodes
                      .slice(0, 5)
                      .map((n) => n.name)
                      .join(", ")}
                    {connectedNodes.length > 5 &&
                      ` +${connectedNodes.length - 5}`}
                  </span>
                )}
              </div>
            </div>
            <div className="flex items-center gap-1 shrink-0">
              <Button
                variant="ghost"
                size="sm"
                className="h-7 text-xs"
                onClick={() => onSelectPage?.(selectedUI.id)}
              >
                查看详情
                <ArrowRightIcon className="size-3 ml-1" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="size-7"
                onClick={() => {
                  selectedNodeRef.current = null
                  setSelectedUI(null)
                  requestRedraw()
                }}
              >
                <XIcon className="size-3.5" />
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Node count */}
      <div className="absolute bottom-3 right-3 z-10 text-[10px] text-muted-foreground/60 bg-background/60 backdrop-blur-sm rounded px-1.5 py-0.5">
        {nodes.length} 节点 · {edges.length} 关系
      </div>
    </div>
  )
}
