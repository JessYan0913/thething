/**
 * 基本功能测试
 */

import { createResumableStreamContext } from '../src/index.js';

async function test() {
  console.log('Creating resumable stream context...');

  const ctx = createResumableStreamContext({
    waitUntil: (promise) => {
      promise.catch(console.error);
    },
  });

  try {
    // 1. 创建流
    console.log('\n1. Creating stream...');
    const makeStream = () =>
      new ReadableStream<string>({
        start(controller) {
          for (let i = 0; i < 5; i++) {
            controller.enqueue(`Chunk ${i + 1}`);
          }
          controller.close();
        },
      });

    const stream = await ctx.createNewResumableStream('test-chat-1', makeStream);
    console.log('Stream created');

    if (!stream) {
      throw new Error('Failed to create stream');
    }

    // 2. 读取所有数据
    console.log('\n2. Reading all data...');
    const reader = stream.getReader();
    const chunks: string[] = [];
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
    }
    console.log('Chunks read:', chunks.length);

    // 3. 检查流状态
    console.log('\n3. Checking stream state...');
    const state = await ctx.hasExistingStream('test-chat-1');
    console.log('Stream state:', state);

    // 4. 尝试恢复已完成的流
    console.log('\n4. Trying to resume completed stream...');
    const resumedStream = await ctx.resumeExistingStream('test-chat-1');
    console.log('Resumed stream:', resumedStream === null ? 'null (completed)' : 'exists');

    // 5. 测试 stopStream
    console.log('\n5. Testing stopStream...');
    const makeStream2 = () =>
      new ReadableStream<string>({
        async start(controller) {
          for (let i = 0; i < 10; i++) {
            controller.enqueue(`Chunk ${i + 1}`);
            await new Promise(resolve => setTimeout(resolve, 50));
          }
          controller.close();
        },
      });

    const stream2 = await ctx.createNewResumableStream('test-chat-2', makeStream2);
    if (!stream2) {
      throw new Error('Failed to create stream2');
    }

    // 读取一个 chunk
    const reader2 = stream2.getReader();
    const { value: firstChunk } = await reader2.read();
    console.log('First chunk:', firstChunk);

    // 停止流
    await ctx.stopStream('test-chat-2');
    console.log('Stream stopped');

    // 检查状态
    const state2 = await ctx.hasExistingStream('test-chat-2');
    console.log('Stream state after stop:', state2);

    // 6. 清理
    console.log('\n6. Cleanup...');
    ctx.close();

    console.log('\n✅ All tests passed!');
  } catch (error) {
    console.error('❌ Test failed:', error);
    ctx.close();
    process.exit(1);
  }
}

// 运行测试
test();
