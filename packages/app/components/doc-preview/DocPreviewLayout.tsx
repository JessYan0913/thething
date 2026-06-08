"use client";

import { useState } from "react";
import { DocSidebar } from "./DocSidebar";
import { DocContent } from "./DocContent";

export interface DocItem {
  id: string;
  title: string;
  type: "md" | "txt" | "json";
  content: string;
  updatedAt: Date;
}

// 模拟数据
const MOCK_DOCS: DocItem[] = [
  {
    id: "1",
    title: "Connector gateway design v2",
    type: "md",
    content: `# Connector Gateway Design v2

## 概述

架构层面新增了 Inbound Layer，把 Gateway 从"单向出站"扩展成"双向"——微信/飞书推消息进来，Agent 处理后再通过 Gateway 发出去，形成完整对话闭环。

## 第一阶段（基础能力）：

- 基础 Audit Log

## 第二阶段（稳定性）：

- 重试 + 指数退避
- 熔断器（按租户隔离）
- Circuit Breaker 监控告警
- 能管平台 Manifest 模板库

## 第三阶段（扩展性）：

- Script Executor
- MCP Executor
- 飞书卡片消息（交互式回复）
- 管理面 UI（Connector 注册、租户配置、连接测试）

## 九、三个系统对比总结

| 维度 | 企业微信 | 飞书 | 能管平台 |
|------|---------|------|---------|
| 接入方向 | 双向 | 双向 | 单向（出站） |
| Executor | HTTP | HTTP | HTTP 或 SQL |
| 消息格式 | XML | JSON | N/A |
| 加解密 | AES-256-CBC 专有 padding | AES-256-CBC 标准 | N/A |
| Token | 2h, AppID+Secret 获取 | 2h, AppID+Secret 获取 | API Key 或无 |
| 最大挑战 | 三种子形态兼容 | 较标准，实现最简单 | 每个客户接口不同 |
| 多租户差异 | subtype 字段区分形态 | 无差异 | 每客户独立 Connector |

文档版本：v2.0 | 最后更新：2026-04`,
    updatedAt: new Date("2026-04-01"),
  },
  {
    id: "2",
    title: "Agent 多系统能力集成方案",
    type: "md",
    content: `# Agent 多系统能力集成方案

## 目标

实现 Agent 与多个外部系统的集成能力，包括企业微信、飞书、能管平台等。

## 架构设计

采用微服务架构，通过 Connector Gateway 统一管理外部系统连接。

## 技术选型

- 消息队列：RabbitMQ
- 缓存：Redis
- 数据库：PostgreSQL`,
    updatedAt: new Date("2026-03-15"),
  },
  {
    id: "3",
    title: "API 接口文档",
    type: "json",
    content: `{
  "openapi": "3.0.0",
  "info": {
    "title": "Connector Gateway API",
    "version": "2.0.0"
  },
  "paths": {
    "/api/v1/messages": {
      "post": {
        "summary": "发送消息",
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "tenantId": { "type": "string" },
                  "content": { "type": "string" }
                }
              }
            }
          }
        }
      }
    }
  }
}`,
    updatedAt: new Date("2026-03-10"),
  },
];

export default function DocPreviewLayout() {
  const [docs, setDocs] = useState<DocItem[]>(MOCK_DOCS);
  const [selectedDocId, setSelectedDocId] = useState<string | null>("1");
  const [selectedFile, setSelectedFile] = useState<DocItem | null>(docs[0] ?? null);

  const handleSelectDoc = (id: string) => {
    setSelectedDocId(id);
    setSelectedFile(docs.find((d) => d.id === id) ?? null);
  };

  const handleNewDoc = () => {
    const newDoc: DocItem = {
      id: String(Date.now()),
      title: "未命名文档",
      type: "md",
      content: "# 新文档\n\n在此输入内容...",
      updatedAt: new Date(),
    };
    setDocs([newDoc, ...docs]);
    setSelectedDocId(newDoc.id);
    setSelectedFile(newDoc);
  };

  const handleDeleteDoc = (id: string) => {
    setDocs(docs.filter((d) => d.id !== id));
    if (selectedDocId === id) {
      setSelectedDocId(docs[0]?.id ?? null);
      setSelectedFile(docs[0] ?? null);
    }
  };

  const handleUpdateDoc = (id: string, content: string) => {
    setDocs(
      docs.map((d) =>
        d.id === id ? { ...d, content, updatedAt: new Date() } : d
      )
    );
    if (selectedDocId === id) {
      setSelectedFile((prev) => (prev ? { ...prev, content } : null));
    }
  };

  return (
    <div className="flex h-screen w-full overflow-hidden bg-background">
      {/* 左侧边栏 */}
      <DocSidebar
        docs={docs}
        selectedDocId={selectedDocId}
        onSelectDoc={handleSelectDoc}
        onNewDoc={handleNewDoc}
        onDeleteDoc={handleDeleteDoc}
      />

      {/* 右侧内容区 */}
      <DocContent
        doc={selectedFile}
        onUpdateDoc={handleUpdateDoc}
      />
    </div>
  );
}
