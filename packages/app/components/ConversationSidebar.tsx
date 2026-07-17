import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
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
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import {
  MessageSquareIcon,
  PencilIcon,
  PlusIcon,
  TrashIcon,
  SettingsIcon,
  MoreHorizontalIcon,
  FolderIcon,
  FolderOpenIcon,
  Loader2Icon,
} from "lucide-react";
import Link from "next/link";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";

// ============================================================================
// Electron API Type
// ============================================================================

declare global {
  interface Window {
    electronAPI?: {
      selectDirectory: () => Promise<string | null>;
    };
    // File System Access API (Chrome/Edge)
    showDirectoryPicker?: () => Promise<FileSystemDirectoryHandle>;
  }
}

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
// Project Name Input (Web fallback when native dialog unavailable)
// ============================================================================

interface ProjectNameInputProps {
  onSubmit: (name: string) => void;
  onCancel: () => void;
}

function ProjectNameInput({ onSubmit, onCancel }: ProjectNameInputProps) {
  const [name, setName] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const handleSubmit = () => {
    const trimmed = name.trim();
    if (trimmed) {
      onSubmit(trimmed);
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <input
        ref={inputRef}
        className="w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-ring"
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            handleSubmit();
          } else if (e.key === 'Escape') {
            onCancel();
          }
        }}
        placeholder="Project name"
      />
      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={onCancel}>
          Cancel
        </Button>
        <Button onClick={handleSubmit} disabled={!name.trim()}>
          Create
        </Button>
      </div>
    </div>
  );
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
  projectId: string | null;
  createdAt: string;
  updatedAt: string;
  runStatus?: 'running' | 'paused_approval' | 'completed' | 'failed' | null;
}

export interface ProjectItem {
  id: string;
  name: string;
  path: string;
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
  activeFilter?: string;
  projects?: ProjectItem[];
  activeProjectId?: string | null;
  onSelectProject?: (projectId: string | null) => void;
  onCreateProject?: (name: string, path: string) => Promise<ProjectItem | null>;
  onDeleteProject?: (projectId: string) => Promise<void>;
};

export const ConversationSidebar = ({
  conversations,
  activeConversationId,
  onSelectConversation,
  onCreateConversation,
  onDeleteConversation,
  onRenameConversation,
  isLoading = false,
  activeFilter = "user",
  projects = [],
  activeProjectId = null,
  onSelectProject,
  onCreateProject,
  onDeleteProject,
}: ConversationSidebarProps) => {
  const { t } = useTranslation();
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [showNewProjectDialog, setShowNewProjectDialog] = useState(false);
  const [deleteProjectConfirmId, setDeleteProjectConfirmId] = useState<string | null>(null);

  const grouped = useMemo(() => groupConversations(conversations), [conversations]);

  // Find the conversation being deleted for the dialog title
  const deletingConversation = useMemo(
    () => conversations.find((c) => c.id === deleteConfirmId),
    [conversations, deleteConfirmId]
  );

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
      <SidebarContent className="overflow-hidden! p-0!">
        {/* Project Area — fixed height, independent scroll */}
        {activeFilter === 'user' && (
          <SidebarGroup className="group-data-[collapsible=icon]:hidden overflow-y-auto shrink-0 max-h-[40vh]">
            <SidebarGroupLabel className="flex items-center justify-between pr-1">
              <span className="flex items-center gap-1.5">
                <FolderIcon className="size-3" />
                {t('chat:conversation.projects', 'Projects')}
              </span>
              {onSelectProject && (
                <button
                  onClick={async () => {
                    try {
                      if (window.electronAPI) {
                        // Desktop: use native directory picker
                        const dirPath = await window.electronAPI.selectDirectory();
                        if (dirPath && onCreateProject) {
                          const name = dirPath.split('/').filter(Boolean).pop() || dirPath;
                          await onCreateProject(name, dirPath);
                        }
                      } else if (window.showDirectoryPicker) {
                        // Web (Chrome/Edge): use File System Access API
                        const dirHandle = await window.showDirectoryPicker();
                        if (onCreateProject) {
                          await onCreateProject(dirHandle.name, dirHandle.name);
                        }
                      } else {
                        // Web (other browsers): fallback to name input dialog
                        setShowNewProjectDialog(true);
                      }
                    } catch (err: unknown) {
                      // User cancelled or error - do nothing
                      if (err instanceof Error && err.name !== 'AbortError') {
                        console.error('Failed to select directory:', err);
                      }
                    }
                  }}
                  className="rounded-md p-0.5 text-muted-foreground hover:bg-sidebar-accent hover:text-foreground transition-colors"
                  title={t('chat:conversation.newProject', 'New Project')}
                >
                  <PlusIcon className="size-3" />
                </button>
              )}
            </SidebarGroupLabel>
            <SidebarGroupContent>
              {projects.length === 0 ? (
                <div className="px-2 py-1.5">
                  <button
                    onClick={async () => {
                      try {
                        if (window.electronAPI) {
                          // Desktop: use native directory picker
                          const dirPath = await window.electronAPI.selectDirectory();
                          if (dirPath && onCreateProject) {
                            const name = dirPath.split('/').filter(Boolean).pop() || dirPath;
                            await onCreateProject(name, dirPath);
                          }
                        } else if (window.showDirectoryPicker) {
                          // Web (Chrome/Edge): use File System Access API
                          const dirHandle = await window.showDirectoryPicker();
                          if (onCreateProject) {
                            await onCreateProject(dirHandle.name, dirHandle.name);
                          }
                        } else {
                          // Web (other browsers): fallback to name input dialog
                          setShowNewProjectDialog(true);
                        }
                      } catch (err: unknown) {
                        // User cancelled or error - do nothing
                        if (err instanceof Error && err.name !== 'AbortError') {
                          console.error('Failed to select directory:', err);
                        }
                      }
                    }}
                    className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-xs text-muted-foreground hover:bg-sidebar-accent hover:text-foreground transition-colors"
                  >
                    <FolderOpenIcon className="size-3.5 shrink-0" />
                    <span>{t('chat:conversation.createFirstProject', 'Create a project')}</span>
                  </button>
                </div>
              ) : (
                <SidebarMenu>
                  {/* "All" option */}
                  <SidebarMenuItem>
                    <SidebarMenuButton
                      isActive={activeProjectId === null}
                      onClick={() => onSelectProject?.(null)}
                      tooltip={t('chat:conversation.allProjects', 'All Projects')}
                    >
                      {activeProjectId === null ? (
                        <FolderOpenIcon className="size-4 shrink-0" />
                      ) : (
                        <FolderIcon className="size-4 shrink-0" />
                      )}
                      <span className="truncate">{t('chat:conversation.allProjects', 'All Projects')}</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                  {/* Project items */}
                  {projects.map((project) => (
                    <SidebarMenuItem key={project.id}>
                      <SidebarMenuButton
                        isActive={activeProjectId === project.id}
                        onClick={() => onSelectProject?.(project.id)}
                        tooltip={`${project.name}\n${project.path}`}
                      >
                        {activeProjectId === project.id ? (
                          <FolderOpenIcon className="size-4 shrink-0" />
                        ) : (
                          <FolderIcon className="size-4 shrink-0" />
                        )}
                        <span className="truncate">{project.name}</span>
                      </SidebarMenuButton>
                      <DropdownMenu>
                        <SidebarMenuAction showOnHover asChild>
                          <DropdownMenuTrigger>
                            <MoreHorizontalIcon className="size-4" />
                          </DropdownMenuTrigger>
                        </SidebarMenuAction>
                        <DropdownMenuContent side="right" align="start" onClick={(e) => e.stopPropagation()}>
                          <DropdownMenuItem
                            variant="destructive"
                            onClick={() => setDeleteProjectConfirmId(project.id)}
                            onSelect={(e) => e.preventDefault()}
                          >
                            <TrashIcon className="size-4" />
                            {t('chat:conversation.delete')}
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </SidebarMenuItem>
                  ))}
                </SidebarMenu>
              )}
            </SidebarGroupContent>
          </SidebarGroup>
        )}

        {/* Conversations — remaining space, independent scroll */}
        <SidebarGroup className="group-data-[collapsible=icon]:hidden flex-1 overflow-y-auto min-h-0">
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
                            onDelete={() => setDeleteConfirmId(conv.id)}
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

      {/* Footer — system settings */}
      <SidebarFooter className="border-t border-sidebar-border">
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton asChild tooltip={t('settings:sidebar.systemSettings')}>
              <Link href="/settings" className="text-muted-foreground hover:text-foreground transition-colors">
                <SettingsIcon className="size-4" />
                <span className="text-xs">{t('settings:sidebar.systemSettings')}</span>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>

      {/* Rail for hover-to-toggle */}
      <SidebarRail />

      {/* Delete confirmation dialog */}
      <Dialog open={deleteConfirmId !== null} onOpenChange={(open) => { if (!open) setDeleteConfirmId(null); }}>
        <DialogContent showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>{t('chat:conversation.deleteConfirm', { title: deletingConversation?.title })}</DialogTitle>
            <DialogDescription>{t('chat:conversation.deleteDescription')}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteConfirmId(null)}>
              {t('common:buttons.cancel')}
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                if (deleteConfirmId) {
                  onDeleteConversation(deleteConfirmId);
                  setDeleteConfirmId(null);
                }
              }}
            >
              {t('chat:conversation.delete')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* New project dialog — web fallback when not in Electron */}
      <Dialog open={showNewProjectDialog} onOpenChange={(open) => {
        if (!open) setShowNewProjectDialog(false);
      }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t('chat:conversation.createProject', 'New Project')}</DialogTitle>
            <DialogDescription>{t('chat:conversation.createProjectDescription', 'Select a working directory. The folder name will be used as the project name.')}</DialogDescription>
          </DialogHeader>
          <ProjectNameInput
            onSubmit={async (name) => {
              if (onCreateProject) {
                await onCreateProject(name, '');
                setShowNewProjectDialog(false);
              }
            }}
            onCancel={() => setShowNewProjectDialog(false)}
          />
        </DialogContent>
      </Dialog>

      {/* Delete project confirmation dialog */}
      <Dialog open={deleteProjectConfirmId !== null} onOpenChange={(open) => { if (!open) setDeleteProjectConfirmId(null); }}>
        <DialogContent showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>{t('chat:conversation.deleteProjectConfirm', 'Delete Project?')}</DialogTitle>
            <DialogDescription>{t('chat:conversation.deleteProjectDescription', 'This will only remove the project from the list. Files on disk will not be affected.')}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteProjectConfirmId(null)}>
              {t('common:buttons.cancel')}
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                if (deleteProjectConfirmId && onDeleteProject) {
                  onDeleteProject(deleteProjectConfirmId);
                  setDeleteProjectConfirmId(null);
                }
              }}
            >
              {t('chat:conversation.delete')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
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
    (e: React.KeyboardEvent<HTMLInputElement>) => {
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
            {conversation.runStatus === 'running' || conversation.runStatus === 'paused_approval' ? (
              <Loader2Icon className="size-4 shrink-0 animate-spin text-primary" />
            ) : (
              <MessageSquareIcon className="size-4 shrink-0" />
            )}
            <span className="truncate flex-1 min-w-0">{conversation.title}</span>
          </>
        )}
      </SidebarMenuButton>

      {!isEditing && (
        <DropdownMenu>
          <SidebarMenuAction showOnHover asChild>
            <DropdownMenuTrigger>
              <MoreHorizontalIcon className="size-4" />
            </DropdownMenuTrigger>
          </SidebarMenuAction>
          <DropdownMenuContent side="right" align="start" onClick={(e: React.MouseEvent) => e.stopPropagation()}>
            <DropdownMenuItem onClick={handleStartEdit}>
              <PencilIcon className="size-4" />
              {t('chat:conversation.rename')}
            </DropdownMenuItem>
            <DropdownMenuItem
              variant="destructive"
              onClick={onDelete}
              onSelect={(e: { preventDefault: () => void }) => e.preventDefault()}
            >
              <TrashIcon className="size-4" />
              {t('chat:conversation.delete')}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </SidebarMenuItem>
  );
};
