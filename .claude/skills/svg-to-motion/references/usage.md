# Usage Guide

## Quick Start

```bash
node .claude/skills/svg-to-motion/scripts/svg_to_motion.js \
  --input public/logo.svg \
  --output components/LogoAnimation.tsx
```

## Parameters

| Flag | Required | Description |
|------|----------|-------------|
| `--input` | Yes | Path to source SVG file |
| `--output` | No | Output TSX file path. Defaults to `<Name>Animation.tsx` in current directory |
| `--name` | No | React component name. Defaults to PascalCase of input filename + "Animation" |

## Examples

### Basic usage

```bash
node .claude/skills/svg-to-motion/scripts/svg_to_motion.js \
  --input mascot.svg
# → Creates MascotAnimation.tsx in current directory
```

### Custom name and output

```bash
node .claude/skills/svg-to-motion/scripts/svg_to_motion.js \
  --input public/robot.svg \
  --output src/components/Robot.tsx \
  --name Robot
# → Creates src/components/Robot.tsx with export function Robot()
```

## Generated Component Features

- **`"use client"`** directive for Next.js App Router compatibility
- **`motion.svg`** with original `viewBox` preserved
- **`motion.g`** groups by fill color for layered animation
- **`motion.path`** with `pathLength: 0 → 1` drawing effect
- **Staggered delays** — groups appear sequentially, paths within groups are staggered
- **Auto-sized** — `width: 100%, height: auto` for responsive layout

## Customizing the Animation

After generation, you can tweak timing by editing the constants at the top of the generated component:

- `DRAW_DURATION` — how long each path takes to draw (default: 0.6s)
- Delay values in each path's `transition` — controls stagger timing

## Integration with Next.js

```tsx
// app/page.tsx
import { RobotAnimation } from "@/components/RobotAnimation"

export default function Home() {
  return (
    <main>
      <RobotAnimation />
    </main>
  )
}
```

## With Scroll-triggered Animation

```tsx
"use client"
import { motion, useInView } from "motion/react"
import { useRef } from "react"

export function RobotAnimation() {
  const ref = useRef(null)
  const isInView = useInView(ref, { once: true })

  return (
    <motion.svg
      viewBox="0 0 1832 2192"
      initial="hidden"
      animate={isInView ? "visible" : "hidden"}
      // ... rest stays the same
    >
      {/* generated content */}
    </motion.svg>
  )
}
```

## Pipeline: Image → SVG → Motion

For raster images, use the full pipeline:

```bash
# Step 1: Convert PNG/JPG to SVG
node .claude/skills/image-to-svg/scripts/trace.js \
  --input mascot.png \
  --output mascot.svg \
  --preset detailed

# Step 2: Convert SVG to motion component
node .claude/skills/svg-to-motion/scripts/svg_to_motion.js \
  --input mascot.svg \
  --output components/MascotAnimation.tsx
```
