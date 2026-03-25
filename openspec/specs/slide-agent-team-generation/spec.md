# slide-agent-team-generation Specification

## Purpose
TBD - created by archiving change add-agent-team-for-ppt-generation. Update Purpose after archive.
## Requirements
### Requirement: Agent Team MUST generate slide outline first
The system SHALL invoke an outline-focused agent to generate a complete slide outline before any page-level copy, background, or layout generation begins.

#### Scenario: Outline generated for target page count
- **WHEN** the user requests PPT generation with a topic and target page count
- **THEN** the system returns an ordered outline list with exactly the requested number of pages

#### Scenario: Missing outline blocks downstream execution
- **WHEN** the outline agent fails or returns incomplete page metadata
- **THEN** the system stops downstream stages and reports outline validation errors

### Requirement: Agent Team MUST generate page copy from outline
The system SHALL invoke a copy-focused agent that consumes the validated outline and produces per-slide textual content.

#### Scenario: Copy generated for every outline page
- **WHEN** a valid outline is available
- **THEN** the copy agent returns one copy payload per outline page including title and bullet points

#### Scenario: Copy page mismatch is rejected
- **WHEN** the copy output page count differs from outline page count
- **THEN** the system rejects the copy output and requires regeneration

### Requirement: Agent Team MUST produce background and layout artifacts
The system SHALL invoke dedicated background and layout agents to generate visual and structural artifacts for each slide.

#### Scenario: Visual artifacts generated in parallel
- **WHEN** outline and copy are both validated
- **THEN** the background and layout agents are executed in parallel for the same page set

#### Scenario: Invalid layout is blocked
- **WHEN** a layout artifact contains overlapping regions or out-of-bounds coordinates
- **THEN** the system marks the page as invalid and requests layout regeneration

### Requirement: Agent Team MUST compose final per-slide result
The system SHALL aggregate outline, copy, background, and layout outputs into a unified per-slide structure consumable by downstream render/export flows.

#### Scenario: Successful composition
- **WHEN** all four artifact streams pass validation
- **THEN** the system returns a complete slide array where each slide contains content, visual theme, and layout metadata

#### Scenario: Partial failure returns actionable diagnostics
- **WHEN** one or more artifact streams fail validation
- **THEN** the system returns a structured error report that identifies the failed agent, failed pages, and retry guidance

