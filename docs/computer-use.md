# Computer Use — 桌面操控功能设计

## 概述

让 TheThing Agent 具备操控桌面 GUI 的能力：看屏幕（眼）→ 理解界面（脑）→ 执行操作（手）。

核心原则：**眼-脑-手分离，各司其职。** 不要求 LLM 做物体识别（几何题），只让它做逻辑推理（选择题）。

## 架构

```
[ Agent Core (Node.js 进程) ]
        │
        ├── 眼 (Perception)
        │    ├── 截图模块 (screen.ts)          ← 跨平台截图
        │    └── Python 持久子进程 + IPC       ← OmniParser 视觉解析
        │
        ├── 脑 (Reasoning)
        │    └── LLM (Claude 等)               ← 仅做编号选择
        │
        └── 手 (Action)
             └── 原生输入封装 (action.ts)       ← 鼠标 / 键盘操作
```

### 数据流

```
1. Agent 收到用户任务 → 决定需要操作桌面
2. 截图模块截取当前屏幕 → raw image
3. raw image → stdin → Python 持久子进程
4. Python 子进程运行 OmniParser → 结构化 JSON ← stdout
     [{id, bbox: [x,y,w,h], type, label, content?}]
5. Agent 将结构化数据 + 标注图传给 LLM
6. LLM 决策 → "点击 5 号按钮" (只做选择题)
7. Agent 查坐标表 → 调用原生输入 API 执行操作
```

## 眼 (Perception)

### 截图模块

- V1: `screenshot-desktop` 库（跨平台，快速落地）
- V2: 平台原生 API — Windows DXGI Duplication API / macOS CGDisplay / Linux KMS/DRM（零拷贝，更低延迟）

### OmniParser 集成

**采用持久化 Python 子进程 + stdin/stdout IPC，而非 HTTP 微服务。**

理由：
- 模型加载一次后常驻内存，后续推理只走 IPC
- 零网络开销，比 HTTP 快 10-50ms
- 接近 90% 的进程内集成效果，但工程量低得多

```
进程生命周期：

[Electron 主进程 / CLI 进程]
    │
    ├── 启动时 ──spawn──> Python 持久进程
    │                        │
    │                        ├── stdout: {event: "ready", pid: ...}
    │                        │
    │  每帧截图：             │
    │  stdin:  {image: base64,...}
    │                        │
    │  stdout: {elements: [{id, bbox, type, label, content}],
    │           annotated_image: base64,...}
    │
    └── 关闭时 ──SIGTERM──> 安全退出
```

不采用 ONNX Runtime 内联重写的原因：
- OmniParser 依赖 Florence2 + YOLO，深度绑定 PyTorch
- 推理代码重写工程量远超收益
- 持久化子进程已经消除了主要瓶颈（模型加载时间）

## 脑 (Reasoning)

保留原设计的核心洞察：**LLM 只做选择题，不做几何题。**

OmniParser 输出结构化元素列表 + 标注图，LLM 接收后只需：
- 理解界面语义
- 决定操作哪个元素
- 输出元素 ID（而非像素坐标）

收益：
- 显著降低 LLM 视觉 token 消耗
- 减少坐标幻觉（"看歪"）
- 模型明确知道哪些是可交互组件

## 手 (Action)

### 鼠标操作
- V1: Nut.js（跨平台，快速落地）
- V2: 平台原生输入 API — Windows `SendInput` / macOS `CGEvent` / Linux `libxdo` / `uinput`（去掉 Nut.js 抽象层开销）

### 键盘操作
- 支持组合键（Ctrl+C, Cmd+V 等）
- 支持文本输入

### 安全隔离 (Human-in-the-Loop)
- 高危操作（删除文件、发送消息等）在动作执行前弹窗确认
- 由 `packages/core/src/modules/permissions/` 统一管控

## 项目代码结构

```
packages/core/src/modules/
  computer-use/                  ← 新增
  ├── perception.ts              ← 截图 + Python 子进程管理 + IPC
  ├── action.ts                  ← 原生输入封装 (click/type/scroll/drag)
  ├── screen.ts                  ← 跨平台截图抽象
  ├── types.ts                   ← TS 类型定义 (映射 OmniParser JSON)
  └── computer-use.tool          ← Agent tool 定义

packages/desktop/
  computer-use/                  ← Python 源码
  ├── omniparser_server.py       ← 持久化推理进程 (stdin/stdout)
  ├── requirements.txt
  └── Dockerfile                 ← 可选，环境隔离
```

## 迭代路线图

### V1 — 跑通闭环
- 截图: `screenshot-desktop`
- 视觉: Python 持久子进程 + OmniParser
- 动作: Nut.js
- 目标: 验证眼-脑-手闭环可用

### V2 — 性能优化
- 截图: 平台原生 API
- 视觉: IPC 协议优化，减少序列化开销
- 动作: 平台原生输入 API（砍掉 Nut.js）

### V3 — 极致体验
- 端到端延迟 < 100ms
- 非标准 UI 框架支持（游戏、Canvas、WebGL）
- 多显示器支持

## 技术要点

### GPU 依赖
- OmniParser 需要 CUDA 环境才能达到可用速度
- 建议使用 Docker 封装 Python 环境
- Electron 打包时需包含 GPU 驱动检测逻辑

### 类型安全
- 为 OmniParser 输出定义强类型 TS interface
- 示例:

```typescript
interface OmniParserResult {
  elements: Array<{
    id: number;
    bbox: [x: number, y: number, w: number, h: number];
    type: 'button' | 'textbox' | 'label' | 'checkbox' | ...;
    label: string;
    content?: string;
  }>;
  annotated_image: string;  // base64
  width: number;
  height: number;
}
```

### 错误处理
- Python 子进程崩溃 → 自动重启
- 截图失败 → 重试 + 降级提示
- LLM 返回无效 ID → 重试或报错

## 与现有架构的关系

- 建模为一个 **Agent tool**（`computer_use`），复用现有的 tool 执行框架
- 权限控制复用 `packages/core/src/modules/permissions/` 系统
- 子进程管理可参考已有的 MCP 连接管理逻辑
- Electron 端通过 preload script 暴露原生 API 给渲染进程