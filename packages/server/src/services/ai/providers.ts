import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";

export interface AIProvider {
  generate(prompt: string, options?: { model?: string; temperature?: number; maxTokens?: number }): Promise<string>;
}

function normalizeOpenAIContent(content: unknown): string {
  if (typeof content === "string") {
    return content;
  }

  if (Array.isArray(content)) {
    return content
      .map((item) => {
        if (typeof item === "string") {
          return item;
        }

        if (item && typeof item === "object") {
          const typed = item as { type?: string; text?: string };
          if (typed.type === "text" && typeof typed.text === "string") {
            return typed.text;
          }
        }

        return "";
      })
      .filter(Boolean)
      .join("\n");
  }

  return "";
}

function extractOpenAIResponseText(response: unknown): string {
  if (!response || typeof response !== "object") {
    return "";
  }

  const typed = response as {
    output_text?: string;
    output?: Array<{
      type?: string;
      content?: Array<{ type?: string; text?: string }>;
    }>;
  };

  if (typeof typed.output_text === "string" && typed.output_text.trim()) {
    return typed.output_text.trim();
  }

  if (!Array.isArray(typed.output)) {
    return "";
  }

  return typed.output
    .flatMap((item) => (Array.isArray(item.content) ? item.content : []))
    .map((block) => (block.type === "output_text" && typeof block.text === "string" ? block.text : ""))
    .filter(Boolean)
    .join("\n")
    .trim();
}

export class OpenAIProvider implements AIProvider {
  private client: OpenAI;

  constructor(apiKey: string, private endpoint?: string) {
    this.client = new OpenAI({ apiKey, baseURL: endpoint });
  }

  async generate(
    prompt: string,
    options?: { model?: string; temperature?: number; maxTokens?: number }
  ): Promise<string> {
    // Use OpenAI Responses API shape from official docs.
    const response = await this.client.responses.create({
      model: options?.model ?? "gpt-4o-mini",
      temperature: options?.temperature ?? 0.7,
      max_output_tokens: options?.maxTokens ?? 800,
      input: [
        {
          role: "user",
          content: [
            {
              type: "input_text",
              text: prompt
            }
          ]
        }
      ]
    });

    const fromResponses = extractOpenAIResponseText(response);
    if (fromResponses) {
      return fromResponses;
    }

    // Fallback for compatibility with proxy providers returning chat-like payloads.
    return normalizeOpenAIContent((response as unknown as { choices?: Array<{ message?: { content?: unknown } }> })?.choices?.[0]?.message?.content);
  }
}

export class AnthropicProvider implements AIProvider {
  private client: Anthropic;

  constructor(apiKey: string, endpoint?: string) {
    this.client = new Anthropic({ apiKey, baseURL: endpoint });
  }

  async generate(
    prompt: string,
    options?: { model?: string; temperature?: number; maxTokens?: number }
  ): Promise<string> {
    // Use Anthropic Messages API shape from official docs.
    const completion = await this.client.messages.create({
      model: options?.model ?? "claude-3-5-haiku-20241022",
      max_tokens: options?.maxTokens ?? 800,
      temperature: options?.temperature ?? 0.7,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: prompt
            }
          ]
        }
      ]
    });

    return completion.content
      .map((block) => (block.type === "text" ? block.text : ""))
      .filter(Boolean)
      .join("\n")
      .trim();
  }
}

export class MockProvider implements AIProvider {
  async generate(prompt: string): Promise<string> {
    if (prompt.includes("VISUAL_JSON")) {
      return JSON.stringify([
        { type: "bar-chart", hint: "Use a 5-year trend chart", color: "blue" },
        { type: "image", hint: "Use a high-contrast business photo", color: "teal" }
      ]);
    }

    if (prompt.includes('"slideDrafts"')) {
      return JSON.stringify({
        title: "AI Draft Presentation",
        slideDrafts: [
          {
            title: "现状与挑战",
            bullets: ["行业环境变化快", "成本与效率双重压力", "组织协同存在断点"],
            markdown: "# 现状与挑战\n\n- 行业环境变化快\n- 成本与效率双重压力\n- 组织协同存在断点",
            bgColor: "#F8FAFC",
            visualHint: "Use clean icon + short chart"
          },
          {
            title: "商业模式路径",
            bullets: ["价值主张重塑", "关键资源匹配", "盈利模型分层"],
            markdown: "# 商业模式路径\n\n- 价值主张重塑\n- 关键资源匹配\n- 盈利模型分层",
            bgColor: "#EFF6FF",
            visualHint: "Use clean icon + short chart"
          },
          {
            title: "关键数据与指标",
            bullets: ["收入增长率", "获客成本", "用户留存率"],
            markdown: "# 关键数据与指标\n\n- 收入增长率\n- 获客成本\n- 用户留存率",
            bgColor: "#ECFDF5",
            visualHint: "Use clean icon + short chart"
          },
          {
            title: "落地计划",
            bullets: ["30天快速试点", "90天流程固化", "年度规模化推广"],
            markdown: "# 落地计划\n\n- 30天快速试点\n- 90天流程固化\n- 年度规模化推广",
            bgColor: "#FFFBEB",
            visualHint: "Use clean icon + short chart"
          },
          {
            title: "风险与对策",
            bullets: ["资源不足风险", "执行偏差风险", "建立周度复盘机制"],
            markdown: "# 风险与对策\n\n- 资源不足风险\n- 执行偏差风险\n- 建立周度复盘机制",
            bgColor: "#FEF2F2",
            visualHint: "Use clean icon + short chart"
          }
        ]
      });
    }

    return [
      "1. 现状与挑战",
      "2. 商业模式路径",
      "3. 关键数据与指标",
      "4. 落地计划",
      "5. 风险与对策"
    ].join("\n");
  }
}
