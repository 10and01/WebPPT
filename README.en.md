# WEB-PPT

An online PPT editing prototype built with Vue 3 + Fastify + TypeScript.

Key capabilities:

- Canvas editing (text / shapes / images)
- One-click Markdown to slides import
- AI-assisted outline and copy generation (OpenAI / Anthropic / Mock)
- Real-time collaboration (Yjs + WebSocket)
- Multi-format export (HTML / PDF / PNG / PPTX)

## Project Structure

```text
WEB-PPT/
├─ packages/
│  ├─ web/      # Frontend: Vue + Vite
│  ├─ server/   # Backend: Fastify + WebSocket + export services
│  └─ shared/   # Shared types
├─ package.json
└─ pnpm-workspace.yaml
```

## Tech Stack

- Frontend: Vue 3, Vite, TypeScript
- Backend: Fastify, @fastify/websocket, TypeScript
- Collaboration: Yjs, ws
- AI: OpenAI SDK, Anthropic SDK (falls back to Mock when keys are missing)
- Export: PptxGenJS, Puppeteer

## Requirements

- Node.js 20+
- npm 10+
- Windows / macOS / Linux

Recommended: use the npm version declared in the repo (`npm@11.6.2`).

## Quick Start

Run from repository root:

```bash
npm install
npm run dev
```

Default ports:

- Frontend: `http://localhost:5173`
- Backend: `http://localhost:4000`

The frontend Vite server proxies `/api` to `http://localhost:4000`.

## Common Commands

### Root

```bash
npm run dev         # Start all workspaces (web/server/shared)
npm run build       # Build all workspaces
npm run typecheck   # Type-check all workspaces
```

### Backend only

```bash
npm run dev -w @web-ppt/server
npm run test -w @web-ppt/server
npm run typecheck -w @web-ppt/server
```

### Frontend only

```bash
npm run dev -w @web-ppt/web
npm run build -w @web-ppt/web
npm run typecheck -w @web-ppt/web
```

### Shared package only

```bash
npm run dev -w @web-ppt/shared
npm run build -w @web-ppt/shared
npm run typecheck -w @web-ppt/shared
```

## Backend Configuration

The backend reads these environment variables:

- `PORT`: listen port, default `4000`
- `HOST`: listen host, default `0.0.0.0`
- `PUPPETEER_EXECUTABLE_PATH`: optional path to Chrome/Chromium executable (for PDF/PNG export)

## AI Configuration

Each deck includes `aiConfig`, configurable from UI or API:

- `provider`: `openai` / `anthropic` / `ollama`
- `apiKey`, `apiEndpoint`, `model`, `temperature`, `maxTokens`

If provider config is incomplete (for example missing `apiKey`), the backend automatically falls back to Mock provider for local demo and integration.

## API Overview

### Health

- `GET /health`

### Deck

- `GET /api/decks`: list decks
- `POST /api/decks`: create a deck
- `GET /api/decks/:deckId`: get deck details
- `POST /api/decks/:deckId/slides`: add a slide
- `PUT /api/decks/:deckId/slides/:slideId/elements`: replace slide elements
- `PUT /api/decks/:deckId/ai-config`: update AI config

### Markdown Import

- `POST /api/decks/:deckId/import-markdown`

### AI

- `POST /api/ai/decks/:deckId/generate`: generate a full deck draft
- `POST /api/ai/decks/:deckId/polish`: polish text
- `POST /api/ai/decks/:deckId/visuals`: get visual suggestions
- `POST /api/ai/decks/:deckId/outline`: generate outline
- `POST /api/ai/decks/:deckId/copy`: generate paginated copy
- `POST /api/ai/decks/:deckId/generate-by-outline`: generate full slides from outline (supports agent-team orchestration)

Key `generate-by-outline` fields:
- `orchestrationMode`: `auto` | `agent-team` | `single-agent`
- `disableFallback`: disable fallback when orchestration fails (default `false`)

Response `orchestration` metadata includes:
- actual mode used (`agent-team` or `single-agent`)
- whether fallback was triggered
- stage-level validation issues and retry hints

### Export

- `POST /api/exports`: create export job (`html` / `pdf` / `png` / `pptx`)
- `GET /api/exports/:jobId`: get export job status
- `GET /api/exports/:jobId/download`: download single-file result (html/pdf/pptx)
- `GET /api/exports/:jobId/files`: list PNG files
- `GET /api/exports/:jobId/files/:index`: download one PNG

### Collaboration

- `WS /ws/collab?deckId=...&userId=...&userName=...&role=owner|editor|viewer`

## Minimal Runnable Requests (curl)

Make sure backend is running at `http://localhost:4000`.

On Windows PowerShell, prefer `curl.exe` to avoid alias behavior.

1. Health check

```bash
curl http://localhost:4000/health
```

2. Create a deck

```bash
curl -X POST http://localhost:4000/api/decks \
  -H "Content-Type: application/json" \
  -d '{"title":"Demo Deck","createdBy":"demo-user"}'
```

3. List decks (copy `deck.id` from response)

```bash
curl http://localhost:4000/api/decks
```

4. Replace `DECK_ID`, then import Markdown into slides

```bash
curl -X POST http://localhost:4000/api/decks/DECK_ID/import-markdown \
  -H "Content-Type: application/json" \
  -d '{"markdown":"# Business Review\n\n- Revenue up 25%\n- Cost down 10%\n- Next focus: retention"}'
```

5. Start an HTML export job

```bash
curl -X POST http://localhost:4000/api/exports \
  -H "Content-Type: application/json" \
  -d '{"deckId":"DECK_ID","format":"html"}'
```

6. Query export job (replace `JOB_ID` with `job.id` from previous response)

```bash
curl http://localhost:4000/api/exports/JOB_ID
```

When status becomes `completed`, download using the returned `outputPath`.

## Export Notes

PDF/PNG export depends on browser runtime. If export fails, choose one:

1. Install Chrome or Edge (default Windows paths are auto-detected)
2. Install Chromium manually:

```bash
npx puppeteer browsers install chrome
```

3. Set `PUPPETEER_EXECUTABLE_PATH` to your browser executable path

## Testing and Type Checking

Backend tests use Vitest (`packages/server/src/__tests__`).

Recommended before committing:

```bash
npm run typecheck
npm run test -w @web-ppt/server
```

## Current Status

This repository is currently a runnable prototype, suitable for:

- Architecture validation for online slide editing
- Experience validation for AI generation and editing flow
- End-to-end validation for collaboration and export pipeline

For production readiness, consider adding persistent storage, robust RBAC, async job queueing, export isolation, and monitoring/observability.
