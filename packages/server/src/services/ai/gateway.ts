import type { AIConfig, GenerateDeckRequest, GenerateDeckResponse, PolishTextRequest } from "@web-ppt/shared";
import { AnthropicProvider, MockProvider, OpenAIProvider, type AIProvider } from "./providers";

const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 1000;

const DEFAULT_BG_COLORS = ["#F8FAFC", "#EFF6FF", "#ECFDF5", "#FFFBEB", "#FEF2F2", "#F5F3FF"];

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
      "请严格输出JSON对象，不要输出额外说明，不要使用Markdown代码块。",
      "JSON结构:",
      "{",
      '  "title": "整套PPT标题",',
      '  "slideDrafts": [',
      "    {",
      '      "title": "单页标题",',
      '      "bullets": ["要点1", "要点2", "要点3"],',
      '      "markdown": "# 单页标题\\n\\n- 要点1\\n- 要点2\\n- 要点3",',
      '      "bgColor": "#RRGGBB",',
      '      "visualHint": "视觉建议"',
      "    }",
      "  ]",
      "}",
      "规则:",
      "1) slideDrafts数量必须等于页数。",
      "2) bullets每页3到5条，简短可展示。",
      "3) markdown必须与title/bullets语义一致。",
      "4) bgColor必须是浅色、可读性高的#RRGGBB。",
      "5) 禁止输出任何JSON以外文本。"
    ].join("\n");

    const text = await provider.generate(prompt, {
      model: config.model,
      temperature: config.temperature ?? 0.7,
      maxTokens: config.maxTokens ?? 800
    });

    return parseStructuredDraft(text, input.slides, input.topic);
  });
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
