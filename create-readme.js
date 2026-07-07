const fs = require('fs');
const { Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell, 
        Header, Footer, AlignmentType, HeadingLevel, BorderStyle, WidthType, 
        LevelFormat, ExternalHyperlink, TableOfContents, ShadingType, 
        VerticalAlign, PageNumber } = require('docx');

// 定义样式
const doc = new Document({
  styles: {
    default: { 
      document: { 
        run: { font: "Arial", size: 24 } // 12pt
      } 
    },
    paragraphStyles: [
      {
        id: "Title", name: "Title", basedOn: "Normal",
        run: { size: 56, bold: true, color: "000000", font: "Arial" },
        paragraph: { spacing: { before: 240, after: 120 }, alignment: AlignmentType.CENTER }
      },
      {
        id: "Heading1", name: "Heading 1", basedOn: "Normal", next: "Normal", quickFormat: true,
        run: { size: 32, bold: true, color: "000000", font: "Arial" },
        paragraph: { spacing: { before: 240, after: 240 }, outlineLevel: 0 }
      },
      {
        id: "Heading2", name: "Heading 2", basedOn: "Normal", next: "Normal", quickFormat: true,
        run: { size: 28, bold: true, color: "000000", font: "Arial" },
        paragraph: { spacing: { before: 180, after: 180 }, outlineLevel: 1 }
      },
      {
        id: "Heading3", name: "Heading 3", basedOn: "Normal", next: "Normal", quickFormat: true,
        run: { size: 26, bold: true, color: "000000", font: "Arial" },
        paragraph: { spacing: { before: 120, after: 120 }, outlineLevel: 2 }
      }
    ]
  },
  numbering: {
    config: [
      {
        reference: "bullet-list",
        levels: [
          {
            level: 0,
            format: LevelFormat.BULLET,
            text: "•",
            alignment: AlignmentType.LEFT,
            style: {
              paragraph: {
                indent: { left: 720, hanging: 360 }
              }
            }
          }
        ]
      },
      {
        reference: "numbered-list",
        levels: [
          {
            level: 0,
            format: LevelFormat.DECIMAL,
            text: "%1.",
            alignment: AlignmentType.LEFT,
            style: {
              paragraph: {
                indent: { left: 720, hanging: 360 }
              }
            }
          }
        ]
      }
    ]
  },
  sections: [
    {
      properties: {
        page: {
          margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 }
        }
      },
      headers: {
        default: new Header({
          children: [
            new Paragraph({
              alignment: AlignmentType.RIGHT,
              children: [
                new TextRun({ text: "TheThing - AI Agent Framework", size: 20 })
              ]
            })
          ]
        })
      },
      footers: {
        default: new Footer({
          children: [
            new Paragraph({
              alignment: AlignmentType.CENTER,
              children: [
                new TextRun({ text: "Page ", size: 20 }),
                new TextRun({ children: [PageNumber.CURRENT], size: 20 }),
                new TextRun({ text: " of ", size: 20 }),
                new TextRun({ children: [PageNumber.TOTAL_PAGES], size: 20 })
              ]
            })
          ]
        })
      },
      children: [
        // 标题
        new Paragraph({
          heading: HeadingLevel.TITLE,
          children: [new TextRun({ text: "TheThing", bold: true })]
        }),
        
        // 副标题
        new Paragraph({
          alignment: AlignmentType.CENTER,
          spacing: { after: 400 },
          children: [
            new TextRun({ 
              text: "AI Agent 框架 - 支持 CLI、Web UI 和 HTTP API 多种交互方式", 
              size: 28, 
              color: "666666" 
            })
          ]
        }),
        
        // 目录
        new Paragraph({
          heading: HeadingLevel.HEADING_1,
          children: [new TextRun({ text: "目录" })]
        }),
        new TableOfContents("目录", {
          hyperlink: true,
          headingStyleRange: "1-3"
        }),
        
        // 项目概述
        new Paragraph({
          heading: HeadingLevel.HEADING_1,
          children: [new TextRun({ text: "项目概述" })]
        }),
        new Paragraph({
          spacing: { after: 200 },
          children: [
            new TextRun({ 
              text: "TheThing 是一个参考 Claude Code 架构设计的 AI Agent 框架，支持多种交互方式，包括命令行工具（CLI）、Web 用户界面和 HTTP API。该框架采用模块化设计，具有高度的可扩展性和灵活性。", 
              size: 24 
            })
          ]
        }),
        
        // 项目结构
        new Paragraph({
          heading: HeadingLevel.HEADING_1,
          children: [new TextRun({ text: "项目结构" })]
        }),
        new Paragraph({
          spacing: { after: 200 },
          children: [
            new TextRun({ text: "项目采用 pnpm monorepo 结构，主要包含以下模块：" })
          ]
        }),
        
        // 项目结构表格
        new Table({
          columnWidths: [2340, 2340, 4680],
          rows: [
            new TableRow({
              tableHeader: true,
              children: [
                new TableCell({
                  borders: { 
                    top: { style: BorderStyle.SINGLE, size: 1, color: "CCCCCC" },
                    bottom: { style: BorderStyle.SINGLE, size: 1, color: "CCCCCC" },
                    left: { style: BorderStyle.SINGLE, size: 1, color: "CCCCCC" },
                    right: { style: BorderStyle.SINGLE, size: 1, color: "CCCCCC" }
                  },
                  width: { size: 2340, type: WidthType.DXA },
                  shading: { fill: "D5E8F0", type: ShadingType.CLEAR },
                  children: [
                    new Paragraph({
                      alignment: AlignmentType.CENTER,
                      children: [new TextRun({ text: "目录", bold: true })]
                    })
                  ]
                }),
                new TableCell({
                  borders: { 
                    top: { style: BorderStyle.SINGLE, size: 1, color: "CCCCCC" },
                    bottom: { style: BorderStyle.SINGLE, size: 1, color: "CCCCCC" },
                    left: { style: BorderStyle.SINGLE, size: 1, color: "CCCCCC" },
                    right: { style: BorderStyle.SINGLE, size: 1, color: "CCCCCC" }
                  },
                  width: { size: 2340, type: WidthType.DXA },
                  shading: { fill: "D5E8F0", type: ShadingType.CLEAR },
                  children: [
                    new Paragraph({
                      alignment: AlignmentType.CENTER,
                      children: [new TextRun({ text: "包名", bold: true })]
                    })
                  ]
                }),
                new TableCell({
                  borders: { 
                    top: { style: BorderStyle.SINGLE, size: 1, color: "CCCCCC" },
                    bottom: { style: BorderStyle.SINGLE, size: 1, color: "CCCCCC" },
                    left: { style: BorderStyle.SINGLE, size: 1, color: "CCCCCC" },
                    right: { style: BorderStyle.SINGLE, size: 1, color: "CCCCCC" }
                  },
                  width: { size: 4680, type: WidthType.DXA },
                  shading: { fill: "D5E8F0", type: ShadingType.CLEAR },
                  children: [
                    new Paragraph({
                      alignment: AlignmentType.CENTER,
                      children: [new TextRun({ text: "说明", bold: true })]
                    })
                  ]
                })
              ]
            }),
            new TableRow({
              children: [
                new TableCell({
                  borders: { 
                    top: { style: BorderStyle.SINGLE, size: 1, color: "CCCCCC" },
                    bottom: { style: BorderStyle.SINGLE, size: 1, color: "CCCCCC" },
                    left: { style: BorderStyle.SINGLE, size: 1, color: "CCCCCC" },
                    right: { style: BorderStyle.SINGLE, size: 1, color: "CCCCCC" }
                  },
                  width: { size: 2340, type: WidthType.DXA },
                  children: [new Paragraph({ children: [new TextRun({ text: "packages/core" })] })]
                }),
                new TableCell({
                  borders: { 
                    top: { style: BorderStyle.SINGLE, size: 1, color: "CCCCCC" },
                    bottom: { style: BorderStyle.SINGLE, size: 1, color: "CCCCCC" },
                    left: { style: BorderStyle.SINGLE, size: 1, color: "CCCCCC" },
                    right: { style: BorderStyle.SINGLE, size: 1, color: "CCCCCC" }
                  },
                  width: { size: 2340, type: WidthType.DXA },
                  children: [new Paragraph({ children: [new TextRun({ text: "@the-thing/core" })] })]
                }),
                new TableCell({
                  borders: { 
                    top: { style: BorderStyle.SINGLE, size: 1, color: "CCCCCC" },
                    bottom: { style: BorderStyle.SINGLE, size: 1, color: "CCCCCC" },
                    left: { style: BorderStyle.SINGLE, size: 1, color: "CCCCCC" },
                    right: { style: BorderStyle.SINGLE, size: 1, color: "CCCCCC" }
                  },
                  width: { size: 4680, type: WidthType.DXA },
                  children: [new Paragraph({ children: [new TextRun({ text: "核心引擎" })] })]
                })
              ]
            }),
            new TableRow({
              children: [
                new TableCell({
                  borders: { 
                    top: { style: BorderStyle.SINGLE, size: 1, color: "CCCCCC" },
                    bottom: { style: BorderStyle.SINGLE, size: 1, color: "CCCCCC" },
                    left: { style: BorderStyle.SINGLE, size: 1, color: "CCCCCC" },
                    right: { style: BorderStyle.SINGLE, size: 1, color: "CCCCCC" }
                  },
                  width: { size: 2340, type: WidthType.DXA },
                  children: [new Paragraph({ children: [new TextRun({ text: "packages/cli" })] })]
                }),
                new TableCell({
                  borders: { 
                    top: { style: BorderStyle.SINGLE, size: 1, color: "CCCCCC" },
                    bottom: { style: BorderStyle.SINGLE, size: 1, color: "CCCCCC" },
                    left: { style: BorderStyle.SINGLE, size: 1, color: "CCCCCC" },
                    right: { style: BorderStyle.SINGLE, size: 1, color: "CCCCCC" }
                  },
                  width: { size: 2340, type: WidthType.DXA },
                  children: [new Paragraph({ children: [new TextRun({ text: "@the-thing/cli" })] })]
                }),
                new TableCell({
                  borders: { 
                    top: { style: BorderStyle.SINGLE, size: 1, color: "CCCCCC" },
                    bottom: { style: BorderStyle.SINGLE, size: 1, color: "CCCCCC" },
                    left: { style: BorderStyle.SINGLE, size: 1, color: "CCCCCC" },
                    right: { style: BorderStyle.SINGLE, size: 1, color: "CCCCCC" }
                  },
                  width: { size: 4680, type: WidthType.DXA },
                  children: [new Paragraph({ children: [new TextRun({ text: "命令行工具" })] })]
                })
              ]
            }),
            new TableRow({
              children: [
                new TableCell({
                  borders: { 
                    top: { style: BorderStyle.SINGLE, size: 1, color: "CCCCCC" },
                    bottom: { style: BorderStyle.SINGLE, size: 1, color: "CCCCCC" },
                    left: { style: BorderStyle.SINGLE, size: 1, color: "CCCCCC" },
                    right: { style: BorderStyle.SINGLE, size: 1, color: "CCCCCC" }
                  },
                  width: { size: 2340, type: WidthType.DXA },
                  children: [new Paragraph({ children: [new TextRun({ text: "packages/app" })] })]
                }),
                new TableCell({
                  borders: { 
                    top: { style: BorderStyle.SINGLE, size: 1, color: "CCCCCC" },
                    bottom: { style: BorderStyle.SINGLE, size: 1, color: "CCCCCC" },
                    left: { style: BorderStyle.SINGLE, size: 1, color: "CCCCCC" },
                    right: { style: BorderStyle.SINGLE, size: 1, color: "CCCCCC" }
                  },
                  width: { size: 2340, type: WidthType.DXA },
                  children: [new Paragraph({ children: [new TextRun({ text: "@the-thing/app" })] })]
                }),
                new TableCell({
                  borders: { 
                    top: { style: BorderStyle.SINGLE, size: 1, color: "CCCCCC" },
                    bottom: { style: BorderStyle.SINGLE, size: 1, color: "CCCCCC" },
                    left: { style: BorderStyle.SINGLE, size: 1, color: "CCCCCC" },
                    right: { style: BorderStyle.SINGLE, size: 1, color: "CCCCCC" }
                  },
                  width: { size: 4680, type: WidthType.DXA },
                  children: [new Paragraph({ children: [new TextRun({ text: "Web 前端应用" })] })]
                })
              ]
            }),
            new TableRow({
              children: [
                new TableCell({
                  borders: { 
                    top: { style: BorderStyle.SINGLE, size: 1, color: "CCCCCC" },
                    bottom: { style: BorderStyle.SINGLE, size: 1, color: "CCCCCC" },
                    left: { style: BorderStyle.SINGLE, size: 1, color: "CCCCCC" },
                    right: { style: BorderStyle.SINGLE, size: 1, color: "CCCCCC" }
                  },
                  width: { size: 2340, type: WidthType.DXA },
                  children: [new Paragraph({ children: [new TextRun({ text: "packages/desktop" })] })]
                }),
                new TableCell({
                  borders: { 
                    top: { style: BorderStyle.SINGLE, size: 1, color: "CCCCCC" },
                    bottom: { style: BorderStyle.SINGLE, size: 1, color: "CCCCCC" },
                    left: { style: BorderStyle.SINGLE, size: 1, color: "CCCCCC" },
                    right: { style: BorderStyle.SINGLE, size: 1, color: "CCCCCC" }
                  },
                  width: { size: 2340, type: WidthType.DXA },
                  children: [new Paragraph({ children: [new TextRun({ text: "@the-thing/desktop" })] })]
                }),
                new TableCell({
                  borders: { 
                    top: { style: BorderStyle.SINGLE, size: 1, color: "CCCCCC" },
                    bottom: { style: BorderStyle.SINGLE, size: 1, color: "CCCCCC" },
                    left: { style: BorderStyle.SINGLE, size: 1, color: "CCCCCC" },
                    right: { style: BorderStyle.SINGLE, size: 1, color: "CCCCCC" }
                  },
                  width: { size: 4680, type: WidthType.DXA },
                  children: [new Paragraph({ children: [new TextRun({ text: "桌面应用" })] })]
                })
              ]
            }),
            new TableRow({
              children: [
                new TableCell({
                  borders: { 
                    top: { style: BorderStyle.SINGLE, size: 1, color: "CCCCCC" },
                    bottom: { style: BorderStyle.SINGLE, size: 1, color: "CCCCCC" },
                    left: { style: BorderStyle.SINGLE, size: 1, color: "CCCCCC" },
                    right: { style: BorderStyle.SINGLE, size: 1, color: "CCCCCC" }
                  },
                  width: { size: 2340, type: WidthType.DXA },
                  children: [new Paragraph({ children: [new TextRun({ text: "packages/resumable-stream" })] })]
                }),
                new TableCell({
                  borders: { 
                    top: { style: BorderStyle.SINGLE, size: 1, color: "CCCCCC" },
                    bottom: { style: BorderStyle.SINGLE, size: 1, color: "CCCCCC" },
                    left: { style: BorderStyle.SINGLE, size: 1, color: "CCCCCC" },
                    right: { style: BorderStyle.SINGLE, size: 1, color: "CCCCCC" }
                  },
                  width: { size: 2340, type: WidthType.DXA },
                  children: [new Paragraph({ children: [new TextRun({ text: "@the-thing/resumable-stream" })] })]
                }),
                new TableCell({
                  borders: { 
                    top: { style: BorderStyle.SINGLE, size: 1, color: "CCCCCC" },
                    bottom: { style: BorderStyle.SINGLE, size: 1, color: "CCCCCC" },
                    left: { style: BorderStyle.SINGLE, size: 1, color: "CCCCCC" },
                    right: { style: BorderStyle.SINGLE, size: 1, color: "CCCCCC" }
                  },
                  width: { size: 4680, type: WidthType.DXA },
                  children: [new Paragraph({ children: [new TextRun({ text: "可恢复流处理" })] })]
                })
              ]
            })
          ]
        }),
        
        // 快速开始
        new Paragraph({
          heading: HeadingLevel.HEADING_1,
          children: [new TextRun({ text: "快速开始" })]
        }),
        
        // 安装
        new Paragraph({
          heading: HeadingLevel.HEADING_2,
          children: [new TextRun({ text: "安装" })]
        }),
        new Paragraph({
          spacing: { after: 200 },
          children: [
            new TextRun({ text: "首先，克隆项目仓库：" })
          ]
        }),
        new Paragraph({
          spacing: { after: 200 },
          children: [
            new TextRun({ 
              text: "git clone https://github.com/your-org/thething.git", 
              font: "Courier New",
              size: 22
            })
          ]
        }),
        new Paragraph({
          spacing: { after: 200 },
          children: [
            new TextRun({ text: "然后安装依赖：" })
          ]
        }),
        new Paragraph({
          spacing: { after: 200 },
          children: [
            new TextRun({ 
              text: "cd thething && pnpm install", 
              font: "Courier New",
              size: 22
            })
          ]
        }),
        
        // 开发模式
        new Paragraph({
          heading: HeadingLevel.HEADING_2,
          children: [new TextRun({ text: "开发模式" })]
        }),
        new Paragraph({
          spacing: { after: 200 },
          children: [
            new TextRun({ text: "启动开发服务器：" })
          ]
        }),
        
        // 开发命令表格
        new Table({
          columnWidths: [4680, 4680],
          rows: [
            new TableRow({
              tableHeader: true,
              children: [
                new TableCell({
                  borders: { 
                    top: { style: BorderStyle.SINGLE, size: 1, color: "CCCCCC" },
                    bottom: { style: BorderStyle.SINGLE, size: 1, color: "CCCCCC" },
                    left: { style: BorderStyle.SINGLE, size: 1, color: "CCCCCC" },
                    right: { style: BorderStyle.SINGLE, size: 1, color: "CCCCCC" }
                  },
                  width: { size: 4680, type: WidthType.DXA },
                  shading: { fill: "D5E8F0", type: ShadingType.CLEAR },
                  children: [
                    new Paragraph({
                      alignment: AlignmentType.CENTER,
                      children: [new TextRun({ text: "命令", bold: true })]
                    })
                  ]
                }),
                new TableCell({
                  borders: { 
                    top: { style: BorderStyle.SINGLE, size: 1, color: "CCCCCC" },
                    bottom: { style: BorderStyle.SINGLE, size: 1, color: "CCCCCC" },
                    left: { style: BorderStyle.SINGLE, size: 1, color: "CCCCCC" },
                    right: { style: BorderStyle.SINGLE, size: 1, color: "CCCCCC" }
                  },
                  width: { size: 4680, type: WidthType.DXA },
                  shading: { fill: "D5E8F0", type: ShadingType.CLEAR },
                  children: [
                    new Paragraph({
                      alignment: AlignmentType.CENTER,
                      children: [new TextRun({ text: "说明", bold: true })]
                    })
                  ]
                })
              ]
            }),
            new TableRow({
              children: [
                new TableCell({
                  borders: { 
                    top: { style: BorderStyle.SINGLE, size: 1, color: "CCCCCC" },
                    bottom: { style: BorderStyle.SINGLE, size: 1, color: "CCCCCC" },
                    left: { style: BorderStyle.SINGLE, size: 1, color: "CCCCCC" },
                    right: { style: BorderStyle.SINGLE, size: 1, color: "CCCCCC" }
                  },
                  width: { size: 4680, type: WidthType.DXA },
                  children: [new Paragraph({ children: [new TextRun({ text: "pnpm dev:cli", font: "Courier New" })] })]
                }),
                new TableCell({
                  borders: { 
                    top: { style: BorderStyle.SINGLE, size: 1, color: "CCCCCC" },
                    bottom: { style: BorderStyle.SINGLE, size: 1, color: "CCCCCC" },
                    left: { style: BorderStyle.SINGLE, size: 1, color: "CCCCCC" },
                    right: { style: BorderStyle.SINGLE, size: 1, color: "CCCCCC" }
                  },
                  width: { size: 4680, type: WidthType.DXA },
                  children: [new Paragraph({ children: [new TextRun({ text: "启动 CLI 开发模式" })] })]
                })
              ]
            }),
            new TableRow({
              children: [
                new TableCell({
                  borders: { 
                    top: { style: BorderStyle.SINGLE, size: 1, color: "CCCCCC" },
                    bottom: { style: BorderStyle.SINGLE, size: 1, color: "CCCCCC" },
                    left: { style: BorderStyle.SINGLE, size: 1, color: "CCCCCC" },
                    right: { style: BorderStyle.SINGLE, size: 1, color: "CCCCCC" }
                  },
                  width: { size: 4680, type: WidthType.DXA },
                  children: [new Paragraph({ children: [new TextRun({ text: "pnpm dev:next", font: "Courier New" })] })]
                }),
                new TableCell({
                  borders: { 
                    top: { style: BorderStyle.SINGLE, size: 1, color: "CCCCCC" },
                    bottom: { style: BorderStyle.SINGLE, size: 1, color: "CCCCCC" },
                    left: { style: BorderStyle.SINGLE, size: 1, color: "CCCCCC" },
                    right: { style: BorderStyle.SINGLE, size: 1, color: "CCCCCC" }
                  },
                  width: { size: 4680, type: WidthType.DXA },
                  children: [new Paragraph({ children: [new TextRun({ text: "启动 Next.js 开发服务器" })] })]
                })
              ]
            }),
            new TableRow({
              children: [
                new TableCell({
                  borders: { 
                    top: { style: BorderStyle.SINGLE, size: 1, color: "CCCCCC" },
                    bottom: { style: BorderStyle.SINGLE, size: 1, color: "CCCCCC" },
                    left: { style: BorderStyle.SINGLE, size: 1, color: "CCCCCC" },
                    right: { style: BorderStyle.SINGLE, size: 1, color: "CCCCCC" }
                  },
                  width: { size: 4680, type: WidthType.DXA },
                  children: [new Paragraph({ children: [new TextRun({ text: "pnpm dev:desktop", font: "Courier New" })] })]
                }),
                new TableCell({
                  borders: { 
                    top: { style: BorderStyle.SINGLE, size: 1, color: "CCCCCC" },
                    bottom: { style: BorderStyle.SINGLE, size: 1, color: "CCCCCC" },
                    left: { style: BorderStyle.SINGLE, size: 1, color: "CCCCCC" },
                    right: { style: BorderStyle.SINGLE, size: 1, color: "CCCCCC" }
                  },
                  width: { size: 4680, type: WidthType.DXA },
                  children: [new Paragraph({ children: [new TextRun({ text: "启动桌面应用开发模式" })] })]
                })
              ]
            })
          ]
        }),
        
        // 构建
        new Paragraph({
          heading: HeadingLevel.HEADING_2,
          children: [new TextRun({ text: "构建" })]
        }),
        new Paragraph({
          spacing: { after: 200 },
          children: [
            new TextRun({ text: "构建生产版本：" })
          ]
        }),
        new Paragraph({
          numbering: { reference: "bullet-list", level: 0 },
          children: [new TextRun({ text: "pnpm build:cli - 构建 CLI 工具" })]
        }),
        new Paragraph({
          numbering: { reference: "bullet-list", level: 0 },
          children: [new TextRun({ text: "pnpm build:next - 构建 Web 应用" })]
        }),
        new Paragraph({
          numbering: { reference: "bullet-list", level: 0 },
          children: [new TextRun({ text: "pnpm build:desktop - 构建桌面应用" })]
        }),
        
        // 核心模块
        new Paragraph({
          heading: HeadingLevel.HEADING_1,
          children: [new TextRun({ text: "核心模块" })]
        }),
        new Paragraph({
          spacing: { after: 200 },
          children: [
            new TextRun({ text: "packages/core 包含以下核心模块：" })
          ]
        }),
        
        // 核心模块表格
        new Table({
          columnWidths: [2340, 7020],
          rows: [
            new TableRow({
              tableHeader: true,
              children: [
                new TableCell({
                  borders: { 
                    top: { style: BorderStyle.SINGLE, size: 1, color: "CCCCCC" },
                    bottom: { style: BorderStyle.SINGLE, size: 1, color: "CCCCCC" },
                    left: { style: BorderStyle.SINGLE, size: 1, color: "CCCCCC" },
                    right: { style: BorderStyle.SINGLE, size: 1, color: "CCCCCC" }
                  },
                  width: { size: 2340, type: WidthType.DXA },
                  shading: { fill: "D5E8F0", type: ShadingType.CLEAR },
                  children: [
                    new Paragraph({
                      alignment: AlignmentType.CENTER,
                      children: [new TextRun({ text: "模块", bold: true })]
                    })
                  ]
                }),
                new TableCell({
                  borders: { 
                    top: { style: BorderStyle.SINGLE, size: 1, color: "CCCCCC" },
                    bottom: { style: BorderStyle.SINGLE, size: 1, color: "CCCCCC" },
                    left: { style: BorderStyle.SINGLE, size: 1, color: "CCCCCC" },
                    right: { style: BorderStyle.SINGLE, size: 1, color: "CCCCCC" }
                  },
                  width: { size: 7020, type: WidthType.DXA },
                  shading: { fill: "D5E8F0", type: ShadingType.CLEAR },
                  children: [
                    new Paragraph({
                      alignment: AlignmentType.CENTER,
                      children: [new TextRun({ text: "功能说明", bold: true })]
                    })
                  ]
                })
              ]
            }),
            new TableRow({
              children: [
                new TableCell({
                  borders: { 
                    top: { style: BorderStyle.SINGLE, size: 1, color: "CCCCCC" },
                    bottom: { style: BorderStyle.SINGLE, size: 1, color: "CCCCCC" },
                    left: { style: BorderStyle.SINGLE, size: 1, color: "CCCCCC" },
                    right: { style: BorderStyle.SINGLE, size: 1, color: "CCCCCC" }
                  },
                  width: { size: 2340, type: WidthType.DXA },
                  children: [new Paragraph({ children: [new TextRun({ text: "agent/" })] })]
                }),
                new TableCell({
                  borders: { 
                    top: { style: BorderStyle.SINGLE, size: 1, color: "CCCCCC" },
                    bottom: { style: BorderStyle.SINGLE, size: 1, color: "CCCCCC" },
                    left: { style: BorderStyle.SINGLE, size: 1, color: "CCCCCC" },
                    right: { style: BorderStyle.SINGLE, size: 1, color: "CCCCCC" }
                  },
                  width: { size: 7020, type: WidthType.DXA },
                  children: [new Paragraph({ children: [new TextRun({ text: "Agent 创建和控制" })] })]
                })
              ]
            }),
            new TableRow({
              children: [
                new TableCell({
                  borders: { 
                    top: { style: BorderStyle.SINGLE, size: 1, color: "CCCCCC" },
                    bottom: { style: BorderStyle.SINGLE, size: 1, color: "CCCCCC" },
                    left: { style: BorderStyle.SINGLE, size: 1, color: "CCCCCC" },
                    right: { style: BorderStyle.SINGLE, size: 1, color: "CCCCCC" }
                  },
                  width: { size: 2340, type: WidthType.DXA },
                  children: [new Paragraph({ children: [new TextRun({ text: "compaction/" })] })]
                }),
                new TableCell({
                  borders: { 
                    top: { style: BorderStyle.SINGLE, size: 1, color: "CCCCCC" },
                    bottom: { style: BorderStyle.SINGLE, size: 1, color: "CCCCCC" },
                    left: { style: BorderStyle.SINGLE, size: 1, color: "CCCCCC" },
                    right: { style: BorderStyle.SINGLE, size: 1, color: "CCCCCC" }
                  },
                  width: { size: 7020, type: WidthType.DXA },
                  children: [new Paragraph({ children: [new TextRun({ text: "对话压缩（auto-compact、micro-compact）" })] })]
                })
              ]
            }),
            new TableRow({
              children: [
                new TableCell({
                  borders: { 
                    top: { style: BorderStyle.SINGLE, size: 1, color: "CCCCCC" },
                    bottom: { style: BorderStyle.SINGLE, size: 1, color: "CCCCCC" },
                    left: { style: BorderStyle.SINGLE, size: 1, color: "CCCCCC" },
                    right: { style: BorderStyle.SINGLE, size: 1, color: "CCCCCC" }
                  },
                  width: { size: 2340, type: WidthType.DXA },
                  children: [new Paragraph({ children: [new TextRun({ text: "config/" })] })]
                }),
                new TableCell({
                  borders: { 
                    top: { style: BorderStyle.SINGLE, size: 1, color: "CCCCCC" },
                    bottom: { style: BorderStyle.SINGLE, size: 1, color: "CCCCCC" },
                    left: { style: BorderStyle.SINGLE, size: 1, color: "CCCCCC" },
                    right: { style: BorderStyle.SINGLE, size: 1, color: "CCCCCC" }
                  },
                  width: { size: 7020, type: WidthType.DXA },
                  children: [new Paragraph({ children: [new TextRun({ text: "配置管理（behavior.ts、layout.ts、defaults.ts）" })] })]
                })
              ]
            }),
            new TableRow({
              children: [
                new TableCell({
                  borders: { 
                    top: { style: BorderStyle.SINGLE, size: 1, color: "CCCCCC" },
                    bottom: { style: BorderStyle.SINGLE, size: 1, color: "CCCCCC" },
                    left: { style: BorderStyle.SINGLE, size: 1, color: "CCCCCC" },
                    right: { style: BorderStyle.SINGLE, size: 1, color: "CCCCCC" }
                  },
                  width: { size: 2340, type: WidthType.DXA },
                  children: [new Paragraph({ children: [new TextRun({ text: "connector/" })] })]
                }),
                new TableCell({
                  borders: { 
                    top: { style: BorderStyle.SINGLE, size: 1, color: "CCCCCC" },
                    bottom: { style: BorderStyle.SINGLE, size: 1, color: "CCCCCC" },
                    left: { style: BorderStyle.SINGLE, size: 1, color: "CCCCCC" },
                    right: { style: BorderStyle.SINGLE, size: 1, color: "CCCCCC" }
                  },
                  width: { size: 7020, type: WidthType.DXA },
                  children: [new Paragraph({ children: [new TextRun({ text: "Connector Gateway（外部工具连接）" })] })]
                })
              ]
            }),
            new TableRow({
              children: [
                new TableCell({
                  borders: { 
                    top: { style: BorderStyle.SINGLE, size: 1, color: "CCCCCC" },
                    bottom: { style: BorderStyle.SINGLE, size: 1, color: "CCCCCC" },
                    left: { style: BorderStyle.SINGLE, size: 1, color: "CCCCCC" },
                    right: { style: BorderStyle.SINGLE, size: 1, color: "CCCCCC" }
                  },
                  width: { size: 2340, type: WidthType.DXA },
                  children: [new Paragraph({ children: [new TextRun({ text: "mcp/" })] })]
                }),
                new TableCell({
                  borders: { 
                    top: { style: BorderStyle.SINGLE, size: 1, color: "CCCCCC" },
                    bottom: { style: BorderStyle.SINGLE, size: 1, color: "CCCCCC" },
                    left: { style: BorderStyle.SINGLE, size: 1, color: "CCCCCC" },
                    right: { style: BorderStyle.SINGLE, size: 1, color: "CCCCCC" }
                  },
                  width: { size: 7020, type: WidthType.DXA },
                  children: [new Paragraph({ children: [new TextRun({ text: "MCP 协议支持" })] })]
                })
              ]
            }),
            new TableRow({
              children: [
                new TableCell({
                  borders: { 
                    top: { style: BorderStyle.SINGLE, size: 1, color: "CCCCCC" },
                    bottom: { style: BorderStyle.SINGLE, size: 1, color: "CCCCCC" },
                    left: { style: BorderStyle.SINGLE, size: 1, color: "CCCCCC" },
                    right: { style: BorderStyle.SINGLE, size: 1, color: "CCCCCC" }
                  },
                  width: { size: 2340, type: WidthType.DXA },
                  children: [new Paragraph({ children: [new TextRun({ text: "memory/" })] })]
                }),
                new TableCell({
                  borders: { 
                    top: { style: BorderStyle.SINGLE, size: 1, color: "CCCCCC" },
                    bottom: { style: BorderStyle.SINGLE, size: 1, color: "CCCCCC" },
                    left: { style: BorderStyle.SINGLE, size: 1, color: "CCCCCC" },
                    right: { style: BorderStyle.SINGLE, size: 1, color: "CCCCCC" }
                  },
                  width: { size: 7020, type: WidthType.DXA },
                  children: [new Paragraph({ children: [new TextRun({ text: "记忆系统" })] })]
                })
              ]
            }),
            new TableRow({
              children: [
                new TableCell({
                  borders: { 
                    top: { style: BorderStyle.SINGLE, size: 1, color: "CCCCCC" },
                    bottom: { style: BorderStyle.SINGLE, size: 1, color: "CCCCCC" },
                    left: { style: BorderStyle.SINGLE, size: 1, color: "CCCCCC" },
                    right: { style: BorderStyle.SINGLE, size: 1, color: "CCCCCC" }
                  },
                  width: { size: 2340, type: WidthType.DXA },
                  children: [new Paragraph({ children: [new TextRun({ text: "model-provider/" })] })]
                }),
                new TableCell({
                  borders: { 
                    top: { style: BorderStyle.SINGLE, size: 1, color: "CCCCCC" },
                    bottom: { style: BorderStyle.SINGLE, size: 1, color: "CCCCCC" },
                    left: { style: BorderStyle.SINGLE, size: 1, color: "CCCCCC" },
                    right: { style: BorderStyle.SINGLE, size: 1, color: "CCCCCC" }
                  },
                  width: { size: 7020, type: WidthType.DXA },
                  children: [new Paragraph({ children: [new TextRun({ text: "模型提供者抽象" })] })]
                })
              ]
            }),
            new TableRow({
              children: [
                new TableCell({
                  borders: { 
                    top: { style: BorderStyle.SINGLE, size: 1, color: "CCCCCC" },
                    bottom: { style: BorderStyle.SINGLE, size: 1, color: "CCCCCC" },
                    left: { style: BorderStyle.SINGLE, size: 1, color: "CCCCCC" },
                    right: { style: BorderStyle.SINGLE, size: 1, color: "CCCCCC" }
                  },
                  width: { size: 2340, type: WidthType.DXA },
                  children: [new Paragraph({ children: [new TextRun({ text: "permissions/" })] })]
                }),
                new TableCell({
                  borders: { 
                    top: { style: BorderStyle.SINGLE, size: 1, color: "CCCCCC" },
                    bottom: { style: BorderStyle.SINGLE, size: 1, color: "CCCCCC" },
                    left: { style: BorderStyle.SINGLE, size: 1, color: "CCCCCC" },
                    right: { style: BorderStyle.SINGLE, size: 1, color: "CCCCCC" }
                  },
                  width: { size: 7020, type: WidthType.DXA },
                  children: [new Paragraph({ children: [new TextRun({ text: "权限管理" })] })]
                })
              ]
            }),
            new TableRow({
              children: [
                new TableCell({
                  borders: { 
                    top: { style: BorderStyle.SINGLE, size: 1, color: "CCCCCC" },
                    bottom: { style: BorderStyle.SINGLE, size: 1, color: "CCCCCC" },
                    left: { style: BorderStyle.SINGLE, size: 1, color: "CCCCCC" },
                    right: { style: BorderStyle.SINGLE, size: 1, color: "CCCCCC" }
                  },
                  width: { size: 2340, type: WidthType.DXA },
                  children: [new Paragraph({ children: [new TextRun({ text: "skills/" })] })]
                }),
                new TableCell({
                  borders: { 
                    top: { style: BorderStyle.SINGLE, size: 1, color: "CCCCCC" },
                    bottom: { style: BorderStyle.SINGLE, size: 1, color: "CCCCCC" },
                    left: { style: BorderStyle.SINGLE, size: 1, color: "CCCCCC" },
                    right: { style: BorderStyle.SINGLE, size: 1, color: "CCCCCC" }
                  },
                  width: { size: 7020, type: WidthType.DXA },
                  children: [new Paragraph({ children: [new TextRun({ text: "技能系统" })] })]
                })
              ]
            }),
            new TableRow({
              children: [
                new TableCell({
                  borders: { 
                    top: { style: BorderStyle.SINGLE, size: 1, color: "CCCCCC" },
                    bottom: { style: BorderStyle.SINGLE, size: 1, color: "CCCCCC" },
                    left: { style: BorderStyle.SINGLE, size: 1, color: "CCCCCC" },
                    right: { style: BorderStyle.SINGLE, size: 1, color: "CCCCCC" }
                  },
                  width: { size: 2340, type: WidthType.DXA },
                  children: [new Paragraph({ children: [new TextRun({ text: "subagents/" })] })]
                }),
                new TableCell({
                  borders: { 
                    top: { style: BorderStyle.SINGLE, size: 1, color: "CCCCCC" },
                    bottom: { style: BorderStyle.SINGLE, size: 1, color: "CCCCCC" },
                    left: { style: BorderStyle.SINGLE, size: 1, color: "CCCCCC" },
                    right: { style: BorderStyle.SINGLE, size: 1, color: "CCCCCC" }
                  },
                  width: { size: 7020, type: WidthType.DXA },
                  children: [new Paragraph({ children: [new TextRun({ text: "子代理系统" })] })]
                })
              ]
            }),
            new TableRow({
              children: [
                new TableCell({
                  borders: { 
                    top: { style: BorderStyle.SINGLE, size: 1, color: "CCCCCC" },
                    bottom: { style: BorderStyle.SINGLE, size: 1, color: "CCCCCC" },
                    left: { style: BorderStyle.SINGLE, size: 1, color: "CCCCCC" },
                    right: { style: BorderStyle.SINGLE, size: 1, color: "CCCCCC" }
                  },
                  width: { size: 2340, type: WidthType.DXA },
                  children: [new Paragraph({ children: [new TextRun({ text: "system-prompt/" })] })]
                }),
                new TableCell({
                  borders: { 
                    top: { style: BorderStyle.SINGLE, size: 1, color: "CCCCCC" },
                    bottom: { style: BorderStyle.SINGLE, size: 1, color: "CCCCCC" },
                    left: { style: BorderStyle.SINGLE, size: 1, color: "CCCCCC" },
                    right: { style: BorderStyle.SINGLE, size: 1, color: "CCCCCC" }
                  },
                  width: { size: 7020, type: WidthType.DXA },
                  children: [new Paragraph({ children: [new TextRun({ text: "系统提示生成" })] })]
                })
              ]
            }),
            new TableRow({
              children: [
                new TableCell({
                  borders: { 
                    top: { style: BorderStyle.SINGLE, size: 1, color: "CCCCCC" },
                    bottom: { style: BorderStyle.SINGLE, size: 1, color: "CCCCCC" },
                    left: { style: BorderStyle.SINGLE, size: 1, color: "CCCCCC" },
                    right: { style: BorderStyle.SINGLE, size: 1, color: "CCCCCC" }
                  },
                  width: { size: 2340, type: WidthType.DXA },
                  children: [new Paragraph({ children: [new TextRun({ text: "tools/" })] })]
                }),
                new TableCell({
                  borders: { 
                    top: { style: BorderStyle.SINGLE, size: 1, color: "CCCCCC" },
                    bottom: { style: BorderStyle.SINGLE, size: 1, color: "CCCCCC" },
                    left: { style: BorderStyle.SINGLE, size: 1, color: "CCCCCC" },
                    right: { style: BorderStyle.SINGLE, size: 1, color: "CCCCCC" }
                  },
                  width: { size: 7020, type: WidthType.DXA },
                  children: [new Paragraph({ children: [new TextRun({ text: "工具定义" })] })]
                })
              ]
            })
          ]
        }),
        
        // 配置系统
        new Paragraph({
          heading: HeadingLevel.HEADING_1,
          children: [new TextRun({ text: "配置系统" })]
        }),
        new Paragraph({
          spacing: { after: 200 },
          children: [
            new TextRun({ text: "配置分为两个独立的对象：" })
          ]
        }),
        
        // LayoutConfig
        new Paragraph({
          heading: HeadingLevel.HEADING_2,
          children: [new TextRun({ text: "LayoutConfig — 文件系统布局" })]
        }),
        new Paragraph({
          spacing: { after: 200 },
          children: [
            new TextRun({ 
              text: "interface LayoutConfig {\n  resourceRoot: string;      // 项目根目录（必填）\n  configDirName?: string;    // 配置目录名（默认 '.thething'）\n  dataDir?: string;          // 数据目录\n  resources?: Partial<ResourceDirs>;  // 自定义资源目录\n  contextFileNames?: readonly string[];  // 项目上下文文件名\n}", 
              font: "Courier New",
              size: 22
            })
          ]
        }),
        
        // BehaviorConfig
        new Paragraph({
          heading: HeadingLevel.HEADING_2,
          children: [new TextRun({ text: "BehaviorConfig — 运行时行为" })]
        }),
        new Paragraph({
          spacing: { after: 200 },
          children: [
            new TextRun({ 
              text: "interface BehaviorConfig {\n  maxStepsPerSession: number;        // 最大步骤数（默认 50）\n  maxBudgetUsdPerSession: number;    // 最大预算（默认 5.0）\n  maxContextTokens: number;          // 上下文限制（默认 128_000）\n  compactionThreshold: number;       // 压缩阈值（默认 25_000）\n  availableModels: ModelSpec[];      // 可用模型列表\n  modelAliases: { fast, smart, default };  // 模型快捷名映射\n  autoDowngradeCostThreshold: number;  // 自动降级阈值（默认 80）\n}", 
              font: "Courier New",
              size: 22
            })
          ]
        }),
        
        // 技术栈
        new Paragraph({
          heading: HeadingLevel.HEADING_1,
          children: [new TextRun({ text: "技术栈" })]
        }),
        new Paragraph({
          numbering: { reference: "bullet-list", level: 0 },
          children: [new TextRun({ text: "语言: TypeScript" })]
        }),
        new Paragraph({
          numbering: { reference: "bullet-list", level: 0 },
          children: [new TextRun({ text: "包管理: pnpm (monorepo)" })]
        }),
        new Paragraph({
          numbering: { reference: "bullet-list", level: 0 },
          children: [new TextRun({ text: "AI SDK: Vercel AI SDK (ai package)" })]
        }),
        new Paragraph({
          numbering: { reference: "bullet-list", level: 0 },
          children: [new TextRun({ text: "MCP: @modelcontextprotocol/sdk" })]
        }),
        new Paragraph({
          numbering: { reference: "bullet-list", level: 0 },
          children: [new TextRun({ text: "数据库: better-sqlite3" })]
        }),
        new Paragraph({
          numbering: { reference: "bullet-list", level: 0 },
          children: [new TextRun({ text: "前端: React + Vite + TailwindCSS" })]
        }),
        new Paragraph({
          numbering: { reference: "bullet-list", level: 0 },
          children: [new TextRun({ text: "服务端: Hono" })]
        }),
        
        // 文档
        new Paragraph({
          heading: HeadingLevel.HEADING_1,
          children: [new TextRun({ text: "文档" })]
        }),
        new Paragraph({
          spacing: { after: 200 },
          children: [
            new TextRun({ text: "项目包含以下设计文档：" })
          ]
        }),
        new Paragraph({
          numbering: { reference: "bullet-list", level: 0 },
          children: [new TextRun({ text: "配置重构方案 - 配置系统设计" })]
        }),
        new Paragraph({
          numbering: { reference: "bullet-list", level: 0 },
          children: [new TextRun({ text: "配置架构规范 - 配置层级规范" })]
        }),
        new Paragraph({
          numbering: { reference: "bullet-list", level: 0 },
          children: [new TextRun({ text: "Connector 设计 - Connector Gateway" })]
        }),
        new Paragraph({
          numbering: { reference: "bullet-list", level: 0 },
          children: [new TextRun({ text: "权限控制 - 权限系统" })]
        }),
        new Paragraph({
          numbering: { reference: "bullet-list", level: 0 },
          children: [new TextRun({ text: "预算管理 - Token 预算" })]
        }),
        
        // 许可证
        new Paragraph({
          heading: HeadingLevel.HEADING_1,
          children: [new TextRun({ text: "许可证" })]
        }),
        new Paragraph({
          spacing: { after: 200 },
          children: [
            new TextRun({ text: "本项目采用 MIT 许可证。" })
          ]
        }),
        
        // 贡献指南
        new Paragraph({
          heading: HeadingLevel.HEADING_1,
          children: [new TextRun({ text: "贡献指南" })]
        }),
        new Paragraph({
          spacing: { after: 200 },
          children: [
            new TextRun({ text: "欢迎贡献！请遵循以下步骤：" })
          ]
        }),
        new Paragraph({
          numbering: { reference: "numbered-list", level: 0 },
          children: [new TextRun({ text: "Fork 项目仓库" })]
        }),
        new Paragraph({
          numbering: { reference: "numbered-list", level: 0 },
          children: [new TextRun({ text: "创建功能分支 (git checkout -b feature/AmazingFeature)" })]
        }),
        new Paragraph({
          numbering: { reference: "numbered-list", level: 0 },
          children: [new TextRun({ text: "提交更改 (git commit -m 'Add some AmazingFeature')" })]
        }),
        new Paragraph({
          numbering: { reference: "numbered-list", level: 0 },
          children: [new TextRun({ text: "推送到分支 (git push origin feature/AmazingFeature)" })]
        }),
        new Paragraph({
          numbering: { reference: "numbered-list", level: 0 },
          children: [new TextRun({ text: "创建 Pull Request" })]
        }),
        
        // 联系方式
        new Paragraph({
          heading: HeadingLevel.HEADING_1,
          children: [new TextRun({ text: "联系方式" })]
        }),
        new Paragraph({
          spacing: { after: 200 },
          children: [
            new TextRun({ text: "项目维护者: TheThing 团队" })]
        }),
        new Paragraph({
          children: [
            new TextRun({ text: "项目链接: " }),
            new ExternalHyperlink({
              children: [new TextRun({ text: "https://github.com/your-org/thething", style: "Hyperlink" })],
              link: "https://github.com/your-org/thething"
            })
          ]
        })
      ]
    }
  ]
});

// 生成文档
Packer.toBuffer(doc).then(buffer => {
  fs.writeFileSync("TheThing-README.docx", buffer);
  console.log("README 文档已生成: TheThing-README.docx");
});
