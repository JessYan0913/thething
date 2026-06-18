"use client";

import { useState, useEffect } from "react";
import { FileTextIcon, Loader2Icon, DownloadIcon, TableIcon, PresentationIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface OfficePreviewProps {
  /** 文件 URL（blob URL 或 http URL） */
  src: string;
  /** 文件名 */
  filename?: string;
  /** MIME 类型 */
  mediaType?: string;
  /** 类名 */
  className?: string;
}

/**
 * Office 文件类型
 */
type OfficeType = "word" | "excel" | "ppt" | "unknown";

function getOfficeType(filename: string, mediaType?: string): OfficeType {
  const ext = filename.split(".").pop()?.toLowerCase() || "";

  if (ext === "doc" || ext === "docx" || mediaType?.includes("wordprocessingml")) {
    return "word";
  }
  if (ext === "xls" || ext === "xlsx" || mediaType?.includes("spreadsheetml") || mediaType?.includes("ms-excel")) {
    return "excel";
  }
  if (ext === "ppt" || ext === "pptx" || mediaType?.includes("presentationml") || mediaType?.includes("ms-powerpoint")) {
    return "ppt";
  }
  return "unknown";
}

export function OfficePreview({ src, filename, mediaType, className }: OfficePreviewProps) {
  const [content, setContent] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const officeType = getOfficeType(filename || "", mediaType);

  useEffect(() => {
    const loadAndConvert = async () => {
      try {
        setLoading(true);
        setError(null);

        // 获取文件内容
        let arrayBuffer: ArrayBuffer;

        if (src.startsWith("http://") || src.startsWith("https://") || src.startsWith("blob:")) {
          // HTTP URL 或 blob URL，直接 fetch
          const response = await fetch(src);
          const blob = await response.blob();
          arrayBuffer = await blob.arrayBuffer();
        } else {
          // 本地文件路径，通过 /api/fs 读取（以 base64 格式返回）
          const response = await fetch(`/api/fs?action=read&path=${encodeURIComponent(src)}&encoding=base64`);
          if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
          }
          const data = await response.json();
          // 将 base64 转换为 ArrayBuffer
          const base64 = data.content;
          const binaryString = atob(base64);
          const bytes = new Uint8Array(binaryString.length);
          for (let i = 0; i < binaryString.length; i++) {
            bytes[i] = binaryString.charCodeAt(i);
          }
          arrayBuffer = bytes.buffer;
        }

        // 转换为 base64 data URL
        const bytes = new Uint8Array(arrayBuffer);
        let binary = "";
        for (let i = 0; i < bytes.byteLength; i++) {
          binary += String.fromCharCode(bytes[i]);
        }
        const base64 = btoa(binary);
        const dataUrl = `data:${mediaType || "application/octet-stream"};base64,${base64}`;

        // 动态导入转换库
        let convertedText = "";

        if (officeType === "word") {
          const mammoth = await import("mammoth");
          const result = await mammoth.extractRawText({ arrayBuffer });
          convertedText = result.value;
        } else if (officeType === "excel") {
          const XLSX = await import("xlsx");
          const workbook = XLSX.read(arrayBuffer, { type: "array" });
          const sections: string[] = [];

          for (const sheetName of workbook.SheetNames) {
            const sheet = workbook.Sheets[sheetName];
            const rows: (string | number | boolean | null)[][] = XLSX.utils.sheet_to_json(sheet, {
              header: 1,
              defval: "",
            });
            if (rows.length === 0) continue;

            const header = rows[0].map(String);
            const separator = header.map(() => "---");
            const dataRows = rows.slice(1).map((r) => r.map(String));

            const tableRows = [header, separator, ...dataRows];
            sections.push(
              `### ${sheetName}\n\n` +
              tableRows.map((r) => `| ${r.join(" | ")} |`).join("\n")
            );
          }

          convertedText = sections.join("\n\n") || "(空工作簿)";
        } else if (officeType === "ppt") {
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
            if (texts.length === 0) continue;

            const slideNum = slideFile.match(/slide(\d+)\.xml/)![1];
            sections.push(`### 幻灯片 ${slideNum}\n\n${texts.join("\n")}`);
          }

          convertedText = sections.join("\n\n") || "(空演示文稿)";
        } else {
          convertedText = "(不支持的 Office 文件格式)";
        }

        setContent(convertedText);
      } catch (err) {
        setError(err instanceof Error ? err.message : "转换失败");
      } finally {
        setLoading(false);
      }
    };

    loadAndConvert();
  }, [src, mediaType, officeType]);

  const handleDownload = () => {
    const a = document.createElement("a");
    a.href = src;
    a.download = filename || "document";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
        <Loader2Icon className="size-6 animate-spin mb-2" />
        <p className="text-sm">正在转换文件...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-destructive">
        <p className="text-sm">{error}</p>
      </div>
    );
  }

  return (
    <div className={cn("flex flex-col h-full", className)}>
      {/* 文件类型标识 */}
      <div className="flex items-center justify-between px-3 py-2 border-b">
        <div className="flex items-center gap-2">
          {officeType === "word" && <FileTextIcon className="size-4 text-blue-500" />}
          {officeType === "excel" && <TableIcon className="size-4 text-green-500" />}
          {officeType === "ppt" && <PresentationIcon className="size-4 text-orange-500" />}
          <span className="text-sm font-medium">
            {officeType === "word" && "Word 文档"}
            {officeType === "excel" && "Excel 表格"}
            {officeType === "ppt" && "PowerPoint 演示"}
          </span>
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="size-7"
          onClick={handleDownload}
        >
          <DownloadIcon className="size-4" />
        </Button>
      </div>

      {/* 内容区域 */}
      <div className="flex-1 overflow-auto p-4">
        <div className="prose prose-sm dark:prose-invert max-w-none whitespace-pre-wrap">
          {content}
        </div>
      </div>
    </div>
  );
}
