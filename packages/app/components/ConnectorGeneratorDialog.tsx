"use client"

import { useCallback, useMemo, useState } from "react"
import { nanoid } from "nanoid"
import { SparklesIcon, CopyIcon, CheckIcon, SaveIcon, SendIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { Input } from "@/components/ui/input"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { useChat } from "@ai-sdk/react"
import { DefaultChatTransport } from "ai"

interface ConnectorGeneratorDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSuccess: () => void
}

function extractYaml(text: string): string {
  const match = text.match(/```yaml\s*\n([\s\S]*?)```/)
  return match?.[1]?.trim() ?? text.trim()
}

export function ConnectorGeneratorDialog({ open, onOpenChange, onSuccess }: ConnectorGeneratorDialogProps) {
  const [input, setInput] = useState("")
  const [filename, setFilename] = useState("")
  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState("")
  const [copied, setCopied] = useState(false)
  const [conversationId] = useState(() => nanoid())

  const transport = useMemo(() => new DefaultChatTransport({
    api: "/api/connectors/generate",
    body: { conversationId },
    prepareSendMessagesRequest({ messages, body }) {
      const lastMsg = messages.at(-1)
      const description = lastMsg?.role === "user"
        ? lastMsg.parts
            .filter((p): p is { type: "text"; text: string } => p.type === "text")
            .map((p) => p.text)
            .join("\n")
        : ""
      return {
        body: {
          message: lastMsg,
          conversationId,
          description,
          ...body,
        },
      }
    },
  }), [conversationId])

  const { messages, sendMessage, status } = useChat({
    id: conversationId,
    transport,
  })

  const isLoading = status === "streaming" || status === "submitted"
  const lastAssistantMessage = messages.filter((m) => m.role === "assistant").pop()
  const generatedText = lastAssistantMessage
    ? lastAssistantMessage.parts
        .filter((p): p is { type: "text"; text: string } => p.type === "text")
        .map((p) => p.text)
        .join("")
    : ""
  const generatedYaml = generatedText ? extractYaml(generatedText) : ""

  const handleGenerate = useCallback(async () => {
    if (!input.trim()) return
    setError("")
    try {
      await sendMessage({ text: input })
      setInput("")
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "生成失败")
    }
  }, [input, sendMessage])

  const handleCopy = useCallback(async () => {
    if (!generatedYaml) return
    await navigator.clipboard.writeText(generatedYaml)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }, [generatedYaml])

  const handleSave = useCallback(async () => {
    if (!generatedYaml || !filename) return
    setIsSaving(true)
    setError("")
    try {
      const res = await fetch("/api/connectors", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: generatedYaml, filename }),
      })

      if (res.status === 409) {
        setError("文件已存在，请修改文件名")
        return
      }

      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || "保存失败")
      }

      resetForm()
      onOpenChange(false)
      onSuccess()
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "保存失败")
    } finally {
      setIsSaving(false)
    }
  }, [generatedYaml, filename, onOpenChange, onSuccess])

  const resetForm = useCallback(() => {
    setInput("")
    setFilename("")
    setError("")
    setCopied(false)
  }, [])

  const handleClose = useCallback(() => {
    resetForm()
    onOpenChange(false)
  }, [onOpenChange, resetForm])

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) handleClose() }}>
      <DialogContent className="max-w-2xl max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <SparklesIcon className="size-4" />
            AI 生成连接器
          </DialogTitle>
          <DialogDescription>
            描述你想要的连接器，AI 会生成对应的 YAML 配置文件。
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 min-h-0 space-y-4 overflow-auto">
          {/* Chat messages */}
          {messages.length > 0 && (
            <div className="space-y-3 max-h-[30vh] overflow-auto">
              {messages.map((msg) => (
                <div key={msg.id} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
                  <div className={`max-w-[85%] rounded-lg px-3 py-2 text-sm ${
                    msg.role === "user"
                      ? "bg-primary text-primary-foreground"
                      : "bg-muted"
                  }`}>
                    {msg.role === "assistant" ? (
                      <pre className="whitespace-pre-wrap font-mono text-xs">
                        {(() => {
                          const text = msg.parts
                            .filter((p): p is { type: "text"; text: string } => p.type === "text")
                            .map((p) => p.text)
                            .join("")
                          return extractYaml(text) || text
                        })()}
                      </pre>
                    ) : (
                      <span>
                        {msg.parts
                          .filter((p): p is { type: "text"; text: string } => p.type === "text")
                          .map((p) => p.text)
                          .join("")}
                      </span>
                    )}
                  </div>
                </div>
              ))}
              {isLoading && (
                <div className="flex justify-start">
                  <div className="bg-muted rounded-lg px-3 py-2 text-sm animate-pulse">
                    生成中...
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Input area */}
          <div className="flex items-end gap-2">
            <Textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={"例如：创建一个高德地图 API 连接器，支持地理编码和路径规划"}
              rows={2}
              className="resize-none text-sm flex-1"
              disabled={isLoading}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault()
                  handleGenerate()
                }
              }}
            />
            <Button
              size="sm"
              onClick={handleGenerate}
              disabled={!input.trim() || isLoading}
              className="shrink-0"
            >
              <SendIcon className="size-4" />
            </Button>
          </div>

          {/* Generated YAML preview + save */}
          {generatedYaml && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-muted-foreground">生成的 YAML</span>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 px-2"
                  onClick={handleCopy}
                >
                  {copied ? <CheckIcon className="size-3 mr-1" /> : <CopyIcon className="size-3 mr-1" />}
                  {copied ? "已复制" : "复制"}
                </Button>
              </div>
              <pre className="p-3 rounded-md border bg-muted/30 text-xs font-mono overflow-auto max-h-[25vh] whitespace-pre-wrap">
                {generatedYaml}
              </pre>

              <div className="flex items-center gap-2">
                <Input
                  value={filename}
                  onChange={(e) => setFilename(e.target.value)}
                  placeholder="my-connector.yaml"
                  className="font-mono text-sm h-8"
                />
                <Button
                  size="sm"
                  onClick={handleSave}
                  disabled={!filename || isSaving}
                >
                  <SaveIcon className="mr-1 size-3.5" />
                  {isSaving ? "保存中..." : "保存"}
                </Button>
              </div>
            </div>
          )}

          {error && (
            <div className="text-sm text-destructive">
              {error}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={handleClose}>
            关闭
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
