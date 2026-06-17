import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  dts: true,
  sourcemap: true,
  clean: true,
  minify: false,
  target: 'es2022',
  splitting: false,
  banner: {
    js: '// @the-thing/resumable-stream - SQLite-based resumable stream implementation',
  },
});
