"use client";

import { useState, useEffect, useCallback } from "react";
import {
  FileTextIcon,
  Loader2Icon,
  DownloadIcon,
  PresentationIcon,
  AlertCircleIcon,
  FileIcon,
  FileWarningIcon,
  FileSpreadsheetIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { WordViewer } from "./word-viewer";
import { ExcelViewer } from "./excel-viewer";
import { PptViewer } from "./ppt-viewer";
import { TikaViewer } from "./tika-viewer";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type OfficeType = "word" | "excel" | "ppt" | "word-old" | "ppt-old" | "unknown";

interface DocumentViewerProps {
  /** 文件 URL（blob URL、http URL 或本地文件路径） */
  src: string;
  /** 文件名 */
  filename?: string;
  /** MIME 类型 */
  mediaType?: string;
  /** 类名 */
  className?: string;
  /** 是否显示顶部工具栏（在 file-preview-panel 内嵌时关闭避免重复） */
  showHeader?: boolean;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getOfficeType(filename: string, mediaType?: string): OfficeType {
  const ext = filename.split(".").pop()?.toLowerCase() || "";

  if (
    ext === "docx" ||
    mediaType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  )
    return "word";
  if (ext === "doc" || mediaType === "application/msword") return "word-old";
  if (
    ext === "xlsx" ||
    ext === "xls" ||
    mediaType?.includes("spreadsheetml") ||
    mediaType?.includes("ms-excel")
  )
    return "excel";
  if (
    ext === "pptx" ||
    mediaType === "application/vnd.openxmlformats-officedocument.presentationml.presentation"
  )
    return "ppt";
  if (ext === "ppt" || mediaType === "application/vnd.ms-powerpoint") return "ppt-old";
  return "unknown";
}

async function fetchArrayBuffer(src: string): Promise<ArrayBuffer> {
  if (src.startsWith("data:")) {
    const base64 = src.split(",")[1];
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes.buffer;
  }

  if (src.startsWith("http://") || src.startsWith("https://") || src.startsWith("blob:")) {
    const res = await fetch(src);
    return res.arrayBuffer();
  }

  // 本地文件路径 → 通过 /api/fs 读取
  const res = await fetch(`/api/fs?action=read&path=${encodeURIComponent(src)}&encoding=base64`);
  if (!res.ok) throw new Error(`读取文件失败: HTTP ${res.status}`);
  const data = await res.json();
  const binary = atob(data.content);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

function getTypeLabel(type: OfficeType): string {
  switch (type) {
    case "word":
    case "word-old":
      return "Word 文档";
    case "excel":
      return "Excel 表格";
    case "ppt":
    case "ppt-old":
      return "PowerPoint 演示";
    default:
      return "文档";
  }
}

function getTypeIcon(type: OfficeType) {
  switch (type) {
    case "word":
    case "word-old":
      return FileTextIcon;
    case "excel":
      return FileSpreadsheetIcon;
    case "ppt":
    case "ppt-old":
      return PresentationIcon;
    default:
      return FileIcon;
  }
}

// ---------------------------------------------------------------------------
// 文本提取回退（针对不需要 Tika 的格式）
// ---------------------------------------------------------------------------

async function extractText(arrayBuffer: ArrayBuffer, type: OfficeType): Promise<string> {
  switch (type) {
    case "word": {
      const mammoth = await import("mammoth");
      const result = await mammoth.extractRawText({ arrayBuffer });
      return result.value;
    }
    case "excel": {
      const XLSX = await import("xlsx");
      const workbook = XLSX.read(arrayBuffer, { type: "array" });
      const sections: string[] = [];
      for (const name of workbook.SheetNames) {
        const sheet = workbook.Sheets[name];
        const rows: (string | number | boolean | null)[][] = XLSX.utils.sheet_to_json(sheet, {
          header: 1,
          defval: "",
        });
        if (!rows.length) continue;
        const header = rows[0].map(String);
        const sep = header.map(() => "---");
        sections.push(
          `### ${name}\n\n${[header, sep, ...rows.slice(1).map((r) => r.map(String))].map(
            (r) => `| ${r.join(" | ")} |`
          ).join("\n")}`
        );
      }
      return sections.join("\n\n") || "(空工作簿)";
    }
    case "ppt": {
      const JSZip = await import("jszip");
      const zip = await JSZip.loadAsync(arrayBuffer);
      const sections: string[] = [];
      const slideFiles = Object.keys(zip.files)
        .filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name))
        .sort((a, b) => {
          const na = parseInt(a.match(/slide(\d+)\.xml$/)![1]);
          const nb = parseInt(b.match(/slide(\d+)\.xml$/)![1]);
          return na - nb;
        });
      for (const slideFile of slideFiles) {
        const xml = await zip.file(slideFile)!.async("string");
        const texts: string[] = [];
        const regex = /<a:t>([^<]*)<\/a:t>/g;
        let match;
        while ((match = regex.exec(xml)) !== null) {
          const t = match[1].trim();
          if (t) texts.push(t);
        }
        if (!texts.length) continue;
        const slideNum = slideFile.match(/slide(\d+)\.xml/)![1];
        sections.push(`### 幻灯片 ${slideNum}\n\n${texts.join("\n")}`);
      }
      return sections.join("\n\n") || "(空演示文稿)";
    }
    default:
      return "(不支持该格式的文本提取)";
  }
}

// ---------------------------------------------------------------------------
// TextFallbackViewer
// ---------------------------------------------------------------------------

function TextFallbackViewer({ content }: { content: string }) {
  return (
    <div className="flex-1 overflow-auto p-4">
      <div className="flex items-center gap-2 mb-3 pb-2 border-b text-xs text-muted-foreground">
        <FileWarningIcon className="size-3.5" />
        <span>视觉预览不可用，已回退到文本模式</span>
      </div>
      <div className="prose prose-sm dark:prose-invert max-w-none whitespace-pre-wrap">
        {content}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// HeaderBar
// ---------------------------------------------------------------------------

function HeaderBar({
  icon: Icon,
  label,
  subtitle,
  onDownload,
  onTextFallback,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  subtitle?: string;
  onDownload?: () => void;
  onTextFallback?: () => void;
}) {
  return (
    <div className="flex items-center justify-between px-3 py-2 border-b shrink-0">
      <div className="flex items-center gap-2 min-w-0">
        <Icon className="size-4 shrink-0 text-blue-500" />
        <span className="text-sm font-medium truncate">{label}</span>
        {subtitle && (
          <span className="text-xs text-muted-foreground/60">· {subtitle}</span>
        )}
      </div>
      <div className="flex items-center gap-1 shrink-0">
        {onTextFallback && (
          <Button
            variant="ghost"
            size="sm"
            className="h-7 text-xs gap-1"
            onClick={onTextFallback}
            title="查看纯文本内容"
          >
            <FileIcon className="size-3" />
            文本
          </Button>
        )}
        {onDownload && (
          <Button
            variant="ghost"
            size="icon"
            className="size-7"
            onClick={onDownload}
            title="下载"
          >
            <DownloadIcon className="size-4" />
          </Button>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 旧版格式 .xls → 转为 xlsx（SheetJS 转码）
// ---------------------------------------------------------------------------

async function convertXlsToXlsx(arrayBuffer: ArrayBuffer): Promise<ArrayBuffer> {
  const XLSX = await import("xlsx");
  const workbook = XLSX.read(arrayBuffer, { type: "array" });
  const xlsxBuffer = XLSX.write(workbook, { bookType: "xlsx", type: "array" });
  return xlsxBuffer.buffer as ArrayBuffer;
}

function needsXlsConversion(mediaType?: string, filename?: string): boolean {
  const ext = filename?.split(".").pop()?.toLowerCase();
  return ext === "xls" || mediaType === "application/vnd.ms-excel";
}

// ---------------------------------------------------------------------------
// DocumentViewer — 主路由组件
// ---------------------------------------------------------------------------

/**
 * DocumentViewer — 文档预览路由器
 *
 * 根据文件类型分发到对应的 Viewer 组件：
 *
 * docx  ─→ WordViewer   (mammoth.convertToHtml + DOMPurify)
 * doc   ─→ TikaViewer   (服务端 Apache Tika 代理)
 * xlsx  ─→ ExcelViewer  (@js-preview/excel 浏览器端渲染)
 * xls   ─→ SheetJS 转码 → ExcelViewer
 * pptx  ─→ PptViewer    (pptx-preview 浏览器端渲染)
 * ppt   ─→ TikaViewer   (服务端 Apache Tika 代理)
 */
export function DocumentViewer({ src, filename, mediaType, className, showHeader = true }: DocumentViewerProps) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // 渲染所需数据
  const [arrayBuffer, setArrayBuffer] = useState<ArrayBuffer | null>(null);
  const [tikaMode, setTikaMode] = useState(false);

  // 文本回退模式
  const [showTextFallback, setShowTextFallback] = useState(false);
  const [textContent, setTextContent] = useState<string | null>(null);

  const officeType = getOfficeType(filename || "", mediaType);
  const isLegacy = officeType === "word-old" || officeType === "ppt-old";
  const isModernClientRender =
    officeType === "word" || officeType === "excel" || officeType === "ppt";

  // ── 主加载流程 ──────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      try {
        setLoading(true);
        setError(null);
        setArrayBuffer(null);
        setTikaMode(false);
        setTextContent(null);
        setShowTextFallback(false);

        if (isLegacy) {
          // .doc / .ppt → Tika 服务端代理
          setTikaMode(true);
        } else if (isModernClientRender) {
          // .docx / .xlsx / .xls / .pptx → 客户端渲染
          let buf = await fetchArrayBuffer(src);

          // .xls 需要先用 SheetJS 转码为 xlsx
          if (needsXlsConversion(mediaType, filename)) {
            buf = await convertXlsToXlsx(buf);
          }

          if (!cancelled) setArrayBuffer(buf);
        } else {
          if (!cancelled) setError("不支持的 Office 文件格式");
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "加载文件失败");
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    load();

    return () => {
      cancelled = true;
    };
  }, [src, filename, mediaType, officeType, isLegacy, isModernClientRender]);

  // ── 文本回退 ────────────────────────────────────────────────────
  const handleTextFallback = useCallback(async () => {
    try {
      const buf = arrayBuffer || (await fetchArrayBuffer(src));
      const text = await extractText(buf, officeType);
      setTextContent(text);
      setShowTextFallback(true);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "文本提取失败");
    }
  }, [src, arrayBuffer, officeType]);

  // ── 下载 ────────────────────────────────────────────────────────
  const handleDownload = () => {
    const a = document.createElement("a");
    a.href = src;
    a.download = filename || "document";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  // ── 渲染内容区 ──────────────────────────────────────────────────
  const renderContent = () => {
    // Tika 模式 — 旧版格式
    if (tikaMode) {
      return (
        <TikaViewer src={src} filename={filename || "document"} />
      );
    }

    // 文本回退模式
    if (showTextFallback && textContent) {
      return <TextFallbackViewer content={textContent} />;
    }

    // 客户端渲染模式
    if (!arrayBuffer) return null;

    switch (officeType) {
      case "word":
        return <WordViewer arrayBuffer={arrayBuffer} />;
      case "excel":
        return <ExcelViewer arrayBuffer={arrayBuffer} />;
      case "ppt":
        return <PptViewer arrayBuffer={arrayBuffer} />;
      default:
        return null;
    }
  };

  // ── 加载中 ──────────────────────────────────────────────────────
  if (loading) {
    const Icon = getTypeIcon(officeType);
    return (
      <div className={cn("flex flex-col h-full", className)}>
        {showHeader && <HeaderBar icon={Icon} label={getTypeLabel(officeType)} onDownload={handleDownload} />}
        <div className="flex-1 flex flex-col items-center justify-center text-muted-foreground gap-3">
          <Loader2Icon className="size-8 animate-spin" />
          <p className="text-sm">正在转换...</p>
        </div>
      </div>
    );
  }

  // ── 错误 ────────────────────────────────────────────────────────
  if (error) {
    const Icon = getTypeIcon(officeType);
    return (
      <div className={cn("flex flex-col h-full", className)}>
        {showHeader && <HeaderBar icon={Icon} label={getTypeLabel(officeType)} onDownload={handleDownload} />}
        <div className="flex-1 flex flex-col items-center justify-center text-destructive gap-2 p-4">
          <AlertCircleIcon className="size-8" />
          <p className="text-sm text-center">{error}</p>
        </div>
      </div>
    );
  }

  const content = renderContent();
  if (!content) return null;

  return (
    <div className={cn("flex flex-col h-full", className)}>
      {showHeader && (
        <HeaderBar
          icon={getTypeIcon(officeType)}
          label={getTypeLabel(officeType)}
          subtitle={showTextFallback ? "文本模式" : tikaMode ? "" : "预览"}
          onDownload={handleDownload}
          onTextFallback={
            isModernClientRender && !showTextFallback ? handleTextFallback : undefined
          }
        />
      )}
      <div className="flex-1 min-h-0 overflow-hidden">{content}</div>
    </div>
  );
}

/** @deprecated 请使用 DocumentViewer */
export const OfficePreview = DocumentViewer;
