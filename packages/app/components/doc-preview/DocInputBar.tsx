"use client";

import { useState } from "react";
import {
  PaperclipIcon,
  MicIcon,
  SendIcon,
  SquareIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface DocInputBarProps {
  isStreaming: boolean;
  onGenerate: () => void;
  onStop: () => void;
}

export function DocInputBar({
  isStreaming,
  onGenerate,
  onStop,
}: DocInputBarProps) {
  const [inputValue, setInputValue] = useState("");
  const [selectedModel, setSelectedModel] = useState("sonnet");

  const handleSubmit = () => {
    if (isStreaming) {
      onStop();
    } else if (inputValue.trim()) {
      onGenerate();
      setInputValue("");
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  return (
    <div className="border-t bg-background p-4">
      <div className="mx-auto max-w-3xl">
        {/* 输入框 */}
        <div className="relative rounded-lg border bg-muted/50 focus-within:ring-2 focus-within:ring-ring">
          <textarea
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="描述你想要生成的文档内容..."
            className="min-h-[60px] w-full resize-none bg-transparent px-4 py-3 text-sm outline-none placeholder:text-muted-foreground"
            rows={2}
          />
        </div>

        {/* 底部工具栏 */}
        <div className="mt-2 flex items-center justify-between">
          <div className="flex items-center gap-2">
            {/* 附件按钮 */}
            <Button variant="ghost" size="icon" className="size-8">
              <PaperclipIcon className="size-4" />
            </Button>

            {/* 语音按钮 */}
            <Button variant="ghost" size="icon" className="size-8">
              <MicIcon className="size-4" />
            </Button>

            {/* 模型选择器 */}
            <Select value={selectedModel} onValueChange={setSelectedModel}>
              <SelectTrigger className="w-[140px] h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="sonnet">Sonnet 4.6</SelectItem>
                <SelectItem value="opus">Opus 4.8</SelectItem>
                <SelectItem value="haiku">Haiku 4.5</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="flex items-center gap-2">
            {/* 发送/停止按钮 */}
            {isStreaming ? (
              <Button
                size="icon"
                className="size-8"
                onClick={onStop}
                variant="destructive"
              >
                <SquareIcon className="size-4" />
              </Button>
            ) : (
              <Button
                size="icon"
                className="size-8"
                onClick={handleSubmit}
                disabled={!inputValue.trim()}
              >
                <SendIcon className="size-4" />
              </Button>
            )}
          </div>
        </div>

        {/* 提示文字 */}
        <p className="mt-2 text-center text-xs text-muted-foreground">
          内容由 AI 生成，请仔细检查后再使用
        </p>
      </div>
    </div>
  );
}
