declare module "react-force-graph-2d" {
  import { Component } from "react"

  interface GraphData {
    nodes: Array<Record<string, any>>
    links: Array<Record<string, any>>
  }

  interface ForceGraph2DProps {
    graphData?: GraphData
    width?: number
    height?: number
    backgroundColor?: string
    ref?: React.RefObject<any>

    // Node rendering
    nodeCanvasObject?: (
      node: any,
      ctx: CanvasRenderingContext2D,
      globalScale: number,
    ) => void
    nodePointerAreaPaint?: (
      node: any,
      color: string,
      ctx: CanvasRenderingContext2D,
      globalScale: number,
    ) => void

    // Link rendering
    linkCanvasObject?: (
      link: any,
      ctx: CanvasRenderingContext2D,
    ) => void
    linkPointerAreaPaint?: (
      link: any,
      color: string,
      ctx: CanvasRenderingContext2D,
    ) => void

    // Interaction
    onNodeClick?: (node: any) => void
    onNodeHover?: (node: any | null) => void
    onBackgroundClick?: () => void
    onLinkClick?: (link: any) => void

    // Behavior
    cooldownTicks?: number
    d3VelocityDecay?: number
    minZoom?: number
    maxZoom?: number
    enableNodeDrag?: boolean
    enableZoomInteraction?: boolean
    enablePanInteraction?: boolean
  }

  export default class ForceGraph2D extends Component<ForceGraph2DProps> {
    zoomToFit(duration?: number, padding?: number): void
    centerAt(x?: number, y?: number, duration?: number): void
    zoom(zoomLevel: number, duration?: number): void
  }
}
