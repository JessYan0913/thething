## Tracing Options

| Option | Default | Description |
|--------|---------|-------------|
| `ltres` | 1 | Error threshold for straight lines. Lower = smoother, more paths |
| `qtres` | 1 | Error threshold for quadratic splines. Lower = smoother curves |
| `pathomit` | 8 | Paths shorter than this are discarded. 0 = keep all (detailed) |
| `rightangleenhance` | true | Enhance right angle corners |

## Color Quantization

| Option | Default | Description |
|--------|---------|-------------|
| `colorsampling` | 2 | 0: palette-based, 1: random, 2: deterministic |
| `numberofcolors` | 16 | Number of colors in output |
| `mincolorratio` | 0 | Colors below this ratio of total pixels are randomized |
| `colorquantcycles` | 3 | Number of quantization iterations |

## SVG Rendering

| Option | Default | Description |
|--------|---------|-------------|
| `strokewidth` | 1 | SVG stroke-width. 0 = no stroke (filled paths only) |
| `linefilter` | false | Line filter for noise reduction |
| `scale` | 1 | Coordinate multiplier for SVG scaling |
| `roundcoords` | 1 | Decimal places for coordinate rounding |
| `viewbox` | false | Include SVG viewBox attribute |
| `desc` | false | Include SVG description elements |

## Blur Preprocessing

| Option | Default | Description |
|--------|---------|-------------|
| `blurradius` | 0 | Selective Gaussian blur radius (1-5). 0 = disabled |
| `blurdelta` | 20 | RGBA delta threshold for blur |

## Custom Palette

Set `pal` to an array of color objects to override color quantization:

```json
{ "pal": [{"r":0,"g":0,"b":0,"a":255}, {"r":255,"g":0,"b":0,"a":255}] }
```

## Built-in Presets

| Preset | Key characteristics |
|--------|-------------------|
| `default` | Balanced, 16 colors |
| `detailed` | pathomit=0, 64 colors, ltres/qtres=0.5 |
| `posterized1` | 2 colors, palette-based |
| `posterized2` | 4 colors, blurred |
| `grayscale` | 7 colors, palette-based |
| `curvy` | Smooth curves, ltres=0.01, line filter |
| `sharp` | Sharp corners, qtres=0.01 |
| `smoothed` | Blurred, blurdelta=64 |
| `artistic1` | 16 colors, blurred, strokewidth=2 |
| `artistic2` | 4 colors, no stroke |
| `artistic3` | 8 colors, high error thresholds |
| `artistic4` | 64 colors, blurred, strokewidth=2 |
