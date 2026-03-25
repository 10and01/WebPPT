## ADDED Requirements

### Requirement: Orchestration mode MUST be selectable by client
The system SHALL accept explicit orchestration mode selection from clients for outline-driven generation requests.

#### Scenario: Client forces agent-team mode
- **WHEN** the client sends `orchestrationMode=agent-team`
- **THEN** the system executes the agent-team pipeline unless a fallback path is triggered by validation failures

#### Scenario: Client forces single-agent mode
- **WHEN** the client sends `orchestrationMode=single-agent`
- **THEN** the system bypasses agent-team execution and runs single-agent generation directly

#### Scenario: Client uses auto mode
- **WHEN** the client sends `orchestrationMode=auto` or omits the field
- **THEN** the system chooses execution mode using built-in trigger conditions

## MODIFIED Requirements

### Requirement: Agent Team MUST compose final per-slide result
The system SHALL aggregate outline, copy, background, and layout outputs into a unified per-slide structure consumable by downstream render/export flows, and SHALL include orchestration workflow data for client-side runtime replay.

#### Scenario: Successful composition
- **WHEN** all four artifact streams pass validation
- **THEN** the system returns a complete slide array where each slide contains content, visual theme, and layout metadata
- **AND** the system returns orchestration workflow events that mark compose stage success

#### Scenario: Partial failure returns actionable diagnostics
- **WHEN** one or more artifact streams fail validation
- **THEN** the system returns a structured error report that identifies the failed agent, failed pages, and retry guidance
- **AND** the system returns workflow events that identify the failed stage and fallback activation when applicable