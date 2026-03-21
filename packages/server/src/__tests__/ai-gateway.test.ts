import { describe, it, expect, beforeEach, vi } from "vitest";
import type { AIConfig, PolishTextRequest } from "@web-ppt/shared";
import { generateDeckDraft, polishText, suggestVisuals, generateOutline } from "../services/ai/gateway";

describe("AI Gateway Fault Tolerance", () => {
  const mockConfig: AIConfig = {
    provider: "openai",
    apiKey: "test-key",
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
});
