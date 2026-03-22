import type {
  AIConfig,
  DeckThemeTemplate,
  GenerateDeckRequest,
  GenerateDeckResponse,
  GenerateSlideMarkdownFromOutlineRequest,
  GenerateStructuredOutlineRequest,
  GenerateStructuredOutlineResponse,
  OutlineSlidePlan,
  PolishTextRequest
} from "@web-ppt/shared";
import { AnthropicProvider, MockProvider, OpenAIProvider, type AIProvider } from "./providers";

const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 1000;

const DEFAULT_BG_COLORS = ["#F8FAFC", "#EFF6FF", "#ECFDF5", "#FFFBEB", "#FEF2F2", "#F5F3FF"];

const THEME_PROFILE: Record<DeckThemeTemplate, string> = {
  business: "商务风: 专业、简洁、强调结论与数据可信度。",
  academic: "学术风: 术语准确、论证清晰、偏中性表达。",
  "product-launch": "产品发布风: 叙事感更强、价值主张明确、节奏偏短句。"
};

const SLIDE_LAYOUT_GOVERNANCE = [
  "每页标题 1 行，正文总字数建议 60-140 汉字（或等量英文）。",
  "每页 3-5 条要点；单条要点尽量 <= 24 汉字（或 <= 16 英文词）。",
  "当要点超过 5 条，必须拆成下一页，不得堆叠成长文。",
  "只有在信息密度高或需要对比时使用表格。",
  "图片策略: 仅在能增强理解时添加 [图片建议: ...]，否则不强行配图。",
  "如内容跨层级，优先拆页而不是在一页放多段长段落。"
].join("\n");

function normalizeHexColor(value: string | undefined, index: number): string {
  const fallback = DEFAULT_BG_COLORS[index % DEFAULT_BG_COLORS.length];
  if (!value) {
    return fallback;
  }

  const normalized = value.trim();
  if (/^#[0-9a-fA-F]{6}$/.test(normalized)) {
    return normalized;
  }

  return fallback;
}

function cleanJsonText(text: string): string {
  const trimmed = text.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  if (fenced && fenced[1]) {
    return fenced[1].trim();
  }
  return trimmed;
}

function parseStructuredDraft(text: string, slides: number, topic: string): GenerateDeckResponse {
  const fallback: GenerateDeckResponse = {
    title: `${topic} - AI Draft`,
    slideDrafts: Array.from({ length: slides }, (_, index) => ({
      title: `Slide ${index + 1}`,
      bullets: ["要点A", "要点B", "要点C"],
      markdown: `# Slide ${index + 1}\n\n- 要点A\n- 要点B\n- 要点C`,
      bgColor: normalizeHexColor(undefined, index),
      visualHint: "Use clean icon + short chart"
    }))
  };

  try {
    const parsed = JSON.parse(cleanJsonText(text)) as {
      title?: string;
      slideDrafts?: Array<{
        title?: string;
        bullets?: string[];
        markdown?: string;
        bgColor?: string;
        visualHint?: string;
      }>;
    };

    if (!Array.isArray(parsed.slideDrafts) || parsed.slideDrafts.length === 0) {
      return fallback;
    }

    const normalizedDrafts = parsed.slideDrafts.slice(0, slides).map((item, index) => {
      const bullets = Array.isArray(item.bullets) && item.bullets.length
        ? item.bullets.slice(0, 5).map((bullet) => String(bullet).trim()).filter(Boolean)
        : ["要点A", "要点B", "要点C"];

      const markdown =
        typeof item.markdown === "string" && item.markdown.trim()
          ? item.markdown.trim()
          : `# ${item.title || `Slide ${index + 1}`}\n\n${bullets.map((bullet) => `- ${bullet}`).join("\n")}`;

      return {
        title: (item.title || `Slide ${index + 1}`).trim(),
        bullets,
        markdown,
        bgColor: normalizeHexColor(item.bgColor, index),
        visualHint: (item.visualHint || "Use clean icon + short chart").trim()
      };
    });

    while (normalizedDrafts.length < slides) {
      const index = normalizedDrafts.length;
      normalizedDrafts.push({
        title: `Slide ${index + 1}`,
        bullets: ["要点A", "要点B", "要点C"],
        markdown: `# Slide ${index + 1}\n\n- 要点A\n- 要点B\n- 要点C`,
        bgColor: normalizeHexColor(undefined, index),
        visualHint: "Use clean icon + short chart"
      });
    }

    return {
      title: (parsed.title || `${topic} - AI Draft`).trim(),
      slideDrafts: normalizedDrafts
    };
  } catch {
    return fallback;
  }
}

function createProvider(config: AIConfig): AIProvider {
  if (config.provider === "openai" && config.apiKey) {
    return new OpenAIProvider(config.apiKey, config.apiEndpoint);
  }

  if (config.provider === "anthropic" && config.apiKey) {
    return new AnthropicProvider(config.apiKey, config.apiEndpoint);
  }

  return new MockProvider();
}

function buildDeckDraftJsonSchema(slides: number): Record<string, unknown> {
  return {
    type: "object",
    additionalProperties: false,
    properties: {
      title: { type: "string" },
      slideDrafts: {
        type: "array",
        minItems: slides,
        maxItems: slides,
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            title: { type: "string" },
            bullets: {
              type: "array",
              minItems: 3,
              maxItems: 5,
              items: { type: "string" }
            },
            markdown: { type: "string" },
            bgColor: {
              type: "string",
              pattern: "^#[0-9a-fA-F]{6}$"
            },
            visualHint: { type: "string" }
          },
          required: ["title", "bullets", "markdown", "bgColor", "visualHint"]
        }
      }
    },
    required: ["title", "slideDrafts"]
  };
}

function buildStructuredOutlineSchema(slides: number): Record<string, unknown> {
  return {
    type: "object",
    additionalProperties: false,
    properties: {
      topic: { type: "string" },
      slides: {
        type: "array",
        minItems: slides,
        maxItems: slides,
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            index: { type: "integer", minimum: 1 },
            title: { type: "string" },
            objective: { type: "string" },
            keyPoints: {
              type: "array",
              minItems: 3,
              maxItems: 5,
              items: { type: "string" }
            },
            visualStrategy: { type: "string" }
          },
          required: ["index", "title", "objective", "keyPoints", "visualStrategy"]
        }
      }
    },
    required: ["topic", "slides"]
  };
}

function parseStructuredOutline(
  text: string,
  topic: string,
  pages: number,
  themeTemplate: DeckThemeTemplate
): GenerateStructuredOutlineResponse {
  const fallbackSlides: OutlineSlidePlan[] = Array.from({ length: pages }, (_, i) => ({
    index: i + 1,
    title: `第${i + 1}页`,
    objective: `围绕${topic}展开第${i + 1}页核心观点`,
    keyPoints: ["关键点A", "关键点B", "关键点C"],
    visualStrategy: "图标 + 两列要点"
  }));

  try {
    const parsed = JSON.parse(cleanJsonText(text)) as {
      topic?: string;
      slides?: OutlineSlidePlan[];
    };

    if (!Array.isArray(parsed.slides) || parsed.slides.length === 0) {
      return { topic, themeTemplate, slides: fallbackSlides };
    }

    const slides = parsed.slides.slice(0, pages).map((slide, idx) => ({
      index: Number(slide.index) || idx + 1,
      title: (slide.title || `第${idx + 1}页`).trim(),
      objective: (slide.objective || `围绕${topic}展开第${idx + 1}页核心观点`).trim(),
      keyPoints:
        Array.isArray(slide.keyPoints) && slide.keyPoints.length
          ? slide.keyPoints.slice(0, 5).map((item) => String(item).trim()).filter(Boolean)
          : ["关键点A", "关键点B", "关键点C"],
      visualStrategy: (slide.visualStrategy || "图标 + 两列要点").trim()
    }));

    while (slides.length < pages) {
      const idx = slides.length;
      slides.push(fallbackSlides[idx]);
    }

    return {
      topic: (parsed.topic || topic).trim(),
      themeTemplate,
      slides
    };
  } catch {
    return { topic, themeTemplate, slides: fallbackSlides };
  }
}

async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  maxRetries: number = MAX_RETRIES,
  delayMs: number = RETRY_DELAY_MS
): Promise<T> {
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error as Error;

      if (attempt < maxRetries) {
        const backoffDelay = delayMs * Math.pow(2, attempt);
        await new Promise((resolve) => setTimeout(resolve, backoffDelay));
      }
    }
  }

  throw lastError || new Error("Max retries exceeded");
}

export async function generateDeckDraft(config: AIConfig, input: GenerateDeckRequest): Promise<GenerateDeckResponse> {
  const provider = createProvider(config);

  return retryWithBackoff(async () => {
    const prompt = [
      "你是PPT策划与版式助手。",
      `主题: ${input.topic}`,
      `页数: ${input.slides}`,
      "请基于主题生成可直接用于演示文稿的结构化内容。",
      "要求:",
      "1) 每页包含3到5条可展示要点。",
      "2) markdown与title/bullets语义一致。",
      "3) bgColor使用浅色并保证可读性。"
    ].join("\n");

    let text = "";

    try {
      text = await provider.generate(prompt, {
        model: config.model,
        temperature: config.temperature ?? 0.7,
        maxTokens: config.maxTokens ?? 800,
        jsonSchema: buildDeckDraftJsonSchema(input.slides)
      });
    } catch (error) {
      // Fallback for Anthropic-compatible endpoints that do not support output_config yet.
      if (config.provider !== "anthropic") {
        throw error;
      }

      text = await provider.generate(
        [
          prompt,
          "请严格输出JSON对象，不要输出额外说明，不要使用Markdown代码块。",
          "必须返回字段: title, slideDrafts[].title, slideDrafts[].bullets, slideDrafts[].markdown, slideDrafts[].bgColor, slideDrafts[].visualHint"
        ].join("\n"),
        {
          model: config.model,
          temperature: config.temperature ?? 0.7,
          maxTokens: config.maxTokens ?? 800
        }
      );
    }

    return parseStructuredDraft(text, input.slides, input.topic);
  });
}

export async function testAIConnection(config: AIConfig): Promise<{ ok: true; provider: string; model: string }> {
  if (!config.apiKey?.trim()) {
    throw new Error("API Key is required");
  }

  if (config.provider !== "openai" && config.provider !== "anthropic") {
    throw new Error(`Unsupported provider for connection test: ${config.provider}`);
  }

  const provider = createProvider(config);
  const text = await provider.generate("Reply with OK", {
    model: config.model,
    temperature: 0,
    maxTokens: 32
  });

  if (!text.trim()) {
    throw new Error("Provider returned empty response");
  }

  return {
    ok: true,
    provider: config.provider,
    model:
      config.model || (config.provider === "anthropic" ? "claude-3-5-haiku-20241022" : "gpt-4o-mini")
  };
}

export async function polishText(config: AIConfig, input: PolishTextRequest): Promise<string> {
  const provider = createProvider(config);

  return retryWithBackoff(async () => {
    const modePrompts: Record<string, string> = {
      shorten: "请精简文本，保持核心信息。",
      expand: "请扩展文本，添加细节和示例。",
      professional: "请将文本改写为更正式专业的语气。"
    };

    const prompt = [
      "你是文案润色助手。",
      modePrompts[input.mode] || "请润色文本。",
      "请只返回润色后的文本。",
      input.text
    ].join("\n");

    const text = await provider.generate(prompt, {
      model: config.model,
      temperature: 0.4,
      maxTokens: 500
    });

    return text.trim() || input.text;
  });
}

export async function suggestVisuals(config: AIConfig, text: string): Promise<string[]> {
  const provider = createProvider(config);

  return retryWithBackoff(async () => {
    const prompt = [
      "VISUAL_JSON",
      "你是视觉建议助手，返回JSON数组，每项包含type和hint。",
      text
    ].join("\n");

    const result = await provider.generate(prompt, {
      model: config.model,
      temperature: 0.7,
      maxTokens: 500
    });

    try {
      const parsed = JSON.parse(result);
      if (Array.isArray(parsed)) {
        return parsed.map((item: any) => item.hint || "Use a relevant visual");
      }
    } catch {
      // Fall back to mock if parsing fails
    }

    return ["Use a relevant visual element", "Consider adding a diagram or chart"];
  });
}

export async function generateOutline(config: AIConfig, topic: string, pages: number): Promise<string[]> {
  const provider = createProvider(config);

  return retryWithBackoff(async () => {
    const prompt = [
      "你是内容大纲生成助手。",
      `主题: ${topic}`,
      `页数: ${pages}`,
      "为每一页生成一个简洁的标题，用换行分隔。"
    ].join("\n");

    const text = await provider.generate(prompt, {
      model: config.model,
      temperature: config.temperature ?? 0.6,
      maxTokens: config.maxTokens ?? 600
    });

    return text
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .slice(0, pages);
  });
}

export async function generateStructuredOutline(
  config: AIConfig,
  input: GenerateStructuredOutlineRequest
): Promise<GenerateStructuredOutlineResponse> {
  const provider = createProvider(config);
  const pages = Math.max(1, Math.min(input.pages || 1, 30));
  const themeTemplate = input.themeTemplate || "business";

  return retryWithBackoff(async () => {
    const prompt = [
      "STRUCTURED_OUTLINE_JSON",
      "你是演示文稿结构规划助手，只能输出 JSON。",
      `主题: ${input.topic}`,
      `页数: ${pages}`,
      `风格模板: ${THEME_PROFILE[themeTemplate]}`,
      `补充要求: ${(input.requirements || "无").trim()}`,
      "请先给出逐页结构化大纲，不输出 markdown。",
      "必须遵循以下版式治理规则:",
      SLIDE_LAYOUT_GOVERNANCE
    ].join("\n");

    const text = await provider.generate(prompt, {
      model: config.model,
      temperature: config.temperature ?? 0.4,
      maxTokens: config.maxTokens ?? 2000,
      jsonSchema: buildStructuredOutlineSchema(pages)
    });

    return parseStructuredOutline(text, input.topic, pages, themeTemplate);
  });
}

export async function generateSlideMarkdownFromOutline(
  config: AIConfig,
  input: GenerateSlideMarkdownFromOutlineRequest
): Promise<string> {
  const provider = createProvider(config);
  const themeTemplate = input.themeTemplate || "business";

  return retryWithBackoff(async () => {
    const prompt = [
      "SLIDE_MARKDOWN_FROM_OUTLINE",
      "你是单页PPT markdown生成助手。",
      `主题: ${input.topic}`,
      `风格模板: ${THEME_PROFILE[themeTemplate]}`,
      `页码: ${input.plan.index}`,
      `页标题: ${input.plan.title}`,
      `本页目标: ${input.plan.objective}`,
      `要点: ${input.plan.keyPoints.join("；")}`,
      `视觉策略: ${input.plan.visualStrategy}`,
      "仅输出一页 Markdown，不要输出解释。",
      "第一行必须是 # 标题。",
      "正文优先列表结构，每页 3-5 要点。",
      "如需图片，在末尾加一行 [图片建议: ...]。",
      "必须遵循以下版式治理规则:",
      SLIDE_LAYOUT_GOVERNANCE
    ].join("\n");

    const text = await provider.generate(prompt, {
      model: config.model,
      temperature: config.temperature ?? 0.6,
      maxTokens: config.maxTokens ?? 1000
    });

    return text.trim();
  });
}

export async function generatePaginatedCopy(
  config: AIConfig,
  topic: string,
  outline: string,
  slideIndex: number
): Promise<string> {
  const provider = createProvider(config);

  return retryWithBackoff(async () => {
    const prompt = [
      "你是PPT文案生成助手。",
      `主题: ${topic}`,
      `大纲: ${outline}`,
      `当前页索引: ${slideIndex}`,
      "为当前页生成3-5条要点，每行一条。"
    ].join("\n");

    const text = await provider.generate(prompt, {
      model: config.model,
      temperature: config.temperature ?? 0.7,
      maxTokens: 300
    });

    return text.trim();
  });
}

export async function generateRichMarkdown(
  config: AIConfig,
  topic: string,
  requirements: string
): Promise<string> {
  const provider = createProvider(config);

  return retryWithBackoff(async () => {
    const markdownRules = `
## Markdown 生成规则 ##
1. 用 # 开头的标题（主标题和模块标题）
2. 用 ## 或 ### 创建副标题和子章节
3. 用 - 或 * 创建列表项
4. 用 | 创建表格（如需要）
5. 用 > 创建引用块（强调重要信息）
6. 用 **粗体** 或 *斜体* 强调文本
7. 用 ### 卡片标题 来组织相关内容
8. 图表/流程图用描述性语言说明，如"[流程图：A → B → C]"
9. 要求内容清晰、层级分明、易于转换为演示幻灯片
10. 每个模块应该能独立成为一张或多张幻灯片`;

    const prompt = [
      "你是专业的内容策划助手，擅长生成结构化的Markdown文档。",
      `主题: ${topic}`,
      `具体要求: ${requirements}`,
      markdownRules,
      "",
      "请生成完整的Markdown文档，包含清晰的结构和内容层级。"
    ].join("\n");

    const text = await provider.generate(prompt, {
      model: config.model,
      temperature: config.temperature ?? 0.7,
      maxTokens: config.maxTokens ?? 3000
    });

    return text.trim();
  });
}

export async function rewriteSlideMarkdown(
  config: AIConfig,
  input: { topic: string; currentMarkdown: string; instruction: string }
): Promise<string> {
  const provider = createProvider(config);

  return retryWithBackoff(async () => {
    const prompt = [
      "你是PPT单页改写助手。",
      `主题: ${input.topic}`,
      `用户修改要求: ${input.instruction}`,
      "当前单页Markdown如下：",
      input.currentMarkdown,
      "",
      "请仅输出一页可导入的Markdown，不要输出解释。",
      "输出要求:",
      "1) 第一行必须是 # 标题",
      "2) 正文使用段落和列表组织",
      "3) 如果用户要求添加图片，请在末尾增加一行 [图片建议: xxx]",
      "4) 不要使用代码块包裹Markdown"
    ].join("\n");

    const text = await provider.generate(prompt, {
      model: config.model,
      temperature: config.temperature ?? 0.6,
      maxTokens: config.maxTokens ?? 1200
    });

    return text.trim();
  });
}
