// ============================================================
// Web Fetch Tool - 免费网页抓取工具
// ============================================================
// 使用 Node.js 原生 fetch 抓取网页内容，无需 API Key。
// 自动提取 HTML 中的文本内容，过滤 script/style 标签。

import { tool } from 'ai';
import { z } from 'zod';
import { logger } from '../../primitives/logger';

/**
 * 从 HTML 中提取纯文本
 */
function extractText(html: string): string {
  // 移除 script、style、noscript 标签及其内容
  let text = html.replace(/<script[\s\S]*?<\/script>/gi, '');
  text = text.replace(/<style[\s\S]*?<\/style>/gi, '');
  text = text.replace(/<noscript[\s\S]*?<\/noscript>/gi, '');
  
  // 移除 HTML 标签
  text = text.replace(/<[^>]+>/g, ' ');
  
  // 解码 HTML 实体
  text = text.replace(/&nbsp;/g, ' ');
  text = text.replace(/&amp;/g, '&');
  text = text.replace(/&lt;/g, '<');
  text = text.replace(/&gt;/g, '>');
  text = text.replace(/&quot;/g, '"');
  text = text.replace(/&#39;/g, "'");
  text = text.replace(/&[a-zA-Z]+;/g, '');
  
  // 清理空白
  text = text.replace(/[ \t]+/g, ' ');
  text = text.replace(/\n\s*\n/g, '\n\n');
  text = text.trim();
  
  return text;
}

/**
 * 从 HTML 中提取 title
 */
function extractTitle(html: string): string {
  const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return match?.[1]?.trim() ?? '';
}

export function createWebFetchTool() {
  return tool({
    description: '抓取指定 URL 的网页内容并返回文本。用于获取网页信息、文档、API 响应等。支持 HTTP/HTTPS 协议。返回提取的文本内容，自动过滤 HTML 标签和脚本。',
    inputSchema: z.object({
      url: z.string().url().describe('要抓取的网页 URL'),
      maxLength: z.number().min(1000).max(100000).optional().default(50000)
        .describe('返回内容的最大字符数，默认 50000'),
    }),
    execute: async ({ url, maxLength = 50000 }) => {
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 30000);

        const response = await fetch(url, {
          signal: controller.signal,
          headers: {
            'User-Agent': 'Mozilla/5.0 (compatible; TheThing/1.0; +https://github.com/thething)',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
          },
          redirect: 'follow',
        });

        clearTimeout(timeout);

        if (!response.ok) {
          return JSON.stringify({
            success: false,
            url,
            error: `HTTP ${response.status}: ${response.statusText}`,
          });
        }

        const contentType = response.headers.get('content-type') ?? '';
        const html = await response.text();

        // 提取内容
        const title = extractTitle(html);
        let content = extractText(html);

        // 截断
        let truncated = false;
        if (content.length > maxLength) {
          content = content.slice(0, maxLength);
          truncated = true;
        }

        return JSON.stringify({
          success: true,
          url,
          title,
          contentType,
          content,
          truncated,
          originalLength: content.length,
        }, null, 2);
      } catch (error) {
        const message = error instanceof Error ? error.message : '抓取失败';
        logger.error('WebFetch', `Failed to fetch ${url}:`, error);
        
        return JSON.stringify({
          success: false,
          url,
          error: message.includes('abort') ? '请求超时（30秒）' : message,
        });
      }
    },
  });
}
