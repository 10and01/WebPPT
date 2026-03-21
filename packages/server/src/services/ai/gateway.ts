import type { AIConfig, GenerateDeckRequest, GenerateDeckResponse, PolishTextRequest } from "@web-ppt/shared";
import { AnthropicProvider, MockProvider, OpenAIProvider, type AIProvider } from "./providers";

const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 1000;

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
      "你是PPT策划助手。",
      `主题: ${input.topic}`,
      `页数: ${input.slides}`,
      "输出每页标题和3条要点，使用换行分隔。"
    ].join("\n");

    const text = await provider.generate(prompt, {
      model: config.model,
      temperature: config.temperature ?? 0.7,
      maxTokens: config.maxTokens ?? 800
    });

    const lines = text
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .slice(0, input.slides);

    const slideDrafts = lines.map((line, index) => ({
      title: line.replace(/^\d+\.\s*/, "") || `Slide ${index + 1}`,
      bullets: ["要点A", "要点B", "要点C"],
      visualHint: "Use clean icon + short chart"
    }));

    return {
      title: `${input.topic} - AI Draft`,
      slideDrafts
    };
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
