import type { CSSProperties, ReactNode } from "react"
import { cn } from "@/lib/utils"

type SkeletonProps = {
  children?: ReactNode
  className?: string
  style?: CSSProperties
}

function Skeleton({ className, ...props }: SkeletonProps) {
  return (
    <div
      data-slot="skeleton"
      className={cn("animate-pulse rounded-md bg-accent", className)}
      {...props}
    />
  )
}

export { Skeleton }
