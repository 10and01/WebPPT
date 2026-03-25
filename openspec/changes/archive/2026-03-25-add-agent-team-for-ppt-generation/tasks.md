## 1. Proposal and Command Alignment

- [x] 1.1 Add agent-team workflow section in .cursor command guidance for /opsx:propose
- [x] 1.2 Define role responsibilities for OutlineAgent, CopyAgent, BackgroundAgent, and LayoutAgent
- [x] 1.3 Define trigger conditions for enabling team mode in PPT generation requests

## 2. Contract and Validation Design

- [x] 2.1 Define shared JSON contracts for outline, copy, background, and layout artifacts
- [x] 2.2 Define stage-level validation rules (page count, completeness, readability, renderability)
- [x] 2.3 Define structured error schema for partial failures and retry hints

## 3. Orchestration Flow

- [x] 3.1 Implement sequential and parallel stage order in orchestration logic
- [x] 3.2 Implement composer step to merge 4 artifact streams into per-slide payloads
- [x] 3.3 Add fallback path to single-agent flow when team mode fails

## 4. Verification and Readiness

- [x] 4.1 Add tests for successful end-to-end team generation flow
- [x] 4.2 Add tests for page mismatch, invalid layout, and missing outline failures
- [x] 4.3 Validate OpenSpec artifacts are apply-ready and update docs if needed
