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
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
import {
  MessageSquareIcon,
  PencilIcon,
  PlusIcon,
  TrashIcon,
  SettingsIcon,
  MoreHorizontalIcon,
  XIcon,
} from "lucide-react";
import Link from "next/link";
import { nanoid } from "nanoid";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import { useTranslation } from "react-i18next";
import type { FilterOption } from "@/components/ChatLayout";

// ============================================================================
// Date & Time Helpers
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
  source: string;
  sourceId: string | null;
  channelId: string | null;
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

  const grouped = useMemo(() => groupConversations(conversations), [conversations]);

  return (
    <Sidebar collapsible="icon">
      {/* Header with brand and source filter */}
      <SidebarHeader>
        {/* Brand — square SVG icon + text when expanded, icon only when collapsed */}
        <div className="flex items-center gap-2.5 px-2 pt-3 pb-1 group-data-[collapsible=icon]:justify-center min-h-9">
          <img
            src="/logo.svg"
            alt="The Thing"
            width={28}
            height={28}
            className="rounded-md shrink-0 dark:brightness-0 dark:invert"
          />
          <span className="group-data-[collapsible=icon]:hidden text-sm font-semibold tracking-tight">
            TheThing
          </span>
        </div>

        {/* Source filter — full width below brand */}
        {filterOptions && filterOptions.length > 1 && onFilterChange && (
          <div className="px-2 pb-1 group-data-[collapsible=icon]:hidden">
            <Select value={activeFilter} onValueChange={onFilterChange}>
              <SelectTrigger size="sm" className="h-8 w-full gap-1 rounded-md bg-sidebar-accent/50 text-xs text-muted-foreground hover:bg-sidebar-accent hover:text-foreground transition-colors px-3 border-0 shadow-none [&>svg]:size-3">
                <SelectValue />
              </SelectTrigger>
              <SelectContent sideOffset={4} className="min-w-36">
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
        )}

        {/* New conversation — only in user mode */}
        {activeFilter === 'user' && (
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
        )}
      </SidebarHeader>

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
                {GROUP_ORDER.map((group) => {
                  const items = grouped.get(group);
                  if (!items || items.length === 0) return null;
                  return (
                    <div key={group}>
                      <div className="px-2 py-1.5">
                        <span className="text-[10px] font-medium text-muted-foreground/70 uppercase tracking-wider">
                          {getDateGroupLabel(group, t)}
                        </span>
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
                })}
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
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [isEditing]);

  const handleStartEdit = useCallback(
    (e?: React.MouseEvent) => {
      e?.stopPropagation();
      setEditTitle(conversation.title);
      setIsEditing(true);
    },
    [conversation.title]
  );

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

  // Reset confirmation state when dropdown closes
  const handleDropdownOpenChange = useCallback((open: boolean) => {
    if (!open) {
      // Use setTimeout to avoid state update during unmount
      setTimeout(() => setConfirmingDelete(false), 0);
    }
  }, []);

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
        ) : (
          <>
            <MessageSquareIcon className="size-4 shrink-0" />
            <span className="truncate flex-1 min-w-0">{conversation.title}</span>
          </>
        )}
      </SidebarMenuButton>

      {!isEditing && (
        <DropdownMenu onOpenChange={handleDropdownOpenChange}>
          <SidebarMenuAction showOnHover asChild>
            <DropdownMenuTrigger>
              <MoreHorizontalIcon className="size-4" />
            </DropdownMenuTrigger>
          </SidebarMenuAction>
          <DropdownMenuContent side="right" align="start" onClick={(e: React.MouseEvent) => e.stopPropagation()}>
            {confirmingDelete ? (
              <>
                <div className="flex items-center gap-2 px-2 py-1.5 text-xs text-muted-foreground border-b border-border mx-1 mb-1">
                  {t('chat:conversation.deleteConfirm') || 'Delete this conversation?'}
                </div>
                <DropdownMenuItem onClick={() => setConfirmingDelete(false)}>
                  <XIcon />
                  Cancel
                </DropdownMenuItem>
                <DropdownMenuItem variant="destructive" onClick={onDelete}>
                  <TrashIcon />
                  {t('chat:conversation.delete')}
                </DropdownMenuItem>
              </>
            ) : (
              <>
                <DropdownMenuItem onClick={handleStartEdit}>
                  <PencilIcon className="size-4" />
                  {t('chat:conversation.rename')}
                </DropdownMenuItem>
                <DropdownMenuItem
                  variant="destructive"
                  onClick={() => setConfirmingDelete(true)}
                  onSelect={(e: { preventDefault: () => void }) => e.preventDefault()}
                >
                  <TrashIcon className="size-4" />
                  {t('chat:conversation.delete')}
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </SidebarMenuItem>
  );
};
