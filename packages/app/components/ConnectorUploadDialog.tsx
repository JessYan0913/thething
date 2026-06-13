import { useCallback, useRef, useState } from "react"
import { FileUpIcon, FileTextIcon, XIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"

interface ConnectorUploadDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSuccess: () => void
}

export function ConnectorUploadDialog({ open, onOpenChange, onSuccess }: ConnectorUploadDialogProps) {
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [filename, setFilename] = useState("")
  const [isUploading, setIsUploading] = useState(false)
  const [overwriteConfirmOpen, setOverwriteConfirmOpen] = useState(false)
  const [error, setError] = useState("")
  const inputRef = useRef<HTMLInputElement>(null)

  const handleFileSelect = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0]
      if (!file) return

      setSelectedFile(file)
      if (!filename) {
        setFilename(file.name)
      }
      setError("")
    },
    [filename],
  )

  const resetForm = useCallback(() => {
    setSelectedFile(null)
    setFilename("")
    setError("")
    if (inputRef.current) inputRef.current.value = ""
  }, [])

  const doUpload = useCallback(
    async (overwrite: boolean = false) => {
      if (!selectedFile) return
      setIsUploading(true)
      setError("")
      try {
        const content = await selectedFile.text()
        const res = await fetch("/api/connectors", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ content, filename, overwrite }),
        })

        if (res.status === 409) {
          setIsUploading(false)
          setOverwriteConfirmOpen(true)
          return
        }

        if (!res.ok) {
          const data = await res.json()
          throw new Error(data.error || "上传失败")
        }

        resetForm()
        onOpenChange(false)
        onSuccess()
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : "上传失败")
      } finally {
        setIsUploading(false)
      }
    },
    [selectedFile, filename, onOpenChange, onSuccess, resetForm],
  )

  const handleUpload = useCallback(async () => {
    if (!selectedFile || !filename) {
      setError("请选择文件并填写文件名")
      return
    }
    await doUpload(false)
  }, [selectedFile, filename, doUpload])

  return (
    <>
      <Dialog open={open} onOpenChange={(o) => { if (!o) { resetForm(); onOpenChange(o) } }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>上传连接器</DialogTitle>
            <DialogDescription>
              选择 YAML 文件上传为新连接器。文件需包含 id 和 name 字段。
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-2">
              <input
                ref={inputRef}
                type="file"
                accept=".yaml,.yml"
                className="hidden"
                onChange={handleFileSelect}
              />
              <Button
                variant="outline"
                className="w-full"
                onClick={() => inputRef.current?.click()}
                disabled={isUploading}
              >
                <FileUpIcon className="mr-2 size-4" />
                {selectedFile ? selectedFile.name : "点击选择 YAML 文件"}
              </Button>
            </div>

            {selectedFile && (
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <FileTextIcon className="size-4 text-muted-foreground" />
                  <span className="text-sm font-medium shrink-0">文件名</span>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-5 shrink-0 ml-auto"
                    onClick={resetForm}
                    disabled={isUploading}
                  >
                    <XIcon className="size-3" />
                  </Button>
                </div>
                <Input
                  value={filename}
                  onChange={(e) => setFilename(e.target.value)}
                  placeholder="my-connector.yaml"
                  className="font-mono text-sm"
                />
              </div>
            )}

            {error && (
              <div className="text-sm text-destructive">
                {error}
              </div>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => { resetForm(); onOpenChange(false) }} disabled={isUploading}>
              取消
            </Button>
            <Button
              onClick={handleUpload}
              disabled={!selectedFile || !filename || isUploading}
            >
              {isUploading ? "上传中..." : "上传"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Overwrite confirmation */}
      <Dialog open={overwriteConfirmOpen} onOpenChange={setOverwriteConfirmOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>文件已存在</DialogTitle>
            <DialogDescription>
              文件 &quot;{filename}&quot; 已存在，是否覆盖？
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOverwriteConfirmOpen(false)}>
              取消
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                setOverwriteConfirmOpen(false)
                doUpload(true)
              }}
            >
              覆盖上传
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
