// 测试 Agent 加载
// 运行: npx ts-node scripts/test-agent-loader.ts

import { scanAgentDirs, registerBuiltinAgents, globalAgentRegistry } from '../packages/core/src/subagents';
import { resolveAgentRoute } from '../packages/core/src/subagents/router';

async function testAgentLoader() {
  const cwd = process.cwd();

  console.log('=== Agent 加载测试 ===\n');

  // 1. 注册内置 Agent
  console.log('1. 注册内置 Agent...');
  registerBuiltinAgents();
  console.log(`   已注册: ${globalAgentRegistry.getAll().map(a => a.agentType).join(', ')}\n`);

  // 2. 加载自定义 Agent
  console.log('2. 扫描自定义 Agent...');
  const customAgents = await scanAgentDirs(cwd);
  console.log(`   找到 ${customAgents.length} 个自定义 Agent`);

  for (const agent of customAgents) {
    console.log(`   - ${agent.agentType}: ${agent.description}`);
    console.log(`     工具: ${agent.tools?.join(', ') ?? '全部'}`);
    console.log(`     模型: ${agent.model}`);
    globalAgentRegistry.register(agent);
  }
  console.log('');

  // 3. 验证注册
  console.log('3. 验证注册结果...');
  const allAgents = globalAgentRegistry.getAll();
  console.log(`   总计注册 ${allAgents.length} 个 Agent:\n`);

  for (const agent of allAgents) {
    const source = agent.source === 'builtin' ? '内置' :
                   agent.source === 'project' ? '项目' :
                   agent.source === 'user' ? '用户' : agent.source;
    console.log(`   [${source}] ${agent.agentType}`);
    console.log(`       描述: ${agent.description}`);
    console.log(`       工具: ${agent.tools?.join(', ') ?? '全部'}`);
    console.log(`       禁止: ${agent.disallowedTools?.join(', ') ?? '无'}`);
    console.log('');
  }

  // 4. 测试路由
  console.log('4. 测试路由...');

  // 测试自定义 agent
  const testRoute = resolveAgentRoute(
    { agentType: 'test-agent', task: '验证加载' },
    { parentTools: {}, parentModel: {} as any, parentSystemPrompt: '', parentMessages: [], writerRef: { current: null }, abortSignal: new AbortController().signal, toolCallId: 'test', recursionDepth: 0 }
  );
  console.log(`   test-agent 路由: ${testRoute.type} (${testRoute.definition.agentType})`);
  console.log(`   原因: ${testRoute.reason}\n`);

  // 测试内置 agent
  const exploreRoute = resolveAgentRoute(
    { agentType: 'explore', task: '查找文件' },
    { parentTools: {}, parentModel: {} as any, parentSystemPrompt: '', parentMessages: [], writerRef: { current: null }, abortSignal: new AbortController().signal, toolCallId: 'test', recursionDepth: 0 }
  );
  console.log(`   explore 路由: ${exploreRoute.type} (${exploreRoute.definition.agentType})`);
  console.log(`   原因: ${exploreRoute.reason}\n`);

  // 测试自动路由
  const autoRoute = resolveAgentRoute(
    { task: 'find the main entry file' },
    { parentTools: {}, parentModel: {} as any, parentSystemPrompt: '', parentMessages: [], writerRef: { current: null }, abortSignal: new AbortController().signal, toolCallId: 'test', recursionDepth: 0 }
  );
  console.log(`   自动路由 'find the main entry file': ${autoRoute.type} (${autoRoute.definition.agentType})`);
  console.log(`   原因: ${autoRoute.reason}\n`);

  console.log('=== 测试完成 ===');
}

testAgentLoader().catch(console.error);