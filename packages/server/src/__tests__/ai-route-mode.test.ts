import { describe, expect, it } from "vitest";
import { shouldUseAgentTeamMode } from "../routes/ai";

describe("AI route orchestration mode selection", () => {
  it("forces agent-team when mode is explicitly agent-team", () => {
    expect(
      shouldUseAgentTeamMode({
        topic: "test",
        pages: 3,
        orchestrationMode: "agent-team"
      })
    ).toBe(true);
  });

  it("forces single-agent when mode is explicitly single-agent", () => {
    expect(
      shouldUseAgentTeamMode({
        topic: "test",
        pages: 3,
        orchestrationMode: "single-agent"
      })
    ).toBe(false);
  });

  it("uses keyword trigger in auto mode", () => {
    expect(
      shouldUseAgentTeamMode({
        topic: "产品发布",
        pages: 4,
        orchestrationMode: "auto",
        requirements: "请生成大纲、文案、背景和排版"
      })
    ).toBe(true);

    expect(
      shouldUseAgentTeamMode({
        topic: "simple intro",
        pages: 2,
        orchestrationMode: "auto",
        requirements: "keep it short"
      })
    ).toBe(false);
  });
});
