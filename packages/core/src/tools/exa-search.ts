import { tool } from 'ai';
import { z } from 'zod';
import Exa from 'exa-js';

// Lazy initialization to avoid requiring API key at module load time
let exaInstance: Exa | null = null;

function getExaInstance(): Exa {
  if (!exaInstance) {
    const apiKey = process.env.EXA_API_KEY;
    if (!apiKey) {
      throw new Error('EXA_API_KEY environment variable is not set. Please set it before using web search.');
    }
    exaInstance = new Exa(apiKey);
  }
  return exaInstance;
}

export const exaSearchTool = tool({
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

      const result = {
        success: true,
        query,
        totalResults: formattedResults.length,
        results: formattedResults,
      };

      return JSON.stringify(result, null, 2);
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