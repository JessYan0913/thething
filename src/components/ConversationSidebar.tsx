"use client";

import { Button } from "@/components/ui/button";
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
    <div className="flex h-full w-64 flex-col border-r bg-muted/30">
      {/* Header */}
      <div className="flex items-center justify-between border-b p-3">
        <h2 className="font-medium text-sm">Conversations</h2>
        <Button
          onClick={onCreateConversation}
          size="icon-xs"
          variant="ghost"
          title="New conversation"
        >
          <PlusIcon className="size-4" />
        </Button>
      </div>

      {/* Conversation List */}
      <div className="flex-1 overflow-y-auto p-2">
        {isLoading ? (
          <div className="flex items-center justify-center py-8 text-muted-foreground text-xs">
            Loading...
          </div>
        ) : conversations.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 py-8 text-muted-foreground text-xs">
            <MessageSquareIcon className="size-6 opacity-50" />
            <span>No conversations yet</span>
          </div>
        ) : (
          <div className="flex flex-col gap-1">
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
          </div>
        )}
      </div>
    </div>
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
  const [isHovered, setIsHovered] = useState(false);
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
    <div
      className={cn(
        "group relative flex cursor-pointer items-center rounded-md px-3 py-2 text-sm transition-colors",
        isActive
          ? "bg-accent font-medium text-accent-foreground"
          : "text-muted-foreground hover:bg-accent/50 hover:text-foreground"
      )}
      onClick={onSelect}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => {
        setIsHovered(false);
        setIsDeleting(false);
      }}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "Enter") onSelect();
      }}
    >
      {/* Title or Edit Input */}
      {isEditing ? (
        <input
          className="w-full bg-transparent text-foreground text-sm outline-none"
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
        <span className="flex-1 truncate">{conversation.title}</span>
      )}

      {/* Action Buttons (hover or active) */}
      {!isEditing && !isDeleting && (isHovered || isActive) && (
        <div className="flex items-center gap-0.5">
          <Button
            className="size-5 rounded-sm opacity-60 hover:opacity-100"
            onClick={handleStartEdit}
            size="icon"
            variant="ghost"
          >
            <PencilIcon className="size-3" />
          </Button>
          <Button
            className="size-5 rounded-sm opacity-60 hover:opacity-100 hover:bg-destructive/10 hover:text-destructive"
            onClick={handleStartDelete}
            size="icon"
            variant="ghost"
          >
            <TrashIcon className="size-3" />
          </Button>
        </div>
      )}
    </div>
  );
};
