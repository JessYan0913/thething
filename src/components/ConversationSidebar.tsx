"use client";

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
import { cn } from "@/lib/utils";
import {
  CheckIcon,
  MessageSquareIcon,
  PencilIcon,
  PlusIcon,
  TrashIcon,
  XIcon,
} from "lucide-react";
import { nanoid } from "nanoid";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import { Button } from "@/components/ui/button";

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
};

export const ConversationSidebar = ({
  conversations,
  activeConversationId,
  onSelectConversation,
  onCreateConversation,
  onDeleteConversation,
  onRenameConversation,
  isLoading = false,
}: ConversationSidebarProps) => {
  return (
    <Sidebar collapsible="icon">
      {/* Header with New Conversation button */}
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              onClick={onCreateConversation}
              tooltip="New conversation"
            >
              <PlusIcon />
              <span>New conversation</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>

      {/* Conversation List - hidden when collapsed */}
      <SidebarContent>
        <SidebarGroup className="group-data-[collapsible=icon]:hidden">
          <SidebarGroupContent>
            {isLoading ? (
              <div className="flex items-center justify-center py-8 text-muted-foreground text-xs">
                Loading...
              </div>
            ) : conversations.length === 0 ? (
              <div className="flex flex-col items-center justify-center gap-2 py-8 text-muted-foreground text-xs px-2">
                <MessageSquareIcon className="size-6 opacity-50" />
                <span>No conversations yet</span>
              </div>
            ) : (
              <SidebarMenu>
                {conversations.map((conv) => (
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
            )}
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      {/* Footer */}
      <SidebarFooter />

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
            <span className="truncate text-destructive text-xs">Delete?</span>
            <div className="flex items-center gap-0.5">
              <Button
                className="size-5 rounded-sm"
                onClick={handleConfirmDelete}
                size="icon"
                variant="ghost"
              >
                <CheckIcon className="size-3 text-destructive" />
              </Button>
              <Button
                className="size-5 rounded-sm"
                onClick={handleCancelDelete}
                size="icon"
                variant="ghost"
              >
                <XIcon className="size-3" />
              </Button>
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
            title="Rename"
          >
            <PencilIcon />
          </SidebarMenuAction>
          <SidebarMenuAction
            className="hover:bg-destructive/10 hover:text-destructive"
            onClick={handleStartDelete}
            showOnHover
            title="Delete"
          >
            <TrashIcon />
          </SidebarMenuAction>
        </>
      )}
    </SidebarMenuItem>
  );
};
