import { NextRequest, NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";
import os from "os";

export const runtime = "nodejs";

/**
 * Tika 服务端转换代理
 *
 * 将 .doc / .ppt 等旧版 Office 格式发送到 Apache Tika 服务端，
 * 返回转换后的 HTML。
 *
 * 环境变量:
 *   TIKA_BACKEND_URL — Tika 服务端地址（如 http://tika:9998 ）
 *
 * GET  /api/file/convert-tika?path=/local/file.doc
 * POST /api/file/convert-tika  (FormData: file)
 */

const TIKA_BACKEND = process.env.TIKA_BACKEND_URL || "";

// 允许访问的文件根目录（同 /api/fs 保持一致）
async function getAllowedRoots(): Promise<string[]> {
  const homeDir = os.homedir();
  // resourceRoot 可能通过环境变量或其他方式提供
  const resourceRoot = process.env.RESOURCE_ROOT || homeDir;
  return [resourceRoot, homeDir];
}

function isPathAllowed(resolved: string, allowedRoots: string[]): boolean {
  const sep = path.sep;
  return allowedRoots.some(
    (root) => resolved.startsWith(root + sep) || resolved === root
  );
}

/**
 * 将文件内容发送到 Tika 服务端并返回 HTML
 */
async function proxyToTika(fileBuffer: Buffer, filename: string): Promise<string> {
  if (!TIKA_BACKEND) {
    throw new Error("TIKA_BACKEND_URL 未配置");
  }

  const tikaUrl = TIKA_BACKEND.replace(/\/$/, "") + "/tika";
  const ext = path.extname(filename).toLowerCase();

  // Tika 接受的 Content-Type 映射
  const mimeTypes: Record<string, string> = {
    ".doc": "application/msword",
    ".dot": "application/msword",
    ".ppt": "application/vnd.ms-powerpoint",
    ".pps": "application/vnd.ms-powerpoint",
    ".pot": "application/vnd.ms-powerpoint",
  };
  const contentType = mimeTypes[ext] || "application/octet-stream";

  const response = await fetch(tikaUrl, {
    method: "PUT",
    headers: {
      "Content-Type": contentType,
      Accept: "text/html",
    },
    body: new Uint8Array(fileBuffer),
    signal: AbortSignal.timeout(30_000),
  });

  if (!response.ok) {
    const errText = await response.text().catch(() => "");
    throw new Error(`Tika 服务端错误 (${response.status}): ${errText.slice(0, 200)}`);
  }

  return response.text();
}

// ── GET: 本地文件路径 ──────────────────────────────────────────────

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const filePath = searchParams.get("path");

    if (!filePath) {
      return new NextResponse("Missing path query parameter", { status: 400 });
    }

    // 展开 ~
    const expanded = filePath.startsWith("~")
      ? path.join(os.homedir(), filePath.slice(1))
      : filePath;
    const resolved = path.resolve(expanded);

    // 路径校验
    const allowedRoots = await getAllowedRoots();
    if (!isPathAllowed(resolved, allowedRoots)) {
      return new NextResponse("Path not allowed", { status: 403 });
    }

    // 文件存在性校验
    try {
      await fs.access(resolved);
    } catch {
      return new NextResponse("File not found", { status: 404 });
    }

    const stat = await fs.stat(resolved);
    if (!stat.isFile()) {
      return new NextResponse("Path is not a file", { status: 400 });
    }

    const buffer = await fs.readFile(resolved);
    const filename = path.basename(resolved);
    const html = await proxyToTika(buffer, filename);

    return new NextResponse(html, {
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });
  } catch (error) {
    console.error("[Tika Proxy] GET error:", error);
    const message = error instanceof Error ? error.message : "Internal server error";
    return new NextResponse(message, { status: 500 });
  }
}

// ── POST: FormData 文件上传 ────────────────────────────────────────

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const fileField = formData.get("file");

    if (!fileField || !(fileField instanceof File)) {
      return new NextResponse("Missing file field in FormData", { status: 400 });
    }

    const file = fileField as File;
    const buffer = Buffer.from(await file.arrayBuffer());
    const html = await proxyToTika(buffer, file.name);

    return new NextResponse(html, {
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });
  } catch (error) {
    console.error("[Tika Proxy] POST error:", error);
    const message = error instanceof Error ? error.message : "Internal server error";
    return new NextResponse(message, { status: 500 });
  }
}
