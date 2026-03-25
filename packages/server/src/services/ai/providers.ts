import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";

export interface AIProviderGenerateOptions {
  model?: string;
  temperature?: number;
  maxTokens?: number;
  jsonSchema?: Record<string, unknown>;
}

export interface AIProvider {
  generate(prompt: string, options?: AIProviderGenerateOptions): Promise<string>;
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
          const typed = item as { type?: string; text?: unknown };
          if (typed.type === "text") {
            if (typeof typed.text === "string") {
              return typed.text;
            }

            if (typed.text && typeof typed.text === "object") {
              const nested = typed.text as { value?: string };
              if (typeof nested.value === "string") {
                return nested.value;
              }
            }
          }

          if (typeof typed.text === "string") {
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

function collectReadableText(value: unknown): string[] {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed ? [trimmed] : [];
  }

  if (Array.isArray(value)) {
    return value.flatMap((item) => collectReadableText(item));
  }

  if (!value || typeof value !== "object") {
    return [];
  }

  const typed = value as {
    text?: unknown;
    output_text?: unknown;
    completion?: unknown;
    content?: unknown;
    message?: { content?: unknown };
    delta?: { text?: unknown };
    value?: unknown;
  };

  const chunks: string[] = [];

  if (typeof typed.text === "string") {
    chunks.push(typed.text);
  }

  if (typeof typed.output_text === "string") {
    chunks.push(typed.output_text);
  }

  if (typeof typed.completion === "string") {
    chunks.push(typed.completion);
  }

  if (typeof typed.delta?.text === "string") {
    chunks.push(typed.delta.text);
  }

  if (typeof typed.value === "string") {
    chunks.push(typed.value);
  }

  if (typed.text && typeof typed.text === "object") {
    chunks.push(...collectReadableText(typed.text));
  }

  if (typed.content !== undefined) {
    chunks.push(...collectReadableText(typed.content));
  }

  if (typed.message?.content !== undefined) {
    chunks.push(...collectReadableText(typed.message.content));
  }

  return chunks.map((chunk) => chunk.trim()).filter(Boolean);
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

function extractAnthropicResponseText(response: unknown): string {
  if (!response || typeof response !== "object") {
    return "";
  }

  const typed = response as {
    completion?: string;
    content?: unknown;
    output_text?: string;
    choices?: Array<{ message?: { content?: unknown } }>;
  };

  if (typeof typed.completion === "string" && typed.completion.trim()) {
    return typed.completion.trim();
  }

  if (typeof typed.output_text === "string" && typed.output_text.trim()) {
    return typed.output_text.trim();
  }

  if (typeof typed.content === "string" && typed.content.trim()) {
    return typed.content.trim();
  }

  if (Array.isArray(typed.content)) {
    const text = typed.content
      .map((block) => {
        if (typeof block === "string") {
          return block;
        }

        if (block && typeof block === "object") {
          const typedBlock = block as { type?: string; text?: string };
          if (
            (typedBlock.type === "text" || typedBlock.type === "output_text") &&
            typeof typedBlock.text === "string"
          ) {
            return typedBlock.text;
          }
        }

        return "";
      })
      .filter(Boolean)
      .join("\n")
      .trim();

    if (text) {
      return text;
    }
  }

  const recursiveText = collectReadableText(response).join("\n").trim();
  if (recursiveText) {
    return recursiveText;
  }

  return normalizeOpenAIContent(typed.choices?.[0]?.message?.content).trim();
}

export class OpenAIProvider implements AIProvider {
  private client: OpenAI;

  constructor(apiKey: string, private endpoint?: string) {
    this.client = new OpenAI({ apiKey, baseURL: endpoint });
  }

  async generate(prompt: string, options?: AIProviderGenerateOptions): Promise<string> {
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

  async generate(prompt: string, options?: AIProviderGenerateOptions): Promise<string> {
    // Use Anthropic Messages API shape from official docs.
    const request = {
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
      ],
      ...(options?.jsonSchema
        ? {
            output_config: {
              format: {
                type: "json_schema",
                schema: options.jsonSchema
              }
            }
          }
        : {})
    } as unknown as Parameters<Anthropic["messages"]["create"]>[0];

    const completion = await this.client.messages.create(request);

    const text = extractAnthropicResponseText(completion);
    if (text) {
      return text;
    }

    throw new Error("Anthropic response contained no readable text content");
  }
}

export class MockProvider implements AIProvider {
  async generate(prompt: string): Promise<string> {
    if (prompt.includes("STRUCTURED_OUTLINE_JSON")) {
      return JSON.stringify({
        topic: "AI Draft Topic",
        slides: [
          {
            index: 1,
            title: "背景与目标",
            objective: "说明议题背景并明确目标",
            keyPoints: ["行业背景", "痛点定义", "目标范围"],
            visualStrategy: "时间线 + 图标"
          },
          {
            index: 2,
            title: "方案路径",
            objective: "给出可执行路径",
            keyPoints: ["关键动作", "里程碑", "风险控制"],
            visualStrategy: "流程图"
          },
          {
            index: 3,
            title: "结果与行动",
            objective: "总结收益与下一步",
            keyPoints: ["预期收益", "资源需求", "下一步计划"],
            visualStrategy: "对比卡片"
          }
        ]
      });
    }

    if (prompt.includes("SLIDE_MARKDOWN_FROM_OUTLINE")) {
      const titleMatch = prompt.match(/页标题:\s*(.+)/);
      const title = titleMatch?.[1]?.trim() || "AI Slide";
      return `# ${title}\n\n- 关键要点一\n- 关键要点二\n- 关键要点三`;
    }

    if (prompt.includes("TEAM_BACKGROUND_JSON")) {
      return JSON.stringify({
        theme: "business-clean",
        bgColor: "#F8FAFC",
        textColor: "#0F172A",
        visualHint: "Subtle gradient with clean geometric shape"
      });
    }

    if (prompt.includes("TEAM_LAYOUT_JSON")) {
      return JSON.stringify({
        template: "title-left-two-column",
        regions: [
          { id: "title", kind: "title", x: 0.08, y: 0.08, width: 0.84, height: 0.12 },
          { id: "bullets", kind: "bullets", x: 0.08, y: 0.24, width: 0.52, height: 0.62 },
          { id: "visual", kind: "visual", x: 0.64, y: 0.24, width: 0.28, height: 0.52 }
        ]
      });
    }

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

    if (prompt.includes("PPT单页改写助手")) {
      return [
        "# 优化后的关键结论",
        "",
        "- 用更清晰的结构表达核心观点",
        "- 用一组关键数据支撑结论",
        "- 明确下一步行动和负责人",
        "",
        "[图片建议: 一张与主题相关的横版配图]"
      ].join("\n");
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
