"use client"

import * as CollapsiblePrimitive from "@radix-ui/react-collapsible"
import type { CSSProperties, ReactNode } from "react"

type CollapsibleProps = {
  children?: ReactNode
  className?: string
  defaultOpen?: boolean
  disabled?: boolean
  onOpenChange?: (open: boolean) => void
  open?: boolean
  style?: CSSProperties
}

type CollapsibleTriggerProps = {
  asChild?: boolean
  children?: ReactNode
  className?: string
  disabled?: boolean
  onClick?: () => void
  style?: CSSProperties
}

type CollapsibleContentProps = {
  children?: ReactNode
  className?: string
  forceMount?: true
  style?: CSSProperties
}

const Root = CollapsiblePrimitive.Root as unknown as React.ComponentType<CollapsibleProps>
const Trigger = CollapsiblePrimitive.Trigger as unknown as React.ComponentType<CollapsibleTriggerProps>
const Content = CollapsiblePrimitive.Content as unknown as React.ComponentType<CollapsibleContentProps>

function Collapsible(props: CollapsibleProps) {
  return <Root data-slot="collapsible" {...props} />
}

function CollapsibleTrigger(props: CollapsibleTriggerProps) {
  return <Trigger data-slot="collapsible-trigger" {...props} />
}

function CollapsibleContent(props: CollapsibleContentProps) {
  return <Content data-slot="collapsible-content" {...props} />
}

export { Collapsible, CollapsibleTrigger, CollapsibleContent }
