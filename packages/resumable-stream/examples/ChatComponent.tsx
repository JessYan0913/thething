/**
 * 聊天组件示例
 * 展示如何在 React 中使用可恢复流
 */

'use client';

import { useState, useEffect, useCallback } from 'react';

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  streamId?: string;
}

interface ChatComponentProps {
  chatId: string;
}

export function ChatComponent({ chatId }: ChatComponentProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [lastSequence, setLastSequence] = useState(0);

  // 恢复流
  const resumeStream = useCallback(
    async (streamId: string, fromSequence?: number) => {
      const params = new URLSearchParams();
      if (fromSequence !== undefined) {
        params.set('from', String(fromSequence));
      }

      const response = await fetch(
        `/api/chat/${chatId}/stream?${params.toString()}`
      );

      if (!response.ok) {
        console.error('Failed to resume stream');
        return;
      }

      const reader = response.body?.getReader();
      if (!reader) return;

      const decoder = new TextDecoder();
      let buffer = '';

      setIsStreaming(true);

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6);
            if (data === '[DONE]') {
              setIsStreaming(false);
              return;
            }

            try {
              const chunk = JSON.parse(data);
              if (chunk.type === 'text') {
                setMessages((prev) => {
                  const lastMsg = prev[prev.length - 1];
                  if (lastMsg?.role === 'assistant') {
                    return [
                      ...prev.slice(0, -1),
                      { ...lastMsg, content: lastMsg.content + chunk.data },
                    ];
                  }
                  return [
                    ...prev,
                    {
                      id: `msg-${Date.now()}`,
                      role: 'assistant',
                      content: chunk.data,
                    },
                  ];
                });
                setLastSequence(chunk.sequence);
              }
            } catch (e) {
              console.error('Failed to parse chunk:', e);
            }
          }
        }
      }

      setIsStreaming(false);
    },
    [chatId]
  );

  // 页面加载时恢复流
  useEffect(() => {
    const checkAndResumeStream = async () => {
      const response = await fetch(`/api/chat/${chatId}/status`);
      const data = await response.json();

      if (data.activeStreams > 0) {
        const stream = data.streams[0];
        console.log('Resuming stream:', stream.id);
        await resumeStream(stream.id);
      }
    };

    checkAndResumeStream();
  }, [chatId, resumeStream]);

  // 发送消息
  const sendMessage = async () => {
    if (!input.trim() || isStreaming) return;

    const userMessage: Message = {
      id: `msg-${Date.now()}`,
      role: 'user',
      content: input.trim(),
    };

    setMessages((prev) => [...prev, userMessage]);
    setInput('');

    try {
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: userMessage.content,
          chatId,
        }),
      });

      const data = await response.json();
      console.log('Stream created:', data.streamId);

      // 恢复新创建的流
      await resumeStream(data.streamId);
    } catch (error) {
      console.error('Failed to send message:', error);
    }
  };

  // 停止流
  const stopStream = async () => {
    try {
      await fetch(`/api/chat/${chatId}/stop`, { method: 'POST' });
      setIsStreaming(false);
    } catch (error) {
      console.error('Failed to stop stream:', error);
    }
  };

  return (
    <div className="flex flex-col h-full">
      {/* 消息列表 */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {messages.map((message) => (
          <div
            key={message.id}
            className={`flex ${
              message.role === 'user' ? 'justify-end' : 'justify-start'
            }`}
          >
            <div
              className={`max-w-[70%] rounded-lg p-3 ${
                message.role === 'user'
                  ? 'bg-blue-500 text-white'
                  : 'bg-gray-100 text-gray-900'
              }`}
            >
              {message.content}
            </div>
          </div>
        ))}
      </div>

      {/* 输入区域 */}
      <div className="border-t p-4">
        <div className="flex gap-2">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && sendMessage()}
            placeholder="输入消息..."
            className="flex-1 border rounded-lg px-3 py-2"
            disabled={isStreaming}
          />
          <button
            onClick={isStreaming ? stopStream : sendMessage}
            className={`px-4 py-2 rounded-lg ${
              isStreaming
                ? 'bg-red-500 text-white'
                : 'bg-blue-500 text-white'
            }`}
          >
            {isStreaming ? '停止' : '发送'}
          </button>
        </div>
      </div>
    </div>
  );
}
