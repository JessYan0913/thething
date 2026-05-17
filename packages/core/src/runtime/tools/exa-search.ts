import { tool } from 'ai';
import { z } from 'zod';
import Exa from 'exa-js';

export interface ExaSearchToolOptions {
  apiKey?: string;
}

export function createExaSearchTool(options?: ExaSearchToolOptions) {
  const apiKey = options?.apiKey;
  let exaInstance: Exa | null = null;

  function getExaInstance(): Exa {
    if (!apiKey) {
      throw new Error('Web search API key is not configured. Pass webSearchApiKey from the application layer.');
    }

    if (!exaInstance) {
      exaInstance = new Exa(apiKey);
    }
    return exaInstance;
  }

  return tool({
    description: '搜索互联网获取最新信息。当用户询问实时新闻、当前事件、最新技术动态或需要联网查询时使用。返回包含标题、URL和摘要的搜索结果。',
    inputSchema: z.object({
      query: z.string().describe('搜索关键词或问题'),
      numResults: z.number().min(1).max(10).optional().default(5).describe('返回结果数量，1-10之间'),
    }),
    execute: async ({ query, numResults = 5 }) => {
      try {
        const exa = getExaInstance();
        const results = await exa.search(query, {
          type: 'auto',
          numResults,
          contents: {
            highlights: {
              maxCharacters: 4000,
            },
          },
        });

        const formattedResults = results.results.map((result) => ({
          title: result.title || '无标题',
          url: result.url,
          publishedDate: result.publishedDate || null,
          author: result.author || null,
          highlights: result.highlights || [],
          score: result.score || 0,
        }));

        return JSON.stringify({
          success: true,
          query,
          totalResults: formattedResults.length,
          results: formattedResults,
        }, null, 2);
      } catch (error) {
        console.error('[Exa Search Error]', error);
        return {
          success: false,
          query,
          error: error instanceof Error ? error.message : '搜索失败，请重试',
          results: [],
        };
      }
    },
  });
}
