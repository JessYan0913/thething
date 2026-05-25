import { useCallback, useRef, useState } from "react"
import { FolderUpIcon, XIcon } from "lucide-react"
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

interface UploadSkillDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSuccess: () => void
}

export function UploadSkillDialog({ open, onOpenChange, onSuccess }: UploadSkillDialogProps) {
  const [folderName, setFolderName] = useState("")
  const [selectedFiles, setSelectedFiles] = useState<File[]>([])
  const [isUploading, setIsUploading] = useState(false)
  const [overwriteConfirmOpen, setOverwriteConfirmOpen] = useState(false)
  const [error, setError] = useState("")
  const inputRef = useRef<HTMLInputElement>(null)

  const handleFolderSelect = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = e.target.files
      if (!files || files.length === 0) return

      const fileList = Array.from(files)

      if (!folderName) {
        const first = fileList[0]
        const parts = first.webkitRelativePath.split("/")
        if (parts.length > 0) {
          setFolderName(parts[0])
        }
      }

      setSelectedFiles(fileList)
      setError("")
    },
    [folderName],
  )

  const resetForm = useCallback(() => {
    setSelectedFiles([])
    setFolderName("")
    setError("")
    if (inputRef.current) inputRef.current.value = ""
  }, [])

  const doUpload = useCallback(
    async (overwrite: boolean = false) => {
      setIsUploading(true)
      setError("")
      try {
        const formData = new FormData()
        formData.append("folderName", folderName)
        if (overwrite) formData.append("overwrite", "true")

        for (const file of selectedFiles) {
          formData.append(`files/${file.webkitRelativePath}`, file)
        }

        const res = await fetch("/api/skills/upload", {
          method: "POST",
          body: formData,
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
      } catch (err: any) {
        setError(err.message || "上传失败")
      } finally {
        setIsUploading(false)
      }
    },
    [selectedFiles, folderName, onOpenChange, onSuccess, resetForm],
  )

  const handleUpload = useCallback(async () => {
    if (selectedFiles.length === 0 || !folderName) {
      setError("请选择文件夹并填写名称")
      return
    }
    await doUpload(false)
  }, [selectedFiles, folderName, doUpload])

  return (
    <>
      <Dialog open={open} onOpenChange={(o) => { if (!o) { resetForm(); onOpenChange(false) } }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>上传 Skill</DialogTitle>
            <DialogDescription>
              选择包含 SKILL.md 文件的文件夹进行上传。
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-2">
              <input
                ref={inputRef}
                type="file"
                className="hidden"
                onChange={handleFolderSelect}
                {...({ webkitdirectory: "", directory: "" } as any)}
              />
              <Button
                variant="outline"
                className="w-full"
                onClick={() => inputRef.current?.click()}
                disabled={isUploading}
              >
                <FolderUpIcon className="mr-2 size-4" />
                {selectedFiles.length > 0 ? `已选择 ${selectedFiles.length} 个文件` : "点击选择文件夹"}
              </Button>
            </div>

            {selectedFiles.length > 0 && (
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium shrink-0">Skill 名称</span>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-5 shrink-0"
                    onClick={resetForm}
                    disabled={isUploading}
                  >
                    <XIcon className="size-3" />
                  </Button>
                </div>
                <Input
                  value={folderName}
                  onChange={(e) => setFolderName(e.target.value)}
                  placeholder="Skill 文件夹名称"
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
              disabled={selectedFiles.length === 0 || !folderName || isUploading}
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
            <DialogTitle>Skill 已存在</DialogTitle>
            <DialogDescription>
              同名 Skill "{folderName}" 已存在，是否覆盖？
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
