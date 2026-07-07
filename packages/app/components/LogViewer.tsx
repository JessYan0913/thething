'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  SearchIcon,
  RefreshCwIcon,
  DownloadIcon,
  TrashIcon,
  PlayIcon,
  PauseIcon,
  FileTextIcon,
  FilterIcon,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

// 日志文件路径（macOS）
const LOG_FILE_PATH = '~/Library/Application Support/@the-thing/desktop/server.log';

interface LogLine {
  id: number;
  content: string;
  timestamp?: string;
  level?: string;
}

export default function LogViewer() {
  const { t } = useTranslation('settings');
  const [logLines, setLogLines] = useState<LogLine[]>([]);
  const [filteredLines, setFilteredLines] = useState<LogLine[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isLiveStreaming, setIsLiveStreaming] = useState(false);
  const [autoScroll, setAutoScroll] = useState(true);
  const scrollRef = useRef<HTMLDivElement>(null);
  const intervalRef = useRef<NodeJS.Timeout | null>(null);

  // 解析日志行，提取时间戳和级别
  const parseLogLine = (line: string, index: number): LogLine => {
    const timestampMatch = line.match(/^\[([^\]]+)\]/);
    const timestamp = timestampMatch ? timestampMatch[1] : undefined;
    
    let level: string | undefined;
    if (line.includes('[ERROR]')) level = 'error';
    else if (line.includes('[WARN]')) level = 'warn';
    else if (line.includes('[INFO]')) level = 'info';
    else if (line.includes('[DEBUG]')) level = 'debug';

    return {
      id: index,
      content: line,
      timestamp,
      level,
    };
  };

  // 加载日志文件
  const loadLogs = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      // 使用现有的 /api/fs API 读取日志文件
      const response = await fetch(`/api/fs?action=read&path=${encodeURIComponent(LOG_FILE_PATH)}`);
      if (!response.ok) {
        throw new Error(`Failed to load logs: ${response.statusText}`);
      }
      
      const data = await response.json();
      if (data.error) {
        throw new Error(data.error);
      }
      
      const content = data.content || '';
      const lines = content.split('\n').filter((line: string) => line.trim() !== '');
      const parsedLines = lines.map((line: string, index: number) => parseLogLine(line, index));
      
      setLogLines(parsedLines);
      setFilteredLines(parsedLines);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load logs');
      console.error('Error loading logs:', err);
    } finally {
      setIsLoading(false);
    }
  }, []);

  // 初始加载
  useEffect(() => {
    loadLogs();
  }, [loadLogs]);

  // 搜索过滤
  useEffect(() => {
    if (!searchQuery.trim()) {
      setFilteredLines(logLines);
      return;
    }

    const query = searchQuery.toLowerCase();
    const filtered = logLines.filter(
      (line) =>
        line.content.toLowerCase().includes(query) ||
        (line.timestamp && line.timestamp.toLowerCase().includes(query)) ||
        (line.level && line.level.toLowerCase().includes(query))
    );
    setFilteredLines(filtered);
  }, [searchQuery, logLines]);

  // 自动滚动到底部
  useEffect(() => {
    if (autoScroll && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [filteredLines, autoScroll]);

  // 实时流控制
  const toggleLiveStreaming = useCallback(() => {
    if (isLiveStreaming) {
      // 停止实时流
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      setIsLiveStreaming(false);
    } else {
      // 开始实时流（每2秒刷新一次）
      setIsLiveStreaming(true);
      intervalRef.current = setInterval(() => {
        loadLogs();
      }, 2000);
    }
  }, [isLiveStreaming, loadLogs]);

  // 组件卸载时清理
  useEffect(() => {
    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
    };
  }, []);

  // 下载日志文件
  const downloadLogs = useCallback(() => {
    const content = logLines.map((line) => line.content).join('\n');
    const blob = new Blob([content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `server.log.${new Date().toISOString().slice(0, 10)}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, [logLines]);

  // 清空日志显示（不删除文件）
  const clearLogs = useCallback(() => {
    setLogLines([]);
    setFilteredLines([]);
  }, []);

  // 获取日志级别样式
  const getLevelStyle = (level?: string) => {
    switch (level) {
      case 'error':
        return 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300';
      case 'warn':
        return 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300';
      case 'info':
        return 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300';
      case 'debug':
        return 'bg-gray-100 text-gray-800 dark:bg-gray-900/30 dark:text-gray-300';
      default:
        return 'bg-muted text-muted-foreground';
    }
  };

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* 工具栏 */}
      <div className="flex items-center gap-2 px-4 py-3 border-b bg-background/80 backdrop-blur-md">
        <div className="flex items-center gap-2 flex-1">
          <FileTextIcon className="size-4 text-muted-foreground" />
          <span className="text-sm font-medium">服务器日志</span>
          <Badge variant="outline" className="text-xs">
            {filteredLines.length} / {logLines.length} 行
          </Badge>
        </div>
        
        <div className="flex items-center gap-2">
          {/* 搜索框 */}
          <div className="relative">
            <SearchIcon className="absolute left-2 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground" />
            <Input
              type="text"
              placeholder="搜索日志..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-7 h-8 w-48 text-xs"
            />
          </div>
          
          {/* 实时流开关 */}
          <Button
            variant={isLiveStreaming ? 'default' : 'outline'}
            size="sm"
            onClick={toggleLiveStreaming}
            className="h-8 gap-1"
          >
            {isLiveStreaming ? (
              <>
                <PauseIcon className="size-3.5" />
                <span className="hidden sm:inline">暂停</span>
              </>
            ) : (
              <>
                <PlayIcon className="size-3.5" />
                <span className="hidden sm:inline">实时</span>
              </>
            )}
          </Button>
          
          {/* 刷新按钮 */}
          <Button
            variant="outline"
            size="sm"
            onClick={loadLogs}
            disabled={isLoading}
            className="h-8 gap-1"
          >
            <RefreshCwIcon className={`size-3.5 ${isLoading ? 'animate-spin' : ''}`} />
            <span className="hidden sm:inline">刷新</span>
          </Button>
          
          {/* 下载按钮 */}
          <Button
            variant="outline"
            size="sm"
            onClick={downloadLogs}
            disabled={logLines.length === 0}
            className="h-8 gap-1"
          >
            <DownloadIcon className="size-3.5" />
            <span className="hidden sm:inline">下载</span>
          </Button>
          
          {/* 清空按钮 */}
          <Button
            variant="outline"
            size="sm"
            onClick={clearLogs}
            disabled={logLines.length === 0}
            className="h-8 gap-1"
          >
            <TrashIcon className="size-3.5" />
            <span className="hidden sm:inline">清空</span>
          </Button>
        </div>
      </div>

      {/* 日志内容 */}
      <div className="flex-1 min-h-0 overflow-hidden">
        {error ? (
          <div className="flex flex-col items-center justify-center h-full gap-2 text-destructive">
            <p className="text-sm">{error}</p>
            <Button variant="outline" size="sm" onClick={loadLogs}>
              重试
            </Button>
          </div>
        ) : isLoading && logLines.length === 0 ? (
          <div className="flex items-center justify-center h-full">
            <RefreshCwIcon className="size-4 animate-spin text-muted-foreground" />
          </div>
        ) : logLines.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full gap-2 text-muted-foreground">
            <FileTextIcon className="size-8" />
            <p className="text-sm">暂无日志数据</p>
            <p className="text-xs">点击"刷新"按钮加载日志</p>
          </div>
        ) : (
          <div ref={scrollRef} className="h-full overflow-auto">
            <div className="p-4 font-mono text-xs leading-relaxed">
              {filteredLines.map((line) => (
                <div
                  key={line.id}
                  className={cn(
                    'py-1 px-2 rounded hover:bg-muted/50 transition-colors',
                    line.level === 'error' && 'bg-red-50 dark:bg-red-900/10',
                    line.level === 'warn' && 'bg-yellow-50 dark:bg-yellow-900/10'
                  )}
                >
                  <div className="flex items-start gap-2">
                    {line.level && (
                      <Badge
                        variant="secondary"
                        className={cn('text-[10px] px-1 py-0 h-4', getLevelStyle(line.level))}
                      >
                        {line.level.toUpperCase()}
                      </Badge>
                    )}
                    {line.timestamp && (
                      <span className="text-muted-foreground shrink-0">{line.timestamp}</span>
                    )}
                    <span className="break-all">{line.content}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* 底部状态栏 */}
      <div className="flex items-center justify-between px-4 py-2 border-t bg-muted/30 text-xs text-muted-foreground">
        <div className="flex items-center gap-2">
          <span>文件: {LOG_FILE_PATH}</span>
        </div>
        <div className="flex items-center gap-2">
          {isLiveStreaming && (
            <Badge variant="secondary" className="text-[10px] px-1 py-0 h-4 bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300">
              实时更新中
            </Badge>
          )}
          <label className="flex items-center gap-1 cursor-pointer">
            <input
              type="checkbox"
              checked={autoScroll}
              onChange={(e) => setAutoScroll(e.target.checked)}
              className="rounded border-gray-300"
            />
            <span>自动滚动</span>
          </label>
        </div>
      </div>
    </div>
  );
}
