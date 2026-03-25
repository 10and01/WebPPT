## Why

当前系统已具备后端 agent-team 编排能力，但前端缺少显式“编排模式”开关，用户无法稳定选择 agent-team 方案；同时运行过程不可见，用户无法理解阶段进度与回退原因，影响可用性与可诊断性。

## What Changes

- 在前端 AI 生成区域新增 orchestration 模式选项（`auto` / `agent-team` / `single-agent`），并随请求传递到 `generate-by-outline` 接口。
- 在后端为 agent-team 流程增加可消费的运行时阶段事件（如 `outline_started`、`copy_completed`、`fallback_triggered`、`compose_completed`）。
- 在前端新增“Agent Team Workflow”运行视图，按时间线展示阶段状态、耗时、失败页与重试/回退信息。
- 扩展响应契约，确保生成结束后返回可回放的 workflow 轨迹（与最终 `orchestration` 结果一致）。
- 增加最小可观测性门禁：阶段顺序合法、状态闭环（start/end）、错误事件包含定位信息（stage/slide/code）。

## Capabilities

### New Capabilities
- `agent-team-runtime-visibility`: 定义编排运行时事件与前端展示契约，覆盖阶段进度、失败诊断与回退可视化。

### Modified Capabilities
- `slide-agent-team-generation`: 扩展生成能力要求，明确前端可选择编排模式并触发对应后端执行路径。

## Impact

- Affected code:
  - `packages/web/src/App.vue`
  - `packages/web/src/services/api.ts`
  - `packages/shared/src/types/deck.ts`
  - `packages/server/src/routes/ai.ts`
  - `packages/server/src/services/ai/gateway.ts`
- Affected API: `POST /api/ai/decks/:deckId/generate-by-outline` 请求与返回结构（新增 workflow 相关字段）。
- User-facing impact: 用户可显式启用 agent-team，并在运行时查看工作流阶段进度与失败原因。