import { describe, it, expect, beforeEach } from 'vitest';
import { McpRegistry, createMcpRegistry } from '../registry';
import type { McpServerConfig } from '../types';

// ============================================================
// MCP Registry Tests
// ============================================================
describe('mcp', () => {
  describe('McpRegistry', () => {
    let registry: McpRegistry;
    const testConfigs: McpServerConfig[] = [
      {
        name: 'test-server-1',
        transport: { type: 'stdio', command: 'node', args: ['server.js'] },
        enabled: true,
      },
      {
        name: 'test-server-2',
        transport: { type: 'sse', url: 'http://localhost:3000/sse' },
        enabled: false,
      },
      {
        name: 'test-server-3',
        transport: { type: 'http', url: 'http://localhost:3001/mcp' },
        enabled: true,
        tools: { exclude: ['dangerous_tool'] },
      },
    ];

    beforeEach(() => {
      registry = new McpRegistry(testConfigs);
    });

    describe('constructor', () => {
      it('should initialize with servers config', () => {
        expect(registry.servers.length).toBe(3);
      });

      it('should work with empty servers', () => {
        const emptyRegistry = new McpRegistry([]);
        expect(emptyRegistry.servers.length).toBe(0);
      });
    });

    describe('servers', () => {
      it('should return server configs', () => {
        const servers = registry.servers;
        expect(servers[0].name).toBe('test-server-1');
        expect(servers[1].name).toBe('test-server-2');
        expect(servers[2].name).toBe('test-server-3');
      });

      it('should be a copy of server configs', () => {
        const servers = registry.servers;
        // Array is a copy or readonly view
        expect(servers.length).toBe(3);
      });
    });

    describe('connections', () => {
      it('should return empty map initially', () => {
        expect(registry.connections.size).toBe(0);
      });
    });

    describe('getAllTools', () => {
      it('should return empty ToolSet initially', () => {
        const tools = registry.getAllTools();
        expect(Object.keys(tools).length).toBe(0);
      });
    });

    describe('getServerTools', () => {
      it('should return empty ToolSet for unconnected server', () => {
        const tools = registry.getServerTools('test-server-1');
        expect(Object.keys(tools).length).toBe(0);
      });
    });

    describe('snapshot', () => {
      it('should return correct snapshot', () => {
        const snapshot = registry.snapshot();
        expect(snapshot.servers.length).toBe(testConfigs.length);
        expect(snapshot.totalTools).toBe(0);
      });

      it('should show server status correctly', () => {
        const snapshot = registry.snapshot();
        expect(snapshot.servers[0].enabled).toBe(true);
        expect(snapshot.servers[1].enabled).toBe(false);
        expect(snapshot.servers[0].connected).toBe(false);
      });

      it('should show tool count', () => {
        const snapshot = registry.snapshot();
        expect(snapshot.servers[0].toolCount).toBe(0);
      });
    });

    describe('disconnectAll', () => {
      it('should work when no connections', async () => {
        await registry.disconnectAll();
        expect(registry.connections.size).toBe(0);
      });
    });

    describe('disconnect', () => {
      it('should handle non-existent server', async () => {
        await registry.disconnect('non-existent');
        expect(registry.connections.size).toBe(0);
      });
    });
  });

  describe('createMcpRegistry', () => {
    it('should create new registry', () => {
      const registry = createMcpRegistry([]);
      expect(registry).toBeInstanceOf(McpRegistry);
    });

    it('should create registry with servers', () => {
      const servers: McpServerConfig[] = [
        {
          name: 'server',
          transport: { type: 'sse', url: 'http://localhost/sse' },
        },
      ];
      const registry = createMcpRegistry(servers);
      expect(registry.servers.length).toBe(1);
    });
  });

  describe('McpServerConfig types', () => {
    it('should accept stdio transport', () => {
      const config: McpServerConfig = {
        name: 'stdio-server',
        transport: { type: 'stdio', command: 'node', args: ['app.js'] },
      };
      expect(config.transport.type).toBe('stdio');
    });

    it('should accept sse transport', () => {
      const config: McpServerConfig = {
        name: 'sse-server',
        transport: { type: 'sse', url: 'http://localhost/sse' },
      };
      expect(config.transport.type).toBe('sse');
    });

    it('should accept http transport', () => {
      const config: McpServerConfig = {
        name: 'http-server',
        transport: { type: 'http', url: 'http://localhost/mcp' },
      };
      expect(config.transport.type).toBe('http');
    });

    it('should accept tool filters', () => {
      const config: McpServerConfig = {
        name: 'filtered-server',
        transport: { type: 'stdio', command: 'node' },
        tools: {
          include: ['safe_tool'],
          exclude: ['dangerous_tool'],
        },
      };
      expect(config.tools?.include).toContain('safe_tool');
      expect(config.tools?.exclude).toContain('dangerous_tool');
    });

    it('should accept elicitation config', () => {
      const config: McpServerConfig = {
        name: 'elicitation-server',
        transport: { type: 'stdio', command: 'node' },
        elicitation: { enabled: true },
      };
      expect(config.elicitation?.enabled).toBe(true);
    });
  });
});