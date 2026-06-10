---
name: image-to-svg
description: >-
  Converts raster images (PNG, JPEG, BMP) to scalable SVG using imagetracerjs.
  Supports multiple presets (default, detailed, posterized, artistic, grayscale)
  and custom color palettes. Use when user asks to "convert image to SVG",
  "vectorize logo", "trace bitmap", "PNG to SVG", "raster to vector",
  or "make SVG from image". Do NOT use for SVG animation, SVG editing,
  or PDF conversion.
metadata:
  author: thething
  version: 1.0.0
  category: conversion
  tags: [svg, vector, image, tracer, logo]
---

# Image to SVG

Converts raster images to scalable SVG using imagetracerjs (pure JS, zero native dependencies).

## Instructions

### Step 1: Confirm input and options

Verify the input image path exists. Ask the user for preferences if not specified:

- **Preset**: `default` (balanced), `detailed` (high quality), `posterized` (few colors), `artistic` (stylized), `grayscale` (monochrome)
- **Colors**: Number of output colors (2-64, default 16)
- **Scale**: Output scale factor (default 1)
- **ViewBox**: Whether to include viewBox attribute (default false)

### Step 2: Install dependency (if needed)

```bash
cd .claude/skills/image-to-svg && npm install imagetracerjs pngjs
```

Verify installation:

```bash
node .claude/skills/image-to-svg/scripts/trace.js
```

Expected: usage message with no errors.

### Step 3: Run conversion

Basic conversion:

```bash
node .claude/skills/image-to-svg/scripts/trace.js input.png --output output.svg
```

With preset:

```bash
node .claude/skills/image-to-svg/scripts/trace.js input.png --output output.svg --preset detailed
```

With custom colors and scale:

```bash
node .claude/skills/image-to-svg/scripts/trace.js input.png --output output.svg --colors 8 --scale 2
```

With custom options file:

```bash
node .claude/skills/image-to-svg/scripts/trace.js input.png --output output.svg --options custom.json
```

Example `custom.json`:

```json
{
  "ltres": 0.5,
  "qtres": 0.5,
  "numberofcolors": 8,
  "blurradius": 2,
  "pal": [
    {"r": 0, "g": 0, "b": 0, "a": 255},
    {"r": 255, "g": 255, "b": 255, "a": 255}
  ]
}
```

### Step 4: Verify output

The script prints a summary with file size, path count, and color count. For visual verification, open the SVG in a browser or code editor.

### Step 5: Fine-tune (if needed)

If the result is too noisy: increase `pathomit` or `blurradius`.

If detail is lost: decrease `pathomit` to 0, increase `numberofcolors`.

If colors are wrong: use `--options` with a custom palette (`pal`).

Full options reference: `references/options.md`.

## Troubleshooting

| Problem | Solution |
|---------|----------|
| "Cannot find module" errors | Run `npm install` in the skill directory |
| Output is all black/white | Input may be grayscale; try `--preset grayscale` or increase `--colors` |
| Too many paths / large file | Increase `--colors` or use `--preset posterized` |
| Missing small details | Set `--preset detailed` or reduce `--colors` to 4-8 |
| Colors look wrong | Use custom palette via `--options` JSON file |

## Critical Rules

- Input must be PNG, JPEG, or BMP format. Other formats need pre-conversion.
- imagetracerjs is pure JS with no native dependencies — works in any Node.js environment.
- For logos with transparency: PNG input preserves alpha channel; SVG output uses filled paths.
- The `pal` option overrides `numberofcolors` — do not set both.
