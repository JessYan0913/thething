import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
} from "@/components/ui/sidebar";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import {
  CheckIcon,
  MessageSquareIcon,
  PencilIcon,
  PlusIcon,
  TrashIcon,
  XIcon,
  SettingsIcon,
  SearchIcon,
} from "lucide-react";
import Link from "next/link";
import { nanoid } from "nanoid";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import { useTranslation } from "react-i18next";
import type { FilterOption } from "@/components/ChatLayout";

// ============================================================================
// Date Grouping Helper
// ============================================================================

function getDateGroup(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  const weekAgo = new Date(today);
  weekAgo.setDate(weekAgo.getDate() - 7);

  if (date >= today) return 'today';
  if (date >= yesterday) return 'yesterday';
  if (date >= weekAgo) return 'thisWeek';
  return 'earlier';
}

function getDateGroupLabel(group: string, t: (key: string) => string): string {
  switch (group) {
    case 'today': return t('chat:conversation.dateGroup.today');
    case 'yesterday': return t('chat:conversation.dateGroup.yesterday');
    case 'thisWeek': return t('chat:conversation.dateGroup.thisWeek');
    case 'earlier': return t('chat:conversation.dateGroup.earlier');
    default: return group;
  }
}

const GROUP_ORDER = ['today', 'yesterday', 'thisWeek', 'earlier'];

function groupConversations(conversations: ConversationItem[]): Map<string, ConversationItem[]> {
  const groups = new Map<string, ConversationItem[]>();
  for (const conv of conversations) {
    const group = getDateGroup(conv.updatedAt || conv.createdAt);
    if (!groups.has(group)) groups.set(group, []);
    groups.get(group)!.push(conv);
  }
  return groups;
}

// ============================================================================
// Types
// ============================================================================

export interface ConversationItem {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
}

// ============================================================================
// Sidebar Component
// ============================================================================

export type ConversationSidebarProps = {
  conversations: ConversationItem[];
  activeConversationId: string | null;
  onSelectConversation: (id: string) => void;
  onCreateConversation: () => void;
  onDeleteConversation: (id: string) => void;
  onRenameConversation: (id: string, title: string) => void;
  isLoading?: boolean;
  filterOptions?: FilterOption[];
  activeFilter?: string;
  onFilterChange?: (value: string) => void;
};

export const ConversationSidebar = ({
  conversations,
  activeConversationId,
  onSelectConversation,
  onCreateConversation,
  onDeleteConversation,
  onRenameConversation,
  isLoading = false,
  filterOptions,
  activeFilter = "user",
  onFilterChange,
}: ConversationSidebarProps) => {
  const { t } = useTranslation();

  return (
    <Sidebar collapsible="icon">
      {/* Header with New Conversation button */}
      <SidebarHeader>
        <div className="flex items-center gap-2 px-2 pt-1 pb-1 group-data-[collapsible=icon]:justify-center">
          <img
            src="/logo.svg"
            alt="The Thing"
            width={48}
            height={48}
            className="rounded-md"
            priority
          />
          <span className="text-sm font-semibold tracking-tight group-data-[collapsible=icon]:hidden">
            The Thing
          </span>
        </div>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              onClick={onCreateConversation}
              tooltip={t('chat:conversation.new')}
            >
              <PlusIcon />
              <span>{t('chat:conversation.new')}</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>

      {/* Source Filter - fixed, not scrollable */}
      {filterOptions && filterOptions.length > 1 && onFilterChange && (
        <SidebarGroup className="group-data-[collapsible=icon]:hidden pt-0">
          <SidebarGroupContent>
            <div className="px-2">
              <Select value={activeFilter} onValueChange={onFilterChange}>
                <SelectTrigger size="sm" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(() => {
                    const ungrouped = filterOptions.filter((o) => !o.group);
                    const grouped = filterOptions.filter((o) => o.group);
                    const groups = [...new Set(grouped.map((o) => o.group!))];
                    return (
                      <>
                        {ungrouped.map((option) => (
                          <SelectItem key={option.value} value={option.value}>
                            {t(option.label)}
                          </SelectItem>
                        ))}
                        {groups.map((groupKey) => (
                          <SelectGroup key={groupKey}>
                            <SelectSeparator />
                            <SelectLabel>{t(groupKey)}</SelectLabel>
                            {grouped
                              .filter((o) => o.group === groupKey)
                              .map((option) => (
                                <SelectItem key={option.value} value={option.value}>
                                  {option.label}
                                </SelectItem>
                              ))}
                          </SelectGroup>
                        ))}
                      </>
                    );
                  })()}
                </SelectContent>
              </Select>
            </div>
          </SidebarGroupContent>
        </SidebarGroup>
      )}

      {/* Conversation List - hidden when collapsed */}
      <SidebarContent>
        <SidebarGroup className="group-data-[collapsible=icon]:hidden">
          <SidebarGroupContent>
            {isLoading ? (
              <div className="space-y-1 px-2 py-2">
                {Array.from({ length: 5 }).map((_, i) => (
                  <div key={i} className="flex items-center gap-2 rounded-md px-2 py-2">
                    <div className="size-4 shrink-0 rounded bg-muted animate-pulse" />
                    <div className="h-3 flex-1 rounded bg-muted animate-pulse" style={{ width: `${60 + (i % 3) * 15}%` }} />
                  </div>
                ))}
              </div>
            ) : conversations.length === 0 ? (
              <div className="flex flex-col items-center justify-center gap-3 py-12 text-muted-foreground text-xs px-4">
                <div className="rounded-full bg-muted p-3">
                  <MessageSquareIcon className="size-6 opacity-40" />
                </div>
                <span className="text-center leading-relaxed">{t('chat:conversation.noConversations')}</span>
              </div>
            ) : (
              <div className="space-y-1">
                {(() => {
                  const grouped = groupConversations(conversations);
                  return GROUP_ORDER.map((group) => {
                    const items = grouped.get(group);
                    if (!items || items.length === 0) return null;
                    return (
                      <div key={group}>
                        <div className="px-2 py-1.5 text-[10px] font-medium text-muted-foreground/70 uppercase tracking-wider">
                          {getDateGroupLabel(group, t)}
                        </div>
                        <SidebarMenu>
                          {items.map((conv) => (
                            <ConversationItem
                              key={conv.id}
                              conversation={conv}
                              isActive={conv.id === activeConversationId}
                              onSelect={() => onSelectConversation(conv.id)}
                              onDelete={() => onDeleteConversation(conv.id)}
                              onRename={(title) => onRenameConversation(conv.id, title)}
                            />
                          ))}
                        </SidebarMenu>
                      </div>
                    );
                  });
                })()}
              </div>
            )}
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      {/* Footer */}
      <SidebarFooter>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton asChild tooltip={t('settings:sidebar.systemSettings')}>
              <Link href="/settings">
                <SettingsIcon />
                <span>{t('settings:sidebar.systemSettings')}</span>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>

      {/* Rail for hover-to-toggle */}
      <SidebarRail />
    </Sidebar>
  );
};

