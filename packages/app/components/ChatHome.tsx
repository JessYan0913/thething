import { useCallback, useState } from "react"
import { useTranslation } from "react-i18next"
import { FileTextIcon, XIcon } from "lucide-react"
import {
  PromptInput,
  PromptInputTextarea,
  PromptInputSubmit,
  PromptInputFooter,
  PromptInputTools,
  PromptInputActionMenu,
  PromptInputActionMenuTrigger,
  PromptInputActionMenuContent,
  PromptInputActionAddAttachments,
  PromptInputActionAddScreenshot,
  usePromptInputAttachments,
  type PromptInputMessage,
} from "@/components/ai-elements/prompt-input"
import { useChatContext } from "./ChatLayout"

function AttachmentPreview() {
  const { files, remove } = usePromptInputAttachments()
  if (files.length === 0) return null

  return (
    <div className="flex flex-wrap gap-2 px-3 pt-3">
      {files.map((file) => {
        const isImage = file.mediaType?.startsWith('image/')
        return (
          <div key={file.id} className="group relative">
            {isImage ? (
              <img
                src={file.url}
                alt={file.filename ?? ''}
                className="h-16 w-16 rounded-md border object-cover"
              />
            ) : (
              <div className="flex h-16 w-16 flex-col items-center justify-center rounded-md border bg-muted p-1">
                <FileTextIcon className="size-5 text-muted-foreground" />
                <span className="mt-0.5 max-w-full truncate text-[10px] text-muted-foreground">
                  {file.filename ?? 'file'}
                </span>
              </div>
            )}
            <button
              type="button"
              onClick={() => remove(file.id)}
              className="absolute -right-1.5 -top-1.5 hidden rounded-full border bg-background p-0.5 shadow-sm group-hover:block"
            >
              <XIcon className="size-3" />
            </button>
          </div>
        )
      })}
    </div>
  )
}

export default function ChatHome() {
  const { t } = useTranslation('chat')
  const { handleCreateConversation } = useChatContext()
  const [isSubmitting, setIsSubmitting] = useState(false)

  const handleSubmit = useCallback(
    async ({ text }: PromptInputMessage) => {
      const trimmed = text.trim()
      if (!trimmed || isSubmitting) return

      setIsSubmitting(true)
      try {
        await handleCreateConversation({ initialMessage: trimmed })
      } catch {
        setIsSubmitting(false)
      }
    },
    [handleCreateConversation, isSubmitting]
  )

  return (
    <div className="flex flex-1 flex-col items-center justify-center p-8">
      <div className="w-full max-w-2xl space-y-6">
        <div className="text-center space-y-1">
          <h2 className="text-xl font-semibold">
            {t('emptyState.quickStartTitle')}
          </h2>
          <p className="text-sm text-muted-foreground">
            {t('emptyState.quickStartDescription')}
          </p>
        </div>

        <PromptInput onSubmit={handleSubmit} accept="image/*,.pdf,.txt,.md,.csv,.json,.xml,.html,.css,.js,.ts,.tsx,.jsx,.py,.java,.c,.cpp,.go,.rs,.rb,.sh,.docx,.doc,.xlsx,.xls,.pptx,.ppt,.odt,.ods,.odp" multiple>
          <AttachmentPreview />
          <PromptInputTextarea
            placeholder={t('input.placeholder')}
            disabled={isSubmitting}
          />
          <PromptInputFooter>
            <PromptInputTools>
              <PromptInputActionMenu>
                <PromptInputActionMenuTrigger tooltip="Add attachments" />
                <PromptInputActionMenuContent>
                  <PromptInputActionAddAttachments />
                  <PromptInputActionAddScreenshot />
                </PromptInputActionMenuContent>
              </PromptInputActionMenu>
            </PromptInputTools>
            <PromptInputSubmit
              disabled={isSubmitting}
              status={isSubmitting ? "submitted" : undefined}
            />
          </PromptInputFooter>
        </PromptInput>
      </div>
    </div>
  )
}
