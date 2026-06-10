---
name: svg-to-motion
description: >-
  Convert SVG files to animated React components using motion/react.
  Use when user asks to animate SVG, make SVG drawing animation,
  convert SVG to motion component, or add line drawing effect to SVG.
  Do NOT use for Lottie output (use image-to-lottie instead).
  Do NOT use for raster images (use image-to-svg first, then this skill).
metadata:
  author: thething
  version: 1.0.0
  category: animation
  tags: [svg, motion, react, animation, line-drawing]
---

# SVG to Motion

Converts static SVG files into animated React components using [motion.dev](https://motion.dev).

Generates a **line drawing animation** where SVG paths progressively appear as if being hand-drawn.

## Pipeline

### Step 1: Parse SVG

```bash
node .claude/skills/svg-to-motion/scripts/svg_to_motion.js \
  --input path/to/image.svg \
  --output path/to/Component.tsx
```

The script:
- Extracts `viewBox` (falls back to `width`/`height`)
- Parses all `<path>` elements (d, fill, stroke, stroke-width, opacity attributes)
- Groups paths by fill color
- Sorts paths within each group by approximate length (longest first for natural drawing order)

### Step 2: Output

A `"use client"` React component with:
- `motion.svg` container with correct `viewBox`
- `motion.g` group per color layer
- `motion.path` per SVG path with `pathLength` animation
- Staggered delays between groups and individual paths

### Step 3: Integrate

Copy the generated component into your project and use it:

```tsx
import { RobotAnimation } from "@/components/RobotAnimation"

export default function Page() {
  return <RobotAnimation />
}
```

## Animation Details

The generated animation uses:
- **`pathLength: 0 → 1`** — SVG-specific "hand-drawn" line effect
- **Staggered delays** — color groups appear sequentially, paths within each group are staggered
- **`ease: "easeInOut"`** — smooth drawing feel
- **Variants pattern** — `initial`/`animate` for clean control

## Limitations

- Best for SVGs with visible strokes. Pure fill-only paths may not show the drawing effect clearly.
- Works best with SVGs from `image-to-svg` skill (which preserves stroke attributes).
- For complex SVGs with many fragments, the animation may feel busy — consider reducing path count with SVG optimization first.
