#!/usr/bin/env node

/**
 * svg_to_motion.js
 *
 * Parses an SVG file and generates a motion/react TSX component
 * with pathLength line-drawing animation.
 *
 * Usage:
 *   node svg_to_motion.js --input input.svg --output Component.tsx
 *   node svg_to_motion.js --input input.svg --output Component.tsx --name MyAnimation
 */

const fs = require("fs")
const path = require("path")

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function parseArgs() {
  const args = process.argv.slice(2)
  const opts = {}
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--input" && args[i + 1]) opts.input = args[++i]
    else if (args[i] === "--output" && args[i + 1]) opts.output = args[++i]
    else if (args[i] === "--name" && args[i + 1]) opts.name = args[++i]
  }
  if (!opts.input) {
    console.error("Usage: node svg_to_motion.js --input <svg> --output <tsx> [--name <ComponentName>]")
    process.exit(1)
  }
  if (!opts.output) {
    const base = path.basename(opts.input, ".svg")
    const pascal = base
      .replace(/[^a-zA-Z0-9]+/g, " ")
      .trim()
      .split(/\s+/)
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join("")
    opts.output = `${pascal}Animation.tsx`
    opts.name = `${pascal}Animation`
  }
  if (!opts.name) {
    const base = path.basename(opts.output, ".tsx")
    opts.name = base.charAt(0).toUpperCase() + base.slice(1)
  }
  return opts
}

// ---------------------------------------------------------------------------
// SVG Parsing
// ---------------------------------------------------------------------------

function extractAttribute(tag, attr) {
  // Match attr="..." or attr='...'
  const re = new RegExp(`${attr}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`)
  const m = tag.match(re)
  return m ? (m[1] !== undefined ? m[1] : m[2]) : null
}

function parseSVG(svg) {
  // Extract viewBox from <svg> tag
  const svgTag = svg.match(/<svg[\s>][\s\S]*?>/)?.[0] || ""
  let viewBox = extractAttribute(svgTag, "viewBox")
  if (!viewBox) {
    const w = extractAttribute(svgTag, "width") || "100"
    const h = extractAttribute(svgTag, "height") || "100"
    viewBox = `0 0 ${w} ${h}`
  }

  // Extract all <path> tags (self-closing or with content)
  const paths = []
  const pathRegex = /<path\b([^>]*)\/?>/gi
  let match
  while ((match = pathRegex.exec(svg)) !== null) {
    const tag = match[1]
    paths.push({
      d: extractAttribute(tag, "d") || "",
      fill: extractAttribute(tag, "fill"),
      stroke: extractAttribute(tag, "stroke"),
      strokeWidth: extractAttribute(tag, "stroke-width"),
      opacity: extractAttribute(tag, "opacity"),
    })
  }

  return { viewBox, paths }
}

// ---------------------------------------------------------------------------
// Path Length Approximation
// ---------------------------------------------------------------------------

/**
 * Approximate SVG path length by summing Euclidean distances between
 * consecutive numeric coordinate pairs in the d attribute.
 */
function approximatePathLength(d) {
  const nums = d.match(/-?\d+\.?\d*/g)
  if (!nums || nums.length < 4) return 0

  let len = 0
  let px = parseFloat(nums[0])
  let py = parseFloat(nums[1])

  for (let i = 2; i < nums.length - 1; i += 2) {
    const nx = parseFloat(nums[i])
    const ny = parseFloat(nums[i + 1])
    const dx = nx - px
    const dy = ny - py
    len += Math.sqrt(dx * dx + dy * dy)
    px = nx
    py = ny
  }
  return len
}

// ---------------------------------------------------------------------------
// Color Normalization
// ---------------------------------------------------------------------------

function normalizeColor(raw) {
  if (!raw) return "currentColor"
  const c = raw.trim()
  if (c === "none" || c === "transparent") return "none"
  if (c.startsWith("url(")) return "currentColor" // gradients → fallback
  return c // rgb(...), #hex, named colors
}

// ---------------------------------------------------------------------------
// Component Generation
// ---------------------------------------------------------------------------

function generate(svg, componentName) {
  const { viewBox, paths } = parseSVG(svg)

  if (paths.length === 0) {
    console.error("No <path> elements found in SVG.")
    process.exit(1)
  }

  // --- Group by fill color ---------------------------------------------------
  const groupMap = new Map()
  for (const p of paths) {
    const color = normalizeColor(p.fill)
    if (!groupMap.has(color)) groupMap.set(color, [])
    if (p.d) groupMap.get(color).push(p)
  }

  // Sort groups: "none" and "currentColor" last, others by first occurrence
  const groups = [...groupMap.entries()]
    .filter(([, ps]) => ps.length > 0)
    .sort(([a], [b]) => {
      if (a === "none") return 1
      if (b === "none") return -1
      if (a === "currentColor") return 1
      if (b === "currentColor") return -1
      return 0
    })

  // Sort paths within each group by approximate length (longest first)
  for (const [, ps] of groups) {
    ps.sort((a, b) => approximatePathLength(b.d) - approximatePathLength(a.d))
  }

  // --- Timing ---------------------------------------------------------------
  const GROUP_GAP = 0.15 // seconds between groups starting
  const PATH_STAGGER = 0.03 // seconds between paths within a group
  const DRAW_DURATION = 0.6 // seconds per individual path

  let totalDelay = 0

  // --- Build JSX lines ------------------------------------------------------
  const groupBlocks = groups.map(([color, ps], gi) => {
    const groupDelay = totalDelay
    totalDelay += GROUP_GAP

    const pathElements = ps.map((p, pi) => {
      const delay = groupDelay + pi * PATH_STAGGER
      const attrs = [`d="${p.d}"`]
      if (color !== "none" && color !== "currentColor") attrs.push(`fill="${color}"`)
      if (p.stroke && p.stroke !== "none") attrs.push(`stroke="${p.stroke}"`)
      if (p.strokeWidth) attrs.push(`strokeWidth={${p.strokeWidth}}`)
      if (p.opacity && p.opacity !== "1") attrs.push(`opacity={${p.opacity}}`)

      return [
        `            <motion.path`,
        `              ${attrs.join(" ")}`,
        `              variants={{`,
        `                hidden: { pathLength: 0, opacity: 0 },`,
        `                visible: {`,
        `                  pathLength: 1,`,
        `                  opacity: ${p.opacity || 1},`,
        `                  transition: {`,
        `                    pathLength: {`,
        `                      duration: ${DRAW_DURATION},`,
        `                      delay: ${delay.toFixed(2)},`,
        `                      ease: "easeInOut",`,
        `                    },`,
        `                    opacity: {`,
        `                      duration: 0.1,`,
        `                      delay: ${delay.toFixed(2)},`,
        `                    },`,
        `                  },`,
        `                },`,
        `              }}`,
        `            />`,
      ].join("\n")
    })

    return [
      `        {/* ${color === "none" ? "stroke-only" : color} — ${ps.length} paths */}`,
      `        <motion.g>`,
      pathElements.join("\n"),
      `        </motion.g>`,
    ].join("\n")
  })

  // --- Assemble file --------------------------------------------------------
  const totalTime = (totalDelay + DRAW_DURATION).toFixed(1)

  const code = [
    `"use client"`,
    ``,
    `import { motion } from "motion/react"`,
    ``,
    `/**`,
    ` * ${componentName}`,
    ` * Generated by svg-to-motion from ${path.basename(path.resolve("."))}`,
    ` * ${paths.length} paths across ${groups.length} color groups`,
    ` * Total animation: ~${totalTime}s`,
    ` */`,
    `export function ${componentName}() {`,
    `  return (`,
    `    <motion.svg`,
    `      viewBox="${viewBox}"`,
    `      initial="hidden"`,
    `      animate="visible"`,
    `      style={{ width: "100%", height: "auto" }}`,
    `    >`,
    groupBlocks.join("\n\n"),
    `    </motion.svg>`,
    `  )`,
    `}`,
    ``,
  ].join("\n")

  return code
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main() {
  const opts = parseArgs()
  const svgPath = path.resolve(opts.input)

  if (!fs.existsSync(svgPath)) {
    console.error(`File not found: ${svgPath}`)
    process.exit(1)
  }

  const svg = fs.readFileSync(svgPath, "utf-8")
  const code = generate(svg, opts.name)

  const outPath = path.resolve(opts.output)
  fs.mkdirSync(path.dirname(outPath), { recursive: true })
  fs.writeFileSync(outPath, code, "utf-8")

  const { paths } = parseSVG(svg)
  console.log(`✓ Generated ${opts.name}`)
  console.log(`  Paths: ${paths.length}`)
  console.log(`  Output: ${outPath}`)
}

main()
