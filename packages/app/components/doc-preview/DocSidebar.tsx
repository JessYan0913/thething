"use client";

import { PlusIcon, TrashIcon, FileTextIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { DocItem } from "./DocPreviewLayout";

interface DocSidebarProps {
  docs: DocItem[];
  selectedDocId: string | null;
  onSelectDoc: (id: string) => void;
  onNewDoc: () => void;
  onDeleteDoc: (id: string) => void;
}

export function DocSidebar({
  docs,
  selectedDocId,
  onSelectDoc,
  onNewDoc,
  onDeleteDoc,
}: DocSidebarProps) {
  // 按时间分组
  const now = new Date();
  const today: DocItem[] = [];
  const thisWeek: DocItem[] = [];
  const earlier: DocItem[] = [];

  for (const doc of docs) {
    const diff = now.getTime() - doc.updatedAt.getTime();
    const days = diff / (1000 * 60 * 60 * 24);

    if (days < 1) {
      today.push(doc);
    } else if (days < 7) {
      thisWeek.push(doc);
    } else {
      earlier.push(doc);
    }
  }

  const formatDate = (date: Date) => {
    return date.toLocaleDateString("zh-CN", {
      month: "short",
      day: "numeric",
    });
  };

  return (
    <div className="flex h-full w-64 flex-col border-r bg-muted/30">
      {/* 顶部：新建按钮 */}
      <div className="flex items-center justify-between p-3 border-b">
        <span className="text-sm font-medium text-muted-foreground">
          {docs.length} 个文档
        </span>
        <Button
          variant="ghost"
          size="icon"
          className="size-8"
          onClick={onNewDoc}
        >
          <PlusIcon className="size-4" />
        </Button>
      </div>

      {/* 文档列表 */}
      <div className="flex-1 overflow-auto p-2">
        {/* 今天 */}
        {today.length > 0 && (
          <div className="mb-4">
            <h3 className="px-2 py-1 text-xs font-medium text-muted-foreground uppercase tracking-wider">
              今天
            </h3>
            {today.map((doc) => (
              <DocItem
                key={doc.id}
                doc={doc}
                isSelected={doc.id === selectedDocId}
                onSelect={() => onSelectDoc(doc.id)}
                onDelete={() => onDeleteDoc(doc.id)}
                formatDate={formatDate}
              />
            ))}
          </div>
        )}

        {/* 本周 */}
        {thisWeek.length > 0 && (
          <div className="mb-4">
            <h3 className="px-2 py-1 text-xs font-medium text-muted-foreground uppercase tracking-wider">
              本周
            </h3>
            {thisWeek.map((doc) => (
              <DocItem
                key={doc.id}
                doc={doc}
                isSelected={doc.id === selectedDocId}
                onSelect={() => onSelectDoc(doc.id)}
                onDelete={() => onDeleteDoc(doc.id)}
                formatDate={formatDate}
              />
            ))}
          </div>
        )}

        {/* 更早 */}
        {earlier.length > 0 && (
          <div className="mb-4">
            <h3 className="px-2 py-1 text-xs font-medium text-muted-foreground uppercase tracking-wider">
              更早
            </h3>
            {earlier.map((doc) => (
              <DocItem
                key={doc.id}
                doc={doc}
                isSelected={doc.id === selectedDocId}
                onSelect={() => onSelectDoc(doc.id)}
                onDelete={() => onDeleteDoc(doc.id)}
                formatDate={formatDate}
              />
            ))}
          </div>
        )}
      </div>

      {/* 底部：用户信息 */}
      <div className="border-t p-3">
        <div className="flex items-center gap-2">
          <div className="flex size-8 items-center justify-center rounded-full bg-primary text-primary-foreground text-sm font-medium">
            Y
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium truncate">用户</p>
            <p className="text-xs text-muted-foreground truncate">user@example.com</p>
          </div>
        </div>
      </div>
    </div>
  );
}

function DocItem({
  doc,
  isSelected,
  onSelect,
  onDelete,
  formatDate,
}: {
  doc: DocItem;
  isSelected: boolean;
  onSelect: () => void;
  onDelete: () => void;
  formatDate: (date: Date) => string;
}) {
  return (
    <div
      className={`group flex items-center gap-2 rounded-md px-2 py-1.5 cursor-pointer transition-colors ${
        isSelected
          ? "bg-accent text-accent-foreground"
          : "hover:bg-accent/50"
      }`}
      onClick={onSelect}
    >
      <FileTextIcon className="size-4 shrink-0 text-muted-foreground" />
      <div className="flex-1 min-w-0">
        <p className="text-sm truncate">{doc.title}</p>
        <p className="text-xs text-muted-foreground">{formatDate(doc.updatedAt)}</p>
      </div>
      <Button
        variant="ghost"
        size="icon"
        className="size-6 opacity-0 group-hover:opacity-100 transition-opacity"
        onClick={(e) => {
          e.stopPropagation();
          onDelete();
        }}
      >
        <TrashIcon className="size-3" />
      </Button>
    </div>
  );
}