// ============================================================================
// Individual Conversation Item
// ============================================================================

type ConversationItemProps = {
  conversation: ConversationItem;
  isActive: boolean;
  onSelect: () => void;
  onDelete: () => void;
  onRename: (title: string) => void;
};

const ConversationItem = ({
  conversation,
  isActive,
  onSelect,
  onDelete,
  onRename,
}: ConversationItemProps) => {
  const { t } = useTranslation();
  const [isEditing, setIsEditing] = useState(false);
  const [editTitle, setEditTitle] = useState(conversation.title);
  const [isDeleting, setIsDeleting] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [isEditing]);

  const handleStartEdit = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      setEditTitle(conversation.title);
      setIsEditing(true);
    },
    [conversation.title]
  );

  const handleStartDelete = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      setIsDeleting(true);
    },
    []
  );

  const handleConfirmDelete = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      onDelete();
    },
    [onDelete]
  );

  const handleCancelDelete = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    setIsDeleting(false);
  }, []);

  const handleSaveEdit = useCallback(() => {
    const trimmed = editTitle.trim();
    if (trimmed && trimmed !== conversation.title) {
      onRename(trimmed);
    } else {
      setEditTitle(conversation.title);
    }
    setIsEditing(false);
  }, [editTitle, conversation.title, onRename]);

  const handleEditKeyDown = useCallback(
    (e: KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Enter") {
        e.preventDefault();
        handleSaveEdit();
      } else if (e.key === "Escape") {
        setEditTitle(conversation.title);
        setIsEditing(false);
      }
    },
    [handleSaveEdit, conversation.title]
  );

  const handleDeleteKeyDown = useCallback(
    (e: KeyboardEvent<HTMLDivElement>) => {
      if (e.key === "Enter") {
        e.preventDefault();
        handleConfirmDelete(e as unknown as React.MouseEvent);
      } else if (e.key === "Escape") {
        handleCancelDelete(e as unknown as React.MouseEvent);
      }
    },
    [handleConfirmDelete, handleCancelDelete]
  );

  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        isActive={isActive}
        onClick={onSelect}
        tooltip={conversation.title}
      >
        {isEditing ? (
          <input
            className="w-full bg-transparent text-sidebar-foreground text-sm outline-none"
            onBlur={handleSaveEdit}
            onChange={(e) => setEditTitle(e.target.value)}
            onKeyDown={handleEditKeyDown}
            onClick={(e) => e.stopPropagation()}
            ref={inputRef}
            value={editTitle}
          />
        ) : isDeleting ? (
          <div
            className="flex w-full items-center justify-between"
            onKeyDown={handleDeleteKeyDown}
            tabIndex={0}
          >
            <span className="truncate text-destructive text-xs">{t('chat:conversation.deleteConfirm')}</span>
            <div className="flex items-center gap-0.5">
              <div
                className="inline-flex size-5 items-center justify-center rounded-sm hover:bg-accent hover:text-accent-foreground cursor-pointer"
                onClick={handleConfirmDelete}
                role="button"
                tabIndex={0}
              >
                <CheckIcon className="size-3 text-destructive" />
              </div>
              <div
                className="inline-flex size-5 items-center justify-center rounded-sm hover:bg-accent hover:text-accent-foreground cursor-pointer"
                onClick={handleCancelDelete}
                role="button"
                tabIndex={0}
              >
                <XIcon className="size-3" />
              </div>
            </div>
          </div>
        ) : (
          <>
            <MessageSquareIcon />
            <span className="truncate">{conversation.title}</span>
          </>
        )}
      </SidebarMenuButton>

      {/* Action Buttons (rename/delete) */}
      {!isEditing && !isDeleting && (
        <>
          <SidebarMenuAction
            className="right-7"
            onClick={handleStartEdit}
            showOnHover
            title={t('chat:conversation.rename')}
          >
            <PencilIcon />
          </SidebarMenuAction>
          <SidebarMenuAction
            className="hover:bg-destructive/10 hover:text-destructive"
            onClick={handleStartDelete}
            showOnHover
            title={t('chat:conversation.delete')}
          >
            <TrashIcon />
          </SidebarMenuAction>
        </>
      )}
    </SidebarMenuItem>
  );
};
