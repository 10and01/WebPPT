## ADDED Requirements

### Requirement: Workflow trace MUST be returned for orchestration runs
The system SHALL return a structured workflow trace for `generate-by-outline` runs so clients can replay stage progression and diagnose failures.

#### Scenario: Agent-team run returns stage trace
- **WHEN** a request executes with `orchestrationMode=agent-team`
- **THEN** the response includes a `workflow` event list that covers outline, copy, background, layout, and compose stages with stage status and timestamps

#### Scenario: Fallback run includes fallback event
- **WHEN** agent-team validation fails and fallback is triggered
- **THEN** the response includes a workflow event indicating fallback stage activation and links it to failure stage metadata

### Requirement: Workflow events MUST contain diagnostics fields
Each workflow event SHALL include enough context for UI diagnostics, including stage, status, time window, and optional issue mapping.

#### Scenario: Failed stage includes issue context
- **WHEN** a stage completes with failure
- **THEN** the event includes `issueCode`, `message`, and `slideIndexes` fields

#### Scenario: Successful stage includes duration
- **WHEN** a stage completes successfully
- **THEN** the event includes `startedAt`, `endedAt`, and `durationMs` values

### Requirement: Frontend MUST render workflow timeline from server events
The web client SHALL render orchestration progress from server-provided workflow events without client-side inference of hidden stages.

#### Scenario: Timeline renders ordered stages
- **WHEN** the client receives a response with workflow events
- **THEN** it renders stage items in execution order with per-stage status badges

#### Scenario: Timeline shows failure summary
- **WHEN** workflow includes failed events or fallback events
- **THEN** the client shows an actionable summary including stage name, issue code, and retry hint