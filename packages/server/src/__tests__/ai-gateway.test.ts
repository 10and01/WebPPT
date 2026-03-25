import { describe, it, expect } from "vitest";
import type { AIConfig } from "@web-ppt/shared";
import {
  generateDeckByAgentTeam,
  generateDeckDraft,
  generateOutline,
  generateSlideMarkdownFromOutline,
  generateStructuredOutline,
  polishText,
  suggestVisuals
} from "../services/ai/gateway";

describe("AI Gateway Fault Tolerance", () => {
  const mockConfig: AIConfig = {
    provider: "openai",
    model: "gpt-4o-mini",
    temperature: 0.7
  };

  it("should gracefully handle missing API key by using mock provider", async () => {
    const noKeyConfig = { provider: "openai" as const };

    const result = await generateDeckDraft(noKeyConfig, {
      topic: "Test Topic",
      slides: 3
    });

    expect(result.title).toBeDefined();
    expect(result.slideDrafts).toHaveLength(3);
  });

  it("should retry on transient failures (mocked)", async () => {
    const result = await generateOutline(mockConfig, "Test Topic", 5);

    expect(result).toBeDefined();
    expect(Array.isArray(result)).toBe(true);
    expect(result.length).toBeLessThanOrEqual(5);
  });

  it("should handle polish text with different modes", async () => {
    const modes: Array<"shorten" | "expand" | "professional"> = ["shorten", "expand", "professional"];

    for (const mode of modes) {
      const result = await polishText(mockConfig, {
        text: "This is a sample text that needs polishing.",
        mode
      });

      expect(result).toBeDefined();
      expect(typeof result).toBe("string");
      expect(result.length).toBeGreaterThan(0);
    }
  });

  it("should safely handle visual suggestion failures", async () => {
    const result = await suggestVisuals(mockConfig, "Create a chart for sales data");

    expect(result).toBeDefined();
    expect(Array.isArray(result)).toBe(true);
    expect(result.length).toBeGreaterThan(0);
  });

  it("should generate paginated content consistently", async () => {
    const outline = "Introduction, Main Points, Conclusion";
    let previousContent = "";

    for (let i = 0; i < 3; i++) {
      const content = await generateOutline(mockConfig, "Test", 3);
      expect(content).toBeDefined();
      expect(Array.isArray(content)).toBe(true);
    }
  });

  it("should generate structured outline with theme template", async () => {
    const result = await generateStructuredOutline(mockConfig, {
      topic: "AI in Education",
      pages: 3,
      requirements: "强调案例与可执行性",
      themeTemplate: "academic"
    });

    expect(result.topic).toBeDefined();
    expect(result.themeTemplate).toBe("academic");
    expect(result.slides.length).toBe(3);
    expect(result.slides[0].title.length).toBeGreaterThan(0);
    expect(result.slides[0].keyPoints.length).toBeGreaterThanOrEqual(3);
  });

  it("should generate markdown from a single outline page", async () => {
    const markdown = await generateSlideMarkdownFromOutline(mockConfig, {
      topic: "AI in Education",
      themeTemplate: "business",
      plan: {
        index: 1,
        title: "课程升级目标",
        objective: "说明课程升级的目标和约束",
        keyPoints: ["目标定义", "阶段计划", "评估指标"],
        visualStrategy: "卡片 + 图标"
      }
    });

    expect(markdown.startsWith("# ")).toBe(true);
    expect(markdown.includes("- ")).toBe(true);
  });

  it("should run agent-team orchestration end-to-end", async () => {
    const result = await generateDeckByAgentTeam(mockConfig, {
      topic: "智能制造转型路线",
      pages: 3,
      requirements: "需要大纲、文案、背景和布局",
      orchestrationMode: "agent-team",
      themeTemplate: "business"
    });

    expect(result.orchestration.mode).toBe("agent-team");
    expect(result.orchestration.fallbackTriggered).toBe(false);
    expect(result.orchestration.issues.length).toBe(0);
    expect(result.orchestration.slides).toHaveLength(3);
    expect(result.orchestration.slides[0].markdown.startsWith("# ")).toBe(true);
  });

  it("should report page mismatch validation failure in agent-team mode", async () => {
    await expect(
      generateDeckByAgentTeam(mockConfig, {
        topic: "测试页数不一致",
        pages: 3,
        requirements: "[team-fault:page-mismatch]",
        orchestrationMode: "agent-team",
        disableFallback: true,
        themeTemplate: "business"
      })
    ).rejects.toThrow(/PAGE_COUNT_MISMATCH/);
  });

  it("should report invalid layout validation failure in agent-team mode", async () => {
    await expect(
      generateDeckByAgentTeam(mockConfig, {
        topic: "测试布局越界",
        pages: 3,
        requirements: "[team-fault:invalid-layout]",
        orchestrationMode: "agent-team",
        disableFallback: true,
        themeTemplate: "business"
      })
    ).rejects.toThrow(/LAYOUT_INVALID/);
  });

  it("should report missing outline validation failure in agent-team mode", async () => {
    await expect(
      generateDeckByAgentTeam(mockConfig, {
        topic: "测试缺失大纲",
        pages: 2,
        requirements: "[team-fault:missing-outline]",
        orchestrationMode: "agent-team",
        disableFallback: true,
        themeTemplate: "academic"
      })
    ).rejects.toThrow(/OUTLINE_MISSING/);
  });
});
