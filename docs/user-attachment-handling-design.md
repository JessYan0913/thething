# 用户附件处理实现方案

## 概述

基于对 claude-code 和 ai SDK v6 的研究，设计用户上传附件（PDF、图片等）的处理方案。

## AI SDK v6 消息结构

### UI 层 (UIMessage)

```typescript
import type { UIMessage, FileUIPart, TextUIPart } from 'ai'

// 用户消息结构
interface UserUIMessage extends UIMessage {
  role: 'user'
  parts: Array<TextUIPart | FileUIPart>
}

// 文件附件
interface FileUIPart {
  type: 'file'
  mediaType: string  // IANA media type
  filename?: string
  url: string        // Data URL 或远程 URL
}
```

### Model 层 (ModelMessage)

```typescript
import type { UserModelMessage, TextPart, ImagePart, FilePart } from 'ai'

type UserContent = string | Array<TextPart | ImagePart | FilePart>

// 通用文件 (PDF 等)
interface FilePart {
  type: 'file'
  data: string | Uint8Array | ArrayBuffer | Buffer | URL
  filename?: string
  mediaType: string  // 'application/pdf'
}

// 图片
interface ImagePart {
  type: 'image'
  image: string | Uint8Array | ArrayBuffer | Buffer | URL
  mediaType?: string  // 'image/png', 'image/jpeg'
}
```

### 自动转换机制

ai SDK 通过 `convertToModelMessages` 自动将 `FileUIPart` 转换为 `FilePart`：

```typescript
// ai/src/ui/convert-to-model-messages.ts
if (isFileUIPart(part)) {
  return {
    type: 'file',
    mediaType: part.mediaType,
    filename: part.filename,
    data: part.url,  // Data URL 直接传递
  }
}
```

## 附件类型处理策略

### 1. 图片文件 (Image)

**前端处理**：
- 使用 `FileReader.readAsDataURL` 转换为 Data URL
- 压缩大图片（可选，参考 claude-code 的 sharp 处理）

**API 处理**：
- ai SDK 识别 `mediaType` 为 `image/*` 时自动转为 `ImagePart`
- 或保持为 `FilePart` 通用格式

```typescript
// 图片处理
const imageFileUIPart: FileUIPart = {
  type: 'file',
  mediaType: file.type,  // 'image/png', 'image/jpeg', 'image/webp'
  filename: file.name,
  url: dataUrl,  // 'data:image/png;base64,iVBORw0KGgo...'
}
```

### 2. PDF 文件 (Document)

**关键发现**：ai SDK 的 `FilePart` 可直接支持 PDF！

```typescript
// PDF 作为 FilePart 发送
const pdfFileUIPart: FileUIPart = {
  type: 'file',
  mediaType: 'application/pdf',
  filename: 'document.pdf',
  url: dataUrl,  // 'data:application/pdf;base64,JVBERi0xLjQK...'
}
```

**大 PDF 处理策略**（参考 claude-code）：

```typescript
// 限制检查
const PDF_MAX_SIZE = 20 * 1024 * 1024  // ~20MB (考虑 base64 33% 增幅)
const PDF_MAX_PAGES = 100

// 大文件降级：提取页面为图片
if (file.size > PDF_MAX_SIZE) {
  // 使用 pdftoppm 提取页面
  const pages = await extractPDFPages(file, { firstPage: 1, lastPage: 20 })
  // 每页转为 ImagePart
  return pages.map(page => ({
    type: 'file',
    mediaType: 'image/jpeg',
    filename: `page-${page.number}.jpg`,
    url: page.dataUrl
  }))
}
```

### 3. 其他文件类型

```typescript
// 支持的 mediaType
const SUPPORTED_MEDIA_TYPES = [
  // 图片
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
  // 文档
  'application/pdf',
  // 文本
  'text/plain',
  'text/markdown',
  'application/json',
]

// 不支持的类型：返回错误或转为文本描述
if (!SUPPORTED_MEDIA_TYPES.includes(file.type)) {
  return {
    type: 'text',
    text: `[Unsupported file type: ${file.name} (${file.type})]`
  }
}
```

## 实现架构

### 文件结构

```
packages/core/src/
├── runtime/
│   ├── attachment/
│   │   ├── index.ts           # 导出
│   │   ├── processor.ts       # 附件处理核心
│   │   ├── image-resizer.ts   # 图片压缩
│   │   ├── pdf-handler.ts     # PDF 处理
│   │   └── types.ts           # 类型定义
│   └── message-attachment.ts  # 消息附件注入（现有）
└── foundation/
    └── file/
        └── data-url.ts        # Data URL 转换工具
```

