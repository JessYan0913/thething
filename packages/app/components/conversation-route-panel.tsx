'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArchiveIcon,
  GitBranchIcon,
  MoreHorizontalIcon,
  PinIcon,
  RotateCcwIcon,
  TrashIcon,
  XIcon,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export type ConversationBranchSummary = {
  id: string;
  conversationId: string;
  parentBranchId: string | null;
  forkMessageId: string | null;
  tipMessageId: string | null;
  name: string | null;
  status: 'candidate' | 'active' | 'archived';
  isPinned: boolean;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  preview: string;
  messageCount: number;
  isCurrent: boolean;
};

export type ConversationTreeNode = {
  id: string;
  parentId: string | null;
  role: 'user' | 'assistant' | 'system';
  preview: string;
  createdAt: string;
  childCount: number;
  isActivePath: boolean;
};

export type ConversationTree = {
  revision: number;
  activeTipId: string | null;
  nodes: ConversationTreeNode[];
};

export type BranchAction = 'rename' | 'pin' | 'archive' | 'delete';

type RouteRow = {
  node: ConversationTreeNode;
  lane: number;
  parentRowIndex: number | null;
};

const ROW_HEIGHT = 56;
const LANE_GAP = 36;
const GRAPH_LEFT = 52;
const MAX_VISIBLE_LANE = 5;

function getRouteLabel(branch: ConversationBranchSummary, fallbackPreview?: string) {
  if (branch.name && branch.name !== '主分支') return branch.name;
  if (fallbackPreview) {
    return fallbackPreview.length > 18 ? fallbackPreview.slice(0, 18) + '...' : fallbackPreview;
  }
  return '未命名路线';
}

function findOwningUserNodeId(
  messageId: string | null,
  byId: Map<string, ConversationTreeNode>,
): string | null {
  let currentId = messageId;
  while (currentId) {
    const node = byId.get(currentId);
    if (!node) return null;
    if (node.role === 'user') return node.id;
    currentId = node.parentId;
  }
  return null;
}

function buildRouteRows(tree: ConversationTree): {
  rows: RouteRow[];
  laneCount: number;
} {
  const nodes = [...tree.nodes];
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const childrenByParent = new Map<string | null, ConversationTreeNode[]>();
  for (const node of nodes) {
    const children = childrenByParent.get(node.parentId) ?? [];
    children.push(node);
    childrenByParent.set(node.parentId, children);
  }

  const laneById = new Map<string, number>();
  let nextLane = 0;
  const roots = childrenByParent.get(null) ?? [];
  for (const root of roots) laneById.set(root.id, nextLane++);

  for (const node of nodes) {
    const lane = laneById.get(node.id) ?? nextLane++;
    const children = childrenByParent.get(node.id) ?? [];
    const continuingChild = children.find((child) => child.isActivePath) ?? children[0];
    if (continuingChild) laneById.set(continuingChild.id, lane);
    for (const child of children) {
      if (child.id !== continuingChild?.id) laneById.set(child.id, nextLane++);
    }
  }

  // 倒序排列：最新对话节点在最上方，历史节点向下延伸（连线/索引基于倒序数组自洽）
  const visibleNodes = nodes.filter((node) => node.role === 'user').reverse();
  const visibleIds = new Set(visibleNodes.map((node) => node.id));
  const rowIndexById = new Map(visibleNodes.map((node, index) => [node.id, index]));
  const rows = visibleNodes.map((node): RouteRow => ({
    node,
    lane: Math.min(laneById.get(node.id) ?? 0, MAX_VISIBLE_LANE),
    parentRowIndex: findNearestUserAncestor(node, byId, visibleIds, rowIndexById),
  }));

  return {
    rows,
    laneCount: Math.min(Math.max(nextLane, 1), MAX_VISIBLE_LANE + 1),
  };
}

function findNearestUserAncestor(
  node: ConversationTreeNode,
  byId: Map<string, ConversationTreeNode>,
  visibleIds: Set<string>,
  rowIndexById: Map<string, number>,
): number | null {
  let parentId = node.parentId;
  while (parentId && !visibleIds.has(parentId)) {
    parentId = byId.get(parentId)?.parentId ?? null;
  }
  return parentId ? rowIndexById.get(parentId) ?? null : null;
}

function BranchMenu({
  branch,
  disabled,
  open,
  onOpenChange,
  onManage,
}: {
  branch: ConversationBranchSummary;
  disabled: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onManage: (branch: ConversationBranchSummary, action: BranchAction) => void;
}) {
  return (
    <div className="relative shrink-0">
      <button
        type="button"
        aria-label={`管理路线 ${getRouteLabel(branch)}`}
        className="flex size-6 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-50"
        disabled={disabled}
        onClick={(event) => {
          event.stopPropagation();
          onOpenChange(!open);
        }}
      >
        <MoreHorizontalIcon className="size-3.5" />
      </button>
      {open && (
        <div className="absolute right-0 top-7 z-40 w-32 rounded-md border bg-popover p-1 text-popover-foreground shadow-md">
          <button className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs hover:bg-accent" onClick={() => onManage(branch, 'pin')}>
            <PinIcon className="size-3.5" />{branch.isPinned ? '取消固定' : '固定路线'}
          </button>
          {!branch.isCurrent && (
            <button className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs hover:bg-accent" onClick={() => onManage(branch, 'archive')}>
              {branch.status === 'archived' ? <RotateCcwIcon className="size-3.5" /> : <ArchiveIcon className="size-3.5" />}
              {branch.status === 'archived' ? '恢复路线' : '归档路线'}
            </button>
          )}
          {!branch.isCurrent && (
            <button className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs text-destructive hover:bg-destructive/10" onClick={() => onManage(branch, 'delete')}>
              <TrashIcon className="size-3.5" />删除路线
            </button>
          )}
        </div>
      )}
    </div>
  );
}

export function ConversationRoutePanel({
  tree,
  branches,
  switching,
  error,
  onClose,
  onSelectBranch,
  onManage,
}: {
  tree: ConversationTree;
  branches: ConversationBranchSummary[];
  switching: boolean;
  error: string | null;
  onClose: () => void;
  onSelectBranch: (branchId: string) => void;
  onManage: (branch: ConversationBranchSummary, action: BranchAction) => void;
}) {
  const nodesById = useMemo(() => new Map(tree.nodes.map((node) => [node.id, node])), [tree.nodes]);
  const activeUserNodeId = useMemo(
    () => findOwningUserNodeId(tree.activeTipId, nodesById),
    [tree.activeTipId, nodesById],
  );
  const currentBranch = branches.find((branch) => branch.isCurrent) ?? null;
  const [selectedBranchId, setSelectedBranchId] = useState<string | null>(currentBranch?.id ?? null);
  const [hoveredBranchId, setHoveredBranchId] = useState<string | null>(null);
  const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null);
  const [openMenuBranchId, setOpenMenuBranchId] = useState<string | null>(null);

  const userPickedRef = useRef(false);

  useEffect(() => {
    if (userPickedRef.current) {
      if (selectedBranchId === currentBranch?.id) userPickedRef.current = false;
    } else {
      setSelectedBranchId(currentBranch?.id ?? null);
    }
  }, [currentBranch?.id, selectedBranchId]);

  const { rows, laneCount } = useMemo(() => buildRouteRows(tree), [tree]);

  const branchPaths = useMemo(() => {
    const result = new Map<string, Set<string>>();
    for (const branch of branches) {
      const path = new Set<string>();
      let messageId = branch.tipMessageId;
      while (messageId) {
        const node = nodesById.get(messageId);
        if (!node) break;
        if (node.role === 'user') path.add(node.id);
        messageId = node.parentId;
      }
      result.set(branch.id, path);
    }
    return result;
  }, [branches, nodesById]);

  const branchesByTip = useMemo(() => {
    const result = new Map<string, ConversationBranchSummary[]>();
    for (const branch of branches) {
      const userNodeId = findOwningUserNodeId(branch.tipMessageId, nodesById);
      if (!userNodeId) continue;
      const values = result.get(userNodeId) ?? [];
      values.push(branch);
      result.set(userNodeId, values);
    }
    return result;
  }, [branches, nodesById]);

  const selectedBranch = branches.find((branch) => branch.id === selectedBranchId) ?? currentBranch;
  const hoveredBranch = branches.find((branch) => branch.id === hoveredBranchId) ?? null;

  const effectiveHighlightedPath = useMemo(() => {
    if (hoveredBranchId) return branchPaths.get(hoveredBranchId) ?? null;
    const fallbackId = selectedBranch?.id ?? currentBranch?.id ?? null;
    return fallbackId ? (branchPaths.get(fallbackId) ?? null) : null;
  }, [hoveredBranchId, branchPaths, selectedBranch?.id, currentBranch?.id]);

  const graphWidth = GRAPH_LEFT * 2 + (laneCount - 1) * LANE_GAP;

  const confirmSelection = () => {
    if (!selectedBranch || selectedBranch.isCurrent || selectedBranch.status === 'archived') return;
    onSelectBranch(selectedBranch.id);
  };

  return (
    <aside className="flex h-full w-[360px] shrink-0 flex-col border-l bg-background max-md:absolute max-md:inset-y-0 max-md:right-0 max-md:z-30 max-md:w-[min(360px,100vw)] max-md:shadow-xl">
      <div className="flex h-14 shrink-0 items-center justify-between border-b px-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-sm font-medium">
            <GitBranchIcon className="size-4" />
            对话路线
          </div>
          <div className="mt-0.5 truncate text-[11px] text-muted-foreground">
            {hoveredBranch
              ? `预览：${getRouteLabel(hoveredBranch)}`
              : currentBranch
                ? `当前：${getRouteLabel(currentBranch, nodesById.get(activeUserNodeId ?? '')?.preview)}`
                : '无路线'}
          </div>
        </div>
        <Button size="icon-sm" variant="ghost" onClick={onClose} aria-label="关闭对话路线">
          <XIcon className="size-4" />
        </Button>
      </div>

      {error && (
        <div className="mx-3 mt-3 rounded-lg border border-destructive/30 bg-destructive/5 px-2.5 py-2 text-xs text-destructive">
          {error}
        </div>
      )}

      <div
        className="min-h-0 flex-1 overflow-auto overscroll-contain px-3 py-3"
        onClick={() => setOpenMenuBranchId(null)}
      >
        {rows.length === 0 ? (
          <div className="rounded-lg border border-dashed p-4 text-center text-xs text-muted-foreground">
            发送第一条消息后，这里会显示对话路线。
          </div>
        ) : (
          <div
            className="relative min-w-full"
            style={{
              minHeight: rows.length * ROW_HEIGHT,
              width: Math.max(320, graphWidth + 180),
            }}
          >
            <svg
              aria-hidden="true"
              className="pointer-events-none absolute left-0 top-0 overflow-visible"
              width={graphWidth}
              height={rows.length * ROW_HEIGHT}
            >
              {rows.map((row, index) => {
                if (row.parentRowIndex == null) return null;
                const parentRow = rows[row.parentRowIndex];
                const x1 = GRAPH_LEFT + parentRow.lane * LANE_GAP;
                const x2 = GRAPH_LEFT + row.lane * LANE_GAP;
                const y1 = row.parentRowIndex * ROW_HEIGHT + ROW_HEIGHT / 2;
                const y2 = index * ROW_HEIGHT + ROW_HEIGHT / 2;
                const middleY = (y1 + y2) / 2;
                const edgeHighlighted = effectiveHighlightedPath?.has(row.node.id)
                  && effectiveHighlightedPath.has(parentRow.node.id);
                return (
                  <path
                    key={`edge-${row.node.id}`}
                    d={`M ${x1} ${y1} C ${x1} ${middleY}, ${x2} ${middleY}, ${x2} ${y2}`}
                    fill="none"
                    stroke={edgeHighlighted ? 'var(--primary)' : 'var(--muted-foreground)'}
                    strokeOpacity={effectiveHighlightedPath ? edgeHighlighted ? 0.95 : 0.12 : row.node.isActivePath ? 0.8 : 0.28}
                    strokeWidth={edgeHighlighted ? 3 : 1.5}
                  />
                );
              })}
            </svg>

            {rows.map((row, index) => {
              const nodeBranches = branchesByTip.get(row.node.id) ?? [];
              const isCurrentTip = row.node.id === activeUserNodeId;
              const nodeHighlighted = effectiveHighlightedPath?.has(row.node.id) ?? false;
              const x = GRAPH_LEFT + row.lane * LANE_GAP;
              return (
                <div key={row.node.id} className="absolute left-0 right-0" style={{ top: index * ROW_HEIGHT, height: ROW_HEIGHT }}>
                  {/* 节点圆点 */}
                  <button
                    type="button"
                    aria-label={`${isCurrentTip ? '当前路线节点：' : '路线节点：'}${row.node.preview}`}
                    className="absolute inset-y-0 z-10 flex cursor-pointer items-center rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    style={{ left: x - 16, width: 32 }}
                    onMouseEnter={() => setHoveredNodeId(row.node.id)}
                    onMouseLeave={() => setHoveredNodeId(null)}
                    onFocus={() => setHoveredNodeId(row.node.id)}
                    onBlur={() => setHoveredNodeId(null)}
                    onClick={(event) => {
                      event.stopPropagation();
                      const candidates = branches.filter((b) => branchPaths.get(b.id)?.has(row.node.id));
                      const preferred = candidates.find((b) => !b.isCurrent)
                        ?? candidates.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
                      const branchId = preferred?.id ?? currentBranch?.id ?? null;
                      if (branchId) {
                        userPickedRef.current = branchId !== currentBranch?.id;
                        setSelectedBranchId(branchId);
                      }
                      setOpenMenuBranchId(null);
                    }}
                  >
                    <span
                      className={cn(
                        'mx-auto block size-3 rounded-full border-2 bg-background transition-all hover:scale-125',
                        nodeHighlighted ? 'border-primary opacity-100' : effectiveHighlightedPath ? 'border-muted-foreground/30 opacity-25' : row.node.isActivePath ? 'border-primary' : 'border-muted-foreground/50',
                        hoveredNodeId === row.node.id && 'scale-150 bg-primary ring-4 ring-primary/20',
                        isCurrentTip && 'size-4 bg-primary',
                      )}
                    />
                  </button>

                  {/* 节点悬浮提示 — 显示完整用户消息 */}
                  {hoveredNodeId === row.node.id && (
                    <div
                      className="absolute z-20 max-w-[200px] rounded-md border bg-popover px-2.5 py-2 text-xs leading-5 text-popover-foreground shadow-md"
                      style={{ left: x + 10, top: '50%', transform: 'translateY(-50%)' }}
                    >
                      {row.node.preview}
                    </div>
                  )}

                  {/* 用户消息缩略 + 路线标签 */}
                  <div
                    className="absolute top-1/2 flex -translate-y-1/2 flex-col items-start gap-0.5"
                    style={{ left: x + 14 }}
                  >
                    {/* 非当前节点显示预览：当前节点已在 header 显示，避免重复 */}
                    {!isCurrentTip && row.node.preview && (
                      <span
                        className="max-w-[220px] truncate rounded-md px-2 py-1 text-[11px] leading-4 text-muted-foreground"
                      >
                        {row.node.preview}
                      </span>
                    )}
                    {nodeBranches.length > 0 ? nodeBranches.map((branch) => (
                      <button
                        key={branch.id}
                        type="button"
                        title={branch.preview}
                        className={cn(
                          'rounded-md px-2 py-1 text-left text-[11px] transition-colors hover:bg-accent',
                          branch.id === selectedBranchId ? 'bg-primary/10 font-medium text-primary' : 'text-muted-foreground',
                          branch.status === 'archived' && 'line-through opacity-60',
                        )}
                        onMouseEnter={() => setHoveredBranchId(branch.id)}
                        onMouseLeave={() => setHoveredBranchId(null)}
                        onFocus={() => setHoveredBranchId(branch.id)}
                        onBlur={() => setHoveredBranchId(null)}
                        onClick={(event) => {
                          event.stopPropagation();
                          userPickedRef.current = !branch.isCurrent;
                          setSelectedBranchId(branch.id);
                          setOpenMenuBranchId(null);
                        }}
                      >
                        <span className="flex items-center gap-1">
                          {branch.isPinned && <PinIcon className="size-2.5" />}
                          {getRouteLabel(branch, row.node.preview)}
                          {branch.isCurrent && ' · 当前'}
                        </span>
                      </button>
                    )) : (
                      isCurrentTip && (
                        <span className="px-2 py-1 text-[11px] font-medium text-primary">你在这里</span>
                      )
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {selectedBranch && (
        <div className="shrink-0 border-t bg-muted/20 px-3 py-3">
          <div className="flex items-start gap-3">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 text-xs font-medium">
                <span>{selectedBranch.isCurrent ? '当前路线' : getRouteLabel(selectedBranch, nodesById.get(findOwningUserNodeId(selectedBranch.tipMessageId, nodesById) ?? '')?.preview)}</span>
                <span className="font-normal text-muted-foreground">{selectedBranch.messageCount} 条消息</span>
              </div>
              <div className="mt-1.5 line-clamp-4 text-xs leading-5 text-foreground">{selectedBranch.preview}</div>
            </div>
            <BranchMenu
              branch={selectedBranch}
              disabled={switching}
              open={openMenuBranchId === selectedBranch.id}
              onOpenChange={(open) => setOpenMenuBranchId(open ? selectedBranch.id : null)}
              onManage={(branch, action) => {
                setOpenMenuBranchId(null);
                onManage(branch, action);
              }}
            />
          </div>
          {!selectedBranch.isCurrent && (
            <Button
              className="mt-3 w-full"
              size="sm"
              disabled={switching || selectedBranch.status === 'archived'}
              onClick={confirmSelection}
            >
              {switching ? '切换中...' : '切换到该分支'}
            </Button>
          )}
        </div>
      )}
    </aside>
  );
}
