'use client'

import { useState } from "react"
import { ArrowLeftIcon, MoreVerticalIcon, SaveIcon } from "lucide-react"
import { Button } from "@/components/ui/button"

export interface MenuItem {
  label: string
  icon: React.ReactNode
  onClick: () => void
  destructive?: boolean
  disabled?: boolean
  hidden?: boolean
  divider?: boolean
}

interface DetailPageHeaderProps {
  onBack: () => void
  icon: React.ReactNode
  title: string
  badges?: React.ReactNode
  onSave?: () => void
  saving?: boolean
  saveDisabled?: boolean
  saveMessage?: { type: 'success' | 'error'; text: string } | null
  menuItems?: MenuItem[]
  extraButtons?: React.ReactNode
}

export function DetailPageHeader({
  onBack,
  icon,
  title,
  badges,
  onSave,
  saving = false,
  saveDisabled = false,
  saveMessage,
  menuItems = [],
  extraButtons,
}: DetailPageHeaderProps) {
  const [menuOpen, setMenuOpen] = useState(false)
  const visibleItems = menuItems.filter(item => !item.hidden)

  return (
    <div className="flex items-center justify-between px-6 py-4 border-b shrink-0">
      <div className="flex items-center gap-3 min-w-0">
        <Button variant="ghost" size="sm" onClick={onBack}>
          <ArrowLeftIcon className="size-4" />
        </Button>
        <div className="size-5 shrink-0 text-muted-foreground">{icon}</div>
        <h1 className="text-base font-semibold truncate">{title}</h1>
        {badges}
      </div>
      <div className="flex items-center gap-2">
        {extraButtons}
        {onSave && (
          <Button size="sm" onClick={onSave} disabled={saving || saveDisabled}>
            <SaveIcon className="size-3.5 mr-1.5" />
            {saving ? "保存中..." : "保存"}
          </Button>
        )}
        {saveMessage && (
          <span className={`text-xs ${saveMessage.type === 'success' ? 'text-emerald-600' : 'text-destructive'}`}>
            {saveMessage.text}
          </span>
        )}
        {visibleItems.length > 0 && (
          <div className="relative">
            <Button
              variant="ghost"
              size="icon"
              className="size-8"
              onClick={() => setMenuOpen(!menuOpen)}
            >
              <MoreVerticalIcon className="size-4" />
            </Button>
            {menuOpen && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setMenuOpen(false)} />
                <div className="absolute right-0 top-8 z-50 w-40 rounded-md border bg-popover shadow-md">
                  {visibleItems.map((item, index) => (
                    <div key={index}>
                      {item.divider ? (
                        <div className="border-t" />
                      ) : (
                        <button
                          className={`flex w-full items-center gap-2 px-3 py-2 text-sm cursor-pointer ${
                            item.destructive
                              ? 'text-destructive hover:bg-destructive/10'
                              : 'hover:bg-accent'
                          } ${item.disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
                          disabled={item.disabled}
                          onClick={() => {
                            if (!item.disabled) {
                              setMenuOpen(false)
                              item.onClick()
                            }
                          }}
                        >
                          {item.icon}
                          {item.label}
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
