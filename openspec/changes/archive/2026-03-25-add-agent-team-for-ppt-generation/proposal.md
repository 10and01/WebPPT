## Why

当前 AI 流程主要覆盖大纲和文案，缺少可复用的多代理协作机制来稳定产出视觉结果。随着一键生成 PPT 的需求增加，需要将内容生成与视觉设计拆分为明确角色并标准化编排，提升一致性与可控性。

## What Changes

- 新增一个面向 `/opsx:propose` 的 agent team 机制，用于多阶段生成与汇总。
- 定义 4 个核心角色：大纲代理、逐页文案代理、背景设计代理、布局排版代理。
- 增加统一的输入输出契约，确保每个代理可串联并支持失败重试。
- 增加执行顺序与依赖规则：先大纲，再文案，同时触发背景与布局，最后聚合。
- 增加最小可用质量门禁（页数一致性、文案完整性、背景可读性、布局可渲染性）。

## Capabilities

### New Capabilities
- `slide-agent-team-generation`: 为演示文稿生成建立多代理协作能力，覆盖大纲、逐页文案、背景、布局排版全流程。

### Modified Capabilities
- None.

## Impact

- Affected area: `.cursor/commands/opsx-propose.md` 的流程指令与执行策略。
- Potential affected area: AI 编排实现（如后续代码层落地在 `packages/server/src/routes/ai.ts` 与 `packages/server/src/services/ai/`）。
- User-facing impact: `/opsx:propose` 在“生成类需求”下可输出更完整的可执行方案，减少人工补齐背景与版式步骤。