### 核心类型定义

```typescript
// packages/core/src/runtime/attachment/types.ts

import type { FileUIPart } from 'ai'

export interface AttachmentConfig {
  /** 最大文件大小（字节） */
  maxFileSize: number
  /** 图片最大尺寸 */
  maxImageDimensions: {
    width: number
    height: number
  }
  /** PDF 最大页数 */
  maxPdfPages: number
  /** 支持的 mediaType */
  supportedMediaTypes: string[]
}

export const DEFAULT_ATTACHMENT_CONFIG: AttachmentConfig = {
  maxFileSize: 20 * 1024 * 1024,  // 20MB
  maxImageDimensions: {
    width: 2048,
    height: 2048,
  },
  maxPdfPages: 100,
  supportedMediaTypes: [
    'image/png',
    'image/jpeg',
    'image/gif',
    'image/webp',
    'application/pdf',
  ],
}

export interface ProcessedAttachment {
  parts: FileUIPart[]
  metadata: {
    originalSize: number
    processedSize: number
    wasCompressed: boolean
    wasSplit: boolean  // PDF 分页
  }
}

export interface AttachmentError {
  code: 'too_large' | 'unsupported_type' | 'invalid_content' | 'processing_failed'
  message: string
  filename?: string
}
```

### 附件处理器

```typescript
// packages/core/src/runtime/attachment/processor.ts

import type { FileUIPart } from 'ai'
import type { AttachmentConfig, ProcessedAttachment, AttachmentError } from './types'
import { resizeImage } from './image-resizer'
import { processPDF } from './pdf-handler'
import { convertFileToDataUrl } from '../../foundation/file/data-url'

export async function processAttachment(
  file: File,
  config: AttachmentConfig = DEFAULT_ATTACHMENT_CONFIG,
): Promise<ProcessedAttachment | AttachmentError> {
  // 1. 检查文件类型
  if (!config.supportedMediaTypes.includes(file.type)) {
    return {
      code: 'unsupported_type',
      message: `Unsupported file type: ${file.type}`,
      filename: file.name,
    }
  }

  // 2. 检查文件大小
  if (file.size > config.maxFileSize) {
    // PDF 可以分页处理
    if (file.type === 'application/pdf') {
      return processLargePDF(file, config)
    }
    return {
      code: 'too_large',
      message: `File exceeds maximum size of ${config.maxFileSize} bytes`,
      filename: file.name,
    }
  }

  // 3. 根据类型处理
  switch (file.type) {
    case 'application/pdf':
      return processPDF(file, config)
    
    // 图片类型
    case 'image/png':
    case 'image/jpeg':
    case 'image/gif':
    case 'image/webp':
      return processImage(file, config)
    
    default:
      // 其他文件直接转为 Data URL
      return processGenericFile(file)
  }
}

async function processImage(
  file: File,
  config: AttachmentConfig,
): Promise<ProcessedAttachment> {
  const originalSize = file.size
  
  // 可选：压缩图片
  let processedFile = file
  let wasCompressed = false
  
  if (file.size > 2 * 1024 * 1024) {  // 大于 2MB 时压缩
    processedFile = await resizeImage(file, config.maxImageDimensions)
    wasCompressed = processedFile.size < originalSize
  }

  const dataUrl = await convertFileToDataUrl(processedFile)
  
  return {
    parts: [{
      type: 'file',
      mediaType: processedFile.type,
      filename: file.name,
      url: dataUrl,
    }],
    metadata: {
      originalSize,
      processedSize: processedFile.size,
      wasCompressed,
      wasSplit: false,
    },
  }
}

async function processGenericFile(file: File): Promise<ProcessedAttachment> {
  const dataUrl = await convertFileToDataUrl(file)
  
  return {
    parts: [{
      type: 'file',
      mediaType: file.type,
      filename: file.name,
      url: dataUrl,
    }],
    metadata: {
      originalSize: file.size,
      processedSize: file.size,
      wasCompressed: false,
      wasSplit: false,
    },
  }
}
```

### PDF 处理器

