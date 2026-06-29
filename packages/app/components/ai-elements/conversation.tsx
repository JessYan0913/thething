"use client";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { UIMessage } from "ai";
import { ArrowDownIcon, DownloadIcon } from "lucide-react";
import type { ComponentProps } from "react";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

// ============================================================
// Constants
// ============================================================

const SCROLL_THRESHOLD = 100;

// ============================================================
// Context
// ============================================================

interface ConversationContextType {
  scrollToBottom: (behavior?: ScrollBehavior) => void;
  isAtBottom: boolean;
}

const ConversationContext = createContext<ConversationContextType | null>(null);

const useConversationContext = () => {
  const context = useContext(ConversationContext);
  if (!context) {
    throw new Error(
      "Conversation components must be used within a <Conversation>"
    );
  }
  return context;
};

// ============================================================
// Conversation (root)
// ============================================================

export type ConversationProps = ComponentProps<"div">;

export const Conversation = ({
  className,
  children,
  ...props
}: ConversationProps) => {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const [isAtBottom, setIsAtBottom] = useState(true);
  const isNearBottomRef = useRef(true);

  // Track scroll position
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;

    const handleScroll = () => {
      const { scrollTop, scrollHeight, clientHeight } = el;
      const distanceFromBottom = scrollHeight - scrollTop - clientHeight;
      isNearBottomRef.current = distanceFromBottom <= SCROLL_THRESHOLD;
      setIsAtBottom(distanceFromBottom <= 1);
    };

    el.addEventListener("scroll", handleScroll, { passive: true });
    handleScroll();
    return () => el.removeEventListener("scroll", handleScroll);
  }, []);

  // Auto-scroll when content grows, but only if user is near bottom
  useEffect(() => {
    const el = contentRef.current;
    if (!el) return;

    let rafId: number | null = null;

    const observer = new ResizeObserver(() => {
      // 使用 rAF 合并密集变化，避免 streaming 时 layout thrashing
      if (rafId !== null) cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(() => {
        rafId = null;
        if (isNearBottomRef.current) {
          const scrollEl = scrollRef.current;
          if (scrollEl) {
            scrollEl.scrollTop = scrollEl.scrollHeight;
          }
        }
      });
    });

    observer.observe(el);
    return () => {
      observer.disconnect();
      if (rafId !== null) cancelAnimationFrame(rafId);
    };
  }, []);

  const scrollToBottom = useCallback(
    (behavior: ScrollBehavior = "smooth") => {
      const el = scrollRef.current;
      if (!el) return;
      el.scrollTo({ top: el.scrollHeight, behavior });
    },
    []
  );

  const contextValue = useMemo<ConversationContextType>(
    () => ({ scrollToBottom, isAtBottom }),
    [scrollToBottom, isAtBottom]
  );

  return (
    <ConversationContext.Provider value={contextValue}>
      <div
        ref={wrapperRef}
        className={cn("relative flex-1", className)}
        role="log"
        {...props}
      >
        <div
          ref={scrollRef}
          className="absolute inset-0 overflow-y-auto"
        >
          <div ref={contentRef}>{children}</div>
        </div>
      </div>
    </ConversationContext.Provider>
  );
};

// ============================================================
// ConversationContent
// ============================================================

export type ConversationContentProps = ComponentProps<"div">;

export const ConversationContent = ({
  className,
  ...props
}: ConversationContentProps) => (
  <div className={cn("flex flex-col gap-8 p-4", className)} {...props} />
);

export type ConversationEmptyStateProps = ComponentProps<"div"> & {
  title?: string;
  description?: string;
  icon?: React.ReactNode;
};

export const ConversationEmptyState = ({
  className,
  title = "No messages yet",
  description = "Start a conversation to see messages here",
  icon,
  children,
  ...props
}: ConversationEmptyStateProps) => (
  <div
    className={cn(
      "flex size-full flex-col items-center justify-center gap-3 p-8 text-center",
      className
    )}
    {...props}
  >
    {children ?? (
      <>
        {icon && <div className="text-muted-foreground">{icon}</div>}
        <div className="space-y-1">
          <h3 className="font-medium text-sm">{title}</h3>
          {description && (
            <p className="text-muted-foreground text-sm">{description}</p>
          )}
        </div>
      </>
    )}
  </div>
);

export type ConversationScrollButtonProps = ComponentProps<typeof Button>;

export const ConversationScrollButton = ({
  className,
  ...props
}: ConversationScrollButtonProps) => {
  const { isAtBottom, scrollToBottom } = useConversationContext();

  if (isAtBottom) return null;

  return (
    <div className="sticky bottom-0 flex justify-center pb-4 z-10">
      <Button
        className={cn(
          "rounded-full shadow-lg dark:bg-background dark:hover:bg-muted",
          className
        )}
        onClick={() => scrollToBottom("smooth")}
        size="icon"
        type="button"
        variant="outline"
        {...props}
      >
        <ArrowDownIcon className="size-4" />
      </Button>
    </div>
  );
};

export type AutoScrollToBottomProps = {
  trigger: unknown;
};

export const AutoScrollToBottom = ({ trigger }: AutoScrollToBottomProps) => {
  const { scrollToBottom } = useConversationContext();
  const hasScrolled = useRef(false);

  useEffect(() => {
    if (trigger && !hasScrolled.current) {
      hasScrolled.current = true;
      requestAnimationFrame(() => {
        scrollToBottom();
      });
    }
  }, [trigger, scrollToBottom]);

  return null;
};

const getMessageText = (message: UIMessage): string =>
  message.parts
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("");

export type ConversationDownloadProps = Omit<
  ComponentProps<typeof Button>,
  "onClick"
> & {
  messages: UIMessage[];
  filename?: string;
  formatMessage?: (message: UIMessage, index: number) => string;
};

const defaultFormatMessage = (message: UIMessage): string => {
  const roleLabel =
    message.role.charAt(0).toUpperCase() + message.role.slice(1);
  return `**${roleLabel}:** ${getMessageText(message)}`;
};

export const messagesToMarkdown = (
  messages: UIMessage[],
  formatMessage: (
    message: UIMessage,
    index: number
  ) => string = defaultFormatMessage
): string => messages.map((msg, i) => formatMessage(msg, i)).join("\n\n");

export const ConversationDownload = ({
  messages,
  filename = "conversation.md",
  formatMessage = defaultFormatMessage,
  className,
  children,
  ...props
}: ConversationDownloadProps) => {
  const handleDownload = useCallback(() => {
    const markdown = messagesToMarkdown(messages, formatMessage);
    const blob = new Blob([markdown], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.append(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }, [messages, filename, formatMessage]);

  return (
    <Button
      className={cn(
        "absolute top-4 right-4 rounded-full dark:bg-background dark:hover:bg-muted",
        className
      )}
      onClick={handleDownload}
      size="icon"
      type="button"
      variant="outline"
      {...props}
    >
      {children ?? <DownloadIcon className="size-4" />}
    </Button>
  );
};
