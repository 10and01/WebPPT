# WEB-PPT

基于 Vue 3 + Fastify + TypeScript 的在线 PPT 编辑原型，支持：

- 画布编辑（文本 / 形状 / 图片）
- Markdown 一键导入为幻灯片
- AI 文案与大纲辅助（OpenAI / Anthropic / Mock）
- 协同编辑（Yjs + WebSocket）
- 多格式导出（HTML / PDF / PNG / PPTX）

## 项目结构

```text
WEB-PPT/
├─ packages/
│  ├─ web/      # 前端：Vue + Vite
│  ├─ server/   # 后端：Fastify + WebSocket + 导出服务
│  └─ shared/   # 共享类型定义
├─ package.json
└─ pnpm-workspace.yaml
```

## 技术栈

- 前端：Vue 3, Vite, TypeScript
- 后端：Fastify, @fastify/websocket, TypeScript
- 协同：Yjs, ws
- AI：OpenAI SDK, Anthropic SDK（无 Key 时自动回退 Mock）
- 导出：PptxGenJS, Puppeteer

## 环境要求

- Node.js 20+
- npm 10+
- Windows / macOS / Linux

> 建议使用与仓库一致的 npm 版本（当前 packageManager 为 npm@11.6.2）。

## 快速开始

在仓库根目录执行：

```bash
npm install
npm run dev
```

默认端口：

- 前端：`http://localhost:5173`
- 后端：`http://localhost:4000`

前端已通过 Vite 代理将 `/api` 转发到 `http://localhost:4000`。

## 常用命令

### 根目录

```bash
npm run dev         # 启动所有 workspace（web/server/shared）
npm run build       # 构建所有 workspace
npm run typecheck   # 全量类型检查
```

### 仅后端

```bash
npm run dev -w @web-ppt/server
npm run test -w @web-ppt/server
npm run typecheck -w @web-ppt/server
```

### 仅前端

```bash
npm run dev -w @web-ppt/web
npm run build -w @web-ppt/web
npm run typecheck -w @web-ppt/web
```

### 仅共享类型

```bash
npm run dev -w @web-ppt/shared
npm run build -w @web-ppt/shared
npm run typecheck -w @web-ppt/shared
```

## 后端配置

服务端默认读取以下环境变量：

- `PORT`：监听端口，默认 `4000`
- `HOST`：监听地址，默认 `0.0.0.0`
- `PUPPETEER_EXECUTABLE_PATH`：可选，指定 Chrome/Chromium 可执行文件路径（用于 PDF/PNG 导出）

## AI 配置说明

每个 Deck 内含 `aiConfig`，可通过前端设置或接口更新：

- `provider`：`openai` / `anthropic` / `ollama`
- `apiKey`、`apiEndpoint`、`model`、`temperature`、`maxTokens`

当 provider 未正确配置（例如缺少 `apiKey`）时，服务端会自动使用 Mock provider，便于本地演示与联调。

## API 概览

### 健康检查

- `GET /health`

### Deck

- `GET /api/decks`：获取 deck 列表
- `POST /api/decks`：创建 deck
- `GET /api/decks/:deckId`：获取 deck 详情
- `POST /api/decks/:deckId/slides`：新增 slide
- `PUT /api/decks/:deckId/slides/:slideId/elements`：覆盖 slide 元素
- `PUT /api/decks/:deckId/ai-config`：更新 AI 配置

### Markdown 导入

- `POST /api/decks/:deckId/import-markdown`

### AI

- `POST /api/ai/decks/:deckId/generate`：生成整套草稿
- `POST /api/ai/decks/:deckId/polish`：润色文本
- `POST /api/ai/decks/:deckId/visuals`：视觉建议
- `POST /api/ai/decks/:deckId/outline`：生成大纲
- `POST /api/ai/decks/:deckId/copy`：生成分页文案

### 导出

- `POST /api/exports`：创建导出任务（`html` / `pdf` / `png` / `pptx`）
- `GET /api/exports/:jobId`：查询任务状态
- `GET /api/exports/:jobId/download`：下载单文件结果（html/pdf/pptx）
- `GET /api/exports/:jobId/files`：获取 PNG 文件列表
- `GET /api/exports/:jobId/files/:index`：下载单张 PNG

### 协同

- `WS /ws/collab?deckId=...&userId=...&userName=...&role=owner|editor|viewer`

## 最小可运行示例（curl）

先确保后端已启动（`http://localhost:4000`）。

> 在 Windows PowerShell 中建议使用 `curl.exe`，避免与内置别名冲突。

1. 健康检查

```bash
curl http://localhost:4000/health
```

2. 创建一个 deck

```bash
curl -X POST http://localhost:4000/api/decks \
	-H "Content-Type: application/json" \
	-d '{"title":"Demo Deck","createdBy":"demo-user"}'
```

3. 获取 deck 列表（从返回结果里复制 `deck.id`）

```bash
curl http://localhost:4000/api/decks
```

4. 将 `DECK_ID` 替换为真实值后，导入 Markdown 生成幻灯片

```bash
curl -X POST http://localhost:4000/api/decks/DECK_ID/import-markdown \
	-H "Content-Type: application/json" \
	-d '{"markdown":"# 业务复盘\n\n- 增长 25%\n- 成本下降 10%\n- 下一步聚焦留存"}'
```

5. 发起 HTML 导出任务

```bash
curl -X POST http://localhost:4000/api/exports \
	-H "Content-Type: application/json" \
	-d '{"deckId":"DECK_ID","format":"html"}'
```

6. 查询导出任务（将 `JOB_ID` 替换为上一步返回的 `job.id`）

```bash
curl http://localhost:4000/api/exports/JOB_ID
```

当状态为 `completed` 时，使用返回的 `outputPath` 下载结果。

## 导出功能注意事项

PDF/PNG 导出依赖浏览器内核。若启动导出时报错，可任选一种方式：

1. 安装 Chrome/Edge（Windows 默认路径可被自动探测）
2. 手动安装 Chromium：

```bash
npx puppeteer browsers install chrome
```

3. 设置 `PUPPETEER_EXECUTABLE_PATH` 指向本机浏览器可执行文件

## 测试与类型检查

后端提供 Vitest 测试（位于 `packages/server/src/__tests__`）。

推荐在提交前执行：

```bash
npm run typecheck
npm run test -w @web-ppt/server
```

## 当前定位

该项目当前更偏向可运行原型（Prototype），适合用于：

- 在线幻灯片编辑器架构验证
- AI 生成与编辑流体验验证
- 协同编辑与导出链路验证

如需生产化，可继续补充：持久化存储、权限体系、任务队列、导出隔离与监控等能力。