```typescript
// packages/core/src/runtime/attachment/pdf-handler.ts

import type { FileUIPart } from 'ai'
import type { AttachmentConfig, ProcessedAttachment, AttachmentError } from './types'
import { convertFileToDataUrl } from '../../foundation/file/data-url'
import { execFile } from 'child_process'
import { promisify } from 'util'
import * as fs from 'fs/promises'
import * as path from 'path'
import { randomUUID } from 'crypto'

const execFileAsync = promisify(execFile)

export async function processPDF(
  file: File,
  config: AttachmentConfig,
): Promise<ProcessedAttachment | AttachmentError> {
  // 验证 PDF header
  const buffer = await file.arrayBuffer()
  const header = new Uint8Array(buffer, 0, 5)
  const headerStr = String.fromCharCode(...header)
  
  if (!headerStr.startsWith('%PDF-')) {
    return {
      code: 'invalid_content',
      message: 'File is not a valid PDF (missing %PDF- header)',
      filename: file.name,
    }
  }

  // 小 PDF：直接返回
  const dataUrl = await convertFileToDataUrl(file)
  
  return {
    parts: [{
      type: 'file',
      mediaType: 'application/pdf',
      filename: file.name,
      url: dataUrl,
    }],
    metadata: {
      originalSize: file.size,
      processedSize: file.size,
      wasCompressed: false,
      wasSplit: false,
    },
  }
}

export async function processLargePDF(
  file: File,
  config: AttachmentConfig,
): Promise<ProcessedAttachment | AttachmentError> {
  // 检查 pdftoppm 是否可用
  const pdftoppmAvailable = await checkPdftoppmAvailable()
  
  if (!pdftoppmAvailable) {
    return {
      code: 'processing_failed',
      message: 'pdftoppm is not installed. Install poppler-utils for large PDF support.',
      filename: file.name,
    }
  }

  // 提取页面为图片
  try {
    const pages = await extractPDFPages(file, config.maxPdfPages)
    
    return {
      parts: pages.map((page, i) => ({
        type: 'file',
        mediaType: 'image/jpeg',
        filename: `${file.name}-page-${i + 1}.jpg`,
        url: page.dataUrl,
      })),
      metadata: {
        originalSize: file.size,
        processedSize: pages.reduce((sum, p) => sum + p.size, 0),
        wasCompressed: true,
        wasSplit: true,
      },
    }
  } catch (error) {
    return {
      code: 'processing_failed',
      message: `Failed to extract PDF pages: ${error}`,
      filename: file.name,
    }
  }
}

async function checkPdftoppmAvailable(): Promise<boolean> {
  try {
    await execFileAsync('pdftoppm', ['-v'], { timeout: 5000 })
    return true
  } catch {
    return false
  }
}

async function extractPDFPages(
  file: File,
  maxPages: number,
): Promise<Array<{ dataUrl: string; size: number }>> {
  const tmpDir = path.join(process.cwd(), '.tmp', `pdf-${randomUUID()}`)
  await fs.mkdir(tmpDir, { recursive: true })
  
  const pdfPath = path.join(tmpDir, 'input.pdf')
  await fs.writeFile(pdfPath, Buffer.from(await file.arrayBuffer()))
  
  // pdftoppm -jpeg -r 100 input.pdf output
  const outputPrefix = path.join(tmpDir, 'page')
  await execFileAsync('pdftoppm', [
    '-jpeg',
    '-r', '100',
    '-l', String(Math.min(maxPages, 20)),  // 最多提取 20 页
    pdfPath,
    outputPrefix,
  ], { timeout: 120000 })
  
  // 读取生成的图片
  const files = await fs.readdir(tmpDir)
  const imageFiles = files
    .filter(f => f.endsWith('.jpg'))
    .sort()
  
  const pages = await Promise.all(
    imageFiles.map(async (filename) => {
      const imagePath = path.join(tmpDir, filename)
      const buffer = await fs.readFile(imagePath)
      const dataUrl = `data:image/jpeg;base64,${buffer.toString('base64')}`
      await fs.unlink(imagePath)  // 清理
      return { dataUrl, size: buffer.length }
    })
  )
  
  await fs.unlink(pdfPath)
  await fs.rmdir(tmpDir)
  
  return pages
}
```

### Data URL 工具

```typescript
// packages/core/src/foundation/file/data-url.ts

export async function convertFileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(file)
  })
}

export function parseDataUrl(dataUrl: string): {
  mediaType: string
  base64: string
  buffer: Buffer
} {
  const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/)
  if (!match) {
    throw new Error('Invalid Data URL format')
  }
  
  return {
    mediaType: match[1],
    base64: match[2],
    buffer: Buffer.from(match[2], 'base64'),
  }
}
```

### 图片压缩（可选）

```typescript
// packages/core/src/runtime/attachment/image-resizer.ts

import sharp from 'sharp'  // 需要安装 sharp

export interface ImageDimensions {
  width: number
  height: number
}

export async function resizeImage(
  file: File,
  maxDimensions: ImageDimensions,
): Promise<File> {
  const buffer = Buffer.from(await file.arrayBuffer())
  
  const image = sharp(buffer)
  const metadata = await image.metadata()
  
  // 如果尺寸超出限制，调整大小
  if (metadata.width > maxDimensions.width || 
      metadata.height > maxDimensions.height) {
    const resizedBuffer = await image
      .resize(maxDimensions.width, maxDimensions.height, {
        fit: 'inside',
        withoutEnlargement: true,
      })
      .toBuffer()
    
    return new File([resizedBuffer], file.name, {
      type: file.type,
      lastModified: Date.now(),
    })
  }
  
  return file
}

// 不使用 sharp 的轻量替代方案（浏览器端）
export async function resizeImageBrowser(
  file: File,
  maxDimensions: ImageDimensions,
): Promise<File> {
  const img = await createImageBitmap(file)
  
  if (img.width <= maxDimensions.width && 
      img.height <= maxDimensions.height) {
    return file
  }
  
  const canvas = document.createElement('canvas')
  const scale = Math.min(
    maxDimensions.width / img.width,
    maxDimensions.height / img.height,
  )
  canvas.width = Math.round(img.width * scale)
  canvas.height = Math.round(img.height * scale)
  
  const ctx = canvas.getContext('2d')
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
  
  const blob = await new Promise<Blob>((resolve) => {
    canvas.toBlob((b) => resolve(b!), file.type, 0.9)
  })
  
  return new File([blob], file.name, {
    type: file.type,
    lastModified: Date.now(),
  })
}
```

## 前端集成

### PromptInput 扩展

现有 [prompt-input.tsx](packages/web/src/components/ai-elements/prompt-input.tsx) 已支持 FileUIPart，需要扩展：

```typescript
// 扩展支持的文件类型
<PromptInput
  accept="image/*,application/pdf,.pdf"  // 新增 PDF
  maxFileSize={20 * 1024 * 1024}          // 20MB
  multiple={true}
  onError={(err) => {
    if (err.code === 'max_file_size') {
      toast.error('文件过大，最大支持 20MB')
    }
    if (err.code === 'accept') {
      toast.error('只支持图片和 PDF 文件')
    }
  }}
  onSubmit={(message) => {
    // message.files 是 FileUIPart[]
    // message.text 是用户文本
    sendToServer(message)
  }}
/>
```

### 消息渲染

```typescript
// 渲染用户消息中的附件
function UserMessageContent({ parts }: { parts: UIMessagePart[] }) {
  return (
    <div>
      {parts.map((part, i) => {
        if (part.type === 'text') {
          return <p key={i}>{part.text}</p>
        }
        if (part.type === 'file') {
          if (part.mediaType.startsWith('image/')) {
            return (
              <img 
                key={i} 
                src={part.url} 
                alt={part.filename}
                className="max-w-md rounded-lg"
              />
            )
          }
          if (part.mediaType === 'application/pdf') {
            return (
              <div key={i} className="flex items-center gap-2">
                <FileIcon className="size-4" />
                <span>{part.filename}</span>
              </div>
            )
          }
        }
        return null
      })}
    </div>
  )
}
```

## 服务端处理

### Chat Route 修改

```typescript
// packages/server/src/routes/chat.ts

app.post('/', async (c) => {
  const { message, conversationId } = await c.req.json<{
    message: UIMessage
    conversationId: string
  }>()

  // message.parts 包含 FileUIPart
  // ai SDK 会自动处理转换
  
  const agent = await createChatAgent({
    conversationId,
    messages: [message],  // 包含附件
    // ...
  })

  // 流式响应
  const stream = createUIMessageStream({
    execute: async ({ writer }) => {
      const agentStream = await createAgentUIStream({
        agent,
        uiMessages: [message],
        // ...
      })
      writer.merge(agentStream)
    },
  })

  return createUIMessageStreamResponse({ stream })
})
```

## 模型 Provider 支持

### 检查 Provider 对 FilePart 的支持

```typescript
// 不同 Provider 的支持情况

// OpenAI (GPT-4V, GPT-4o)
// - 支持 ImagePart
// - PDF 需转为图片或文本提取

// Anthropic (Claude 3.5 Sonnet)
// - 支持 document block (PDF)
// - 直接发送 FilePart { mediaType: 'application/pdf' }

// Google (Gemini)
// - 支持 PDF document
// - 支持多图片

// 需要根据 Provider 类型调整
function adaptAttachmentForProvider(
  part: FilePart,
  provider: string,
): TextPart | ImagePart | FilePart {
  if (provider === 'anthropic' && part.mediaType === 'application/pdf') {
    return part  // Claude 直接支持
  }
  
  if (provider === 'openai' && part.mediaType === 'application/pdf') {
    // OpenAI 不支持 PDF，需要降级
    return {
      type: 'text',
      text: `[PDF file: ${part.filename}. Please use Read tool to access.]`,
    }
  }
  
  return part
}
```

## 限制与配置

### API 限制（参考 claude-code）

```typescript
// packages/core/src/constants/api-limits.ts

export const ATTACHMENT_LIMITS = {
  // 图片
  IMAGE_MAX_SIZE: 5 * 1024 * 1024,        // 5MB
  IMAGE_MAX_WIDTH: 2048,
  IMAGE_MAX_HEIGHT: 2048,
  
  // PDF
  PDF_MAX_SIZE: 20 * 1024 * 1024,         // 20MB (考虑 base64)
  PDF_MAX_PAGES: 100,
  PDF_MAX_EXTRACT_SIZE: 50 * 1024 * 1024, // 50MB (页面提取阈值)
  
  // 总请求
  API_MAX_REQUEST_SIZE: 32 * 1024 * 1024, // 32MB (API limit)
}
```

### 配置文件支持

```typescript
// packages/core/src/config/attachment-config.ts

import type { AttachmentConfig } from '../runtime/attachment/types'

export function loadAttachmentConfig(): AttachmentConfig {
  return {
    ...DEFAULT_ATTACHMENT_CONFIG,
    // 可从环境变量或配置文件覆盖
    maxFileSize: process.env.MAX_FILE_SIZE 
      ? parseInt(process.env.MAX_FILE_SIZE) 
      : DEFAULT_ATTACHMENT_CONFIG.maxFileSize,
  }
}
```

## 测试策略

### 单元测试

```typescript
// packages/core/src/runtime/attachment/__tests__/processor.test.ts

describe('AttachmentProcessor', () => {
  it('should process image file', async () => {
    const file = new File([''], 'test.png', { type: 'image/png' })
    const result = await processAttachment(file)
    expect(result.parts[0].mediaType).toBe('image/png')
  })
  
  it('should reject unsupported type', async () => {
    const file = new File([''], 'test.exe', { type: 'application/exe' })
    const result = await processAttachment(file)
    expect(result.code).toBe('unsupported_type')
  })
  
  it('should validate PDF header', async () => {
    const invalidPdf = new File(['not a pdf'], 'fake.pdf', { 
      type: 'application/pdf' 
    })
    const result = await processAttachment(invalidPdf)
    expect(result.code).toBe('invalid_content')
  })
})
```

## 实施步骤

1. **Phase 1: 基础支持**
   - 实现 `convertFileToDataUrl` 工具
   - 实现 `processAttachment` 处理器
   - 扩展前端 `PromptInput` 支持 PDF

2. **Phase 2: 图片优化**
   - 集成 sharp 图片压缩
   - 实现浏览器端压缩替代方案
   - 添加图片尺寸限制检查

3. **Phase 3: PDF 高级处理**
   - 实现 `pdftoppm` 大 PDF 分页提取
   - 实现 PDF 内容提取（可选）
   - 添加 Provider 兼容性适配

4. **Phase 4: 完善**
   - 添加附件预览组件
   - 实现附件状态管理（上传、处理、错误）
   - 添加附件历史记录

## 参考资源

- ai SDK v6: `packages/core/node_modules/.pnpm/ai@6.0.158*/`
- claude-code 源码: `/tmp/cc-best/`
  - `src/utils/pdf.ts` - PDF 处理
  - `src/utils/imageResizer.ts` - 图片压缩
  - `src/utils/attachments.ts` - 附件管理
  - `packages/builtin-tools/src/tools/FileReadTool/` - 文件读取工具