#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { PNG } = require('pngjs');
const ImageTracer = require(path.join(__dirname, '..', 'node_modules', 'imagetracerjs'));

// -- CLI args ---------------------------------------------------------------

const args = process.argv.slice(2);
function getArg(name, fallback) {
  const idx = args.indexOf('--' + name);
  return idx !== -1 && idx + 1 < args.length ? args[idx + 1] : fallback;
}
const hasFlag = (name) => args.includes('--' + name);

const input = args[0];
if (!input) {
  console.error('Usage: node trace.js <input.png> [options]');
  console.error('Options:');
  console.error('  --output <path>      Output SVG path (default: <input>.svg)');
  console.error('  --preset <name>      Preset: default|detailed|posterized|grayscale|artistic (default: default)');
  console.error('  --options <path.json> Custom options JSON file');
  console.error('  --colors <n>         Number of colors (default: 6)');
  console.error('  --scale <n>          Scale factor (default: 1)');
  console.error('  --strokewidth <n>    Stroke width (default: 0)');
  console.error('  --viewbox            Enable viewBox (default: false)');
  process.exit(1);
}

const outputPath = getArg('output', input + '.svg');
const preset = getArg('preset', 'default');
const customOptionsFile = getArg('options', null);

// -- Build options ----------------------------------------------------------

let options = {};

// Built-in preset
const presets = ImageTracer.optionpresets || {};
if (presets[preset]) {
  options = { ...presets[preset] };
} else if (preset !== 'default') {
  console.error(`Unknown preset "${preset}". Available: ${Object.keys(presets).join(', ')}`);
  process.exit(1);
}

// CLI overrides
const numColors = getArg('colors', null);
if (numColors) options.numberofcolors = parseInt(numColors, 10);

const scale = getArg('scale', null);
if (scale) options.scale = parseFloat(scale);

const strokeWidth = getArg('strokewidth', null);
if (strokeWidth) options.strokewidth = parseFloat(strokeWidth);

if (hasFlag('viewbox')) options.viewbox = true;

// Custom options file
if (customOptionsFile) {
  try {
    const custom = JSON.parse(fs.readFileSync(customOptionsFile, 'utf8'));
    options = { ...options, ...custom };
  } catch (e) {
    console.error(`Failed to read options file: ${e.message}`);
    process.exit(1);
  }
}

// -- Read PNG ----------------------------------------------------------------

const inputBuf = fs.readFileSync(input);
const png = PNG.sync.read(inputBuf);

// imagetracerjs expects { width, height, data: Uint8ClampedArray }
const imgd = {
  width: png.width,
  height: png.height,
  data: new Uint8ClampedArray(png.data),
};

// -- Trace -------------------------------------------------------------------

let svgstring;
try {
  svgstring = ImageTracer.imagedataToSVG(imgd, options);
} catch (e) {
  console.error(`Tracing failed: ${e.message}`);
  process.exit(1);
}

// -- Write output ------------------------------------------------------------

fs.mkdirSync(path.dirname(path.resolve(outputPath)), { recursive: true });
fs.writeFileSync(outputPath, svgstring, 'utf8');

// -- Summary -----------------------------------------------------------------

const pathCount = (svgstring.match(/<path /g) || []).length;
const groupCount = (svgstring.match(/<g /g) || []).length;
const fileSizeKB = (Buffer.byteLength(svgstring, 'utf8') / 1024).toFixed(1);

console.log(`SVG saved: ${outputPath}`);
console.log(`  Size: ${fileSizeKB} KB | Paths: ${pathCount} | Groups: ${groupCount} | Colors: ${options.numberofcolors || 6}`);
