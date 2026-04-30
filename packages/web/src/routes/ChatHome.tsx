import { useTranslation } from "react-i18next"
import { ConversationEmptyState } from "@/components/ai-elements/conversation"

export default function ChatHome() {
  const { t } = useTranslation('chat')

  return (
    <div className="flex flex-1 items-center justify-center">
      <ConversationEmptyState
        title={t('emptyState.homeTitle')}
        description={t('emptyState.homeDescription')}
      />
    </div>
  )
}