'use client'

import { Button } from "@/components/ui/button"

interface DeleteConfirmDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onConfirm: () => void
  itemName: string
  deleting?: boolean
}

export function DeleteConfirmDialog({
  open,
  onOpenChange,
  onConfirm,
  itemName,
  deleting = false,
}: DeleteConfirmDialogProps) {
  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => !deleting && onOpenChange(false)}>
      <div
        className="bg-background rounded-lg border shadow-lg max-w-sm w-full mx-4 p-6 space-y-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="space-y-2">
          <h3 className="text-sm font-semibold">确认删除</h3>
          <p className="text-sm text-muted-foreground">
            确定要删除 &ldquo;{itemName}&rdquo; 吗？此操作无法撤销。
          </p>
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)} disabled={deleting}>
            取消
          </Button>
          <Button variant="destructive" size="sm" onClick={onConfirm} disabled={deleting}>
            {deleting ? "删除中..." : "确认删除"}
          </Button>
        </div>
      </div>
    </div>
  )
}
