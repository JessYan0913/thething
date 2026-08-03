"use client";

import { createCodePlugin } from "@streamdown/code";
import githubLight from "@shikijs/themes/github-light";
import githubDark from "@shikijs/themes/github-dark";

// 静态导入主题对象，而非使用 @streamdown/code 默认的字符串主题名。
// Shiki 收到字符串主题名时会在运行时动态 import() 主题模块，
// Turbopack dev 下该异步 chunk 的 URL 中含 "@" 被编码为 %40，导致
// ChunkLoadError（Failed to load chunk ...github-light...）。主题对象自带
// name/type 字段，传入后 Shiki 直接使用，不再动态加载。
export const code = createCodePlugin({
  themes: [githubLight, githubDark],
});
