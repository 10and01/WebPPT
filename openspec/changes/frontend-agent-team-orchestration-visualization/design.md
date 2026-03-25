## Context

当前后端已在 `generate-by-outline` 路径支持 `orchestrationMode` 入参，并能返回最终 `orchestration` 汇总结果，但前端未暴露模式选择；同时只返回终态汇总，不包含阶段级可观测数据，导致用户无法判断流程是否走了 agent-team、卡在哪个阶段、是否触发 fallback。

该改动涉及 `packages/web`、`packages/server`、`packages/shared` 三层契约，属于跨模块编排可观测性增强。

## Goals / Non-Goals

**Goals:**
- 在前端提供可显式选择的编排模式（`auto` / `agent-team` / `single-agent`）。
- 在后端生成并返回标准化 workflow 轨迹，覆盖 outline/copy/background/layout/compose/fallback 关键阶段。
- 在前端渲染运行时工作流视图，展示阶段状态、耗时、错误定位与回退信息。
- 保持对现有调用方兼容（未使用 workflow 字段时不影响既有逻辑）。

**Non-Goals:**
- 不引入新的流式协议（如 SSE/WebSocket）作为本次必需方案。
- 不调整 AI provider 侧模型策略与提示词框架。
- 不重构协同编辑通道（`collab`）以承载 AI 事件。

## Decisions

1. 采用“请求内回传轨迹（post-run trace）”作为第一阶段实现。
- `generate-by-outline` 完成后一次性返回 `workflow` 数组，元素包含 `stage`、`status`、`startedAt`、`endedAt`、`durationMs`、`slideIndexes`、`message`、`issueCode`。
- 选择理由：最小侵入、无需新增连接管理、可直接在现有 REST 调用中消费。
- 备选方案：SSE 实时推送。暂不采用，原因是前端/服务端需要额外连接生命周期与中断恢复处理。

2. 将轨迹模型定义在 shared types，并由后端统一生产。
- 在 `packages/shared/src/types/deck.ts` 扩展 `SlideAgentTeamResult`，新增 `workflow` 字段与事件类型定义。
- 选择理由：前后端类型对齐，避免 UI 自行推断阶段状态。
- 备选方案：前端根据 `issues` 和耗时自行推导。放弃原因：信息不完整且不可解释。

3. 保持 `orchestrationMode=auto` 为默认行为，前端新增显式选择控件。
- 前端控件直接映射到请求体 `orchestrationMode`，并将用户选择保留在页面状态。
- 选择理由：保持向后兼容，同时给高级用户确定性控制。
- 备选方案：仅保留自动判定。放弃原因：难以复现与调试 agent-team 路径。

4. 工作流展示采用“阶段时间线 + 异常摘要”双区块。
- 时间线展示阶段顺序与状态（pending/running/succeeded/failed/skipped）。
- 异常摘要聚合 `issueCode + stage + slideIndexes + retryHint`。
- 选择理由：同时满足“过程可见”和“问题可定位”。

## Risks / Trade-offs

- [Risk] 一次性回传无法实时刷新阶段进度 -> Mitigation: 明确本期为回放视图，后续可平滑升级为 SSE。
- [Risk] workflow 字段膨胀导致响应体增大 -> Mitigation: 事件粒度控制为阶段级，不记录 token 级日志。
- [Risk] agent-team 与 single-agent 轨迹结构不一致 -> Mitigation: 统一事件 schema，通过 `mode` + `stage` 标识差异路径。
- [Risk] 前端状态展示与后端真实执行偏差 -> Mitigation: 前端仅渲染后端事件，不自行拼装阶段状态。

## Migration Plan

1. 扩展 shared 类型（workflow 事件定义与响应结构）。
2. 在 server 的 agent-team orchestration 中注入事件记录器并输出轨迹。
3. 在 web API 层更新 `generateDeckByOutline` 返回类型并透传 `workflow`。
4. 在 UI 中新增模式选择与 workflow 时间线展示。
5. 增加测试：模式透传、轨迹顺序、fallback 事件、错误定位字段完整性。

Rollback:
- 移除 `workflow` 字段写入与前端渲染逻辑，保留既有 `orchestration.issues` 汇总结构；`orchestrationMode` 选择可隐藏但不影响后端兼容。

## Open Questions

- 是否要求在首版即提供“按 slide 过滤”视图，还是先以阶段总览为主？
- `durationMs` 是否以 wall-clock 计算，还是以后端阶段估算值为准？
- fallback 触发后，是否需要在 UI 中并排展示“team 失败稿”与“single-agent 结果”？