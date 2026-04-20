import { defineConfig, globalIgnores } from "eslint/config";

const eslintConfig = defineConfig([
  globalIgnores([
    "node_modules/**",
    "dist/**",
    "build/**",
    ".next/**",
    "**/node_modules/**",
    "**/dist/**",
  ]),
]);

export default eslintConfig;