// 最小 stdio MCP server，暴露 echo / mixed 工具，用于验证 callToolSafe 形状
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

const server = new McpServer({ name: 'shape-check-server', version: '1.0.0' });

server.registerTool('echo', {
  title: 'echo',
  description: 'Echo the input',
  inputSchema: { text: z.string() },
}, async (args) => {
  return { content: [{ type: 'text', text: `echo: ${args.text}` }] };
});

server.registerTool('mixed', {
  title: 'mixed',
  description: 'Return mixed parts',
  inputSchema: {},
}, async () => {
  return {
    content: [
      { type: 'text', text: 'first text' },
      { type: 'image', data: 'aGVsbG8=', mimeType: 'image/png' },
      { type: 'text', text: 'second text' },
    ],
  };
});

const transport = new StdioServerTransport();
await server.connect(transport);
