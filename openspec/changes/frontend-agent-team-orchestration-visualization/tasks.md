## 1. Shared Contract Updates

- [x] 1.1 Extend shared orchestration types in `packages/shared/src/types/deck.ts` with workflow event schema (`stage`, `status`, `startedAt`, `endedAt`, `durationMs`, `slideIndexes`, `issueCode`, `message`, `retryHint`)
- [x] 1.2 Update `GenerateDeckFromOutlineResponse` typing to expose workflow trace under orchestration result

## 2. Server Orchestration Instrumentation

- [x] 2.1 Add workflow event recorder in `packages/server/src/services/ai/gateway.ts` for outline/copy/background/layout/compose/fallback stages
- [x] 2.2 Ensure mode-selection path in `packages/server/src/routes/ai.ts` respects explicit `orchestrationMode` and returns workflow trace consistently
- [x] 2.3 Add validation to guarantee workflow event sequence integrity (start/end pairing, valid stage transitions)

## 3. Web API and UI Integration

- [x] 3.1 Update `packages/web/src/services/api.ts` return typings to include workflow trace fields
- [x] 3.2 Add orchestration mode selector (`auto` / `agent-team` / `single-agent`) in `packages/web/src/App.vue` and pass it in generate request
- [x] 3.3 Add Agent Team workflow timeline panel in `packages/web/src/App.vue` to display stage status, duration, and fallback/error details

## 4. Validation and Regression Coverage

- [x] 4.1 Add or update server tests for explicit mode selection behavior and fallback workflow event emission
- [x] 4.2 Add or update UI tests (or component-level assertions) for mode selector payload mapping and timeline rendering
- [x] 4.3 Run repository test suite for changed packages and document results in change notes

## Validation Notes

- [x] `npm run build -w @web-ppt/shared`
- [x] `npm run typecheck -w @web-ppt/server`
- [x] `npm run typecheck -w @web-ppt/web`
- [x] `npm run test -w @web-ppt/server -- --run` (5 files, 26 tests passed)