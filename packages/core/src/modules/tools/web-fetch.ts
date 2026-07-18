// ============================================================
// Web Fetch Tool - 免费网页抓取工具
// ============================================================
// 使用 Node.js 原生 fetch 抓取网页内容，无需 API Key。
// 自动提取 HTML 中的文本内容，过滤 script/style 标签。

import { tool } from 'ai';
import { z } from 'zod';
import { setGlobalDispatcher, ProxyAgent } from 'undici';
import { logger } from '../../primitives/logger';

/**
 * 全局初始化代理（仅执行一次）
 * Node.js 原生 fetch 不自动读取 http_proxy 环境变量，需通过 setGlobalDispatcher 注入。
 * 不传 dispatcher 给单次 fetch，避免 undici 版本不兼容导致的 UND_ERR_INVALID_ARG。
 */
let proxyInitialized = false;
function initGlobalProxy() {
  if (proxyInitialized) return;
  proxyInitialized = true;

  const proxyUrl = process.env.https_proxy || process.env.http_proxy || process.env.all_proxy;
  if (!proxyUrl) return;

  if (proxyUrl.startsWith('socks5://')) {
    logger.warn('WebFetch', `SOCKS5 代理 (${proxyUrl}) 不受 undici 支持，将直连`);
    return;
  }

  try {
    setGlobalDispatcher(new ProxyAgent(proxyUrl));
    logger.info('WebFetch', `已设置全局代理: ${proxyUrl}`);
  } catch (error) {
    logger.warn('WebFetch', `设置全局代理失败: ${error}，将直连`);
  }
}

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
      maxLength: z.number().min(1000).max(100000).optional().default(20000)
        .describe('返回内容的最大字符数，默认 20000（与 budget 阈值对齐）'),
    }),
    execute: async ({ url, maxLength = 20000 }) => {
      try {
        initGlobalProxy();
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
        const originalLength = content.length;  // 在截断前记录原始长度

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
          originalLength,
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
