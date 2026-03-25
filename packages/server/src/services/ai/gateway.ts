import type {
  AIConfig,
  DeckThemeTemplate,
  GenerateDeckFromOutlineRequest,
  GenerateDeckRequest,
  GenerateDeckResponse,
  GenerateSlideMarkdownFromOutlineRequest,
  SlideAgentTeamResult,
  SlideAgentTeamSlide,
  SlideAgentTeamValidationIssue,
  SlideBackgroundArtifact,
  SlideCopyArtifact,
  SlideLayoutArtifact,
  SlideLayoutRegion,
  GenerateStructuredOutlineRequest,
  GenerateStructuredOutlineResponse,
  OutlineSlidePlan,
  PolishTextRequest,
  SlideAgentTeamWorkflowEvent,
  SlideAgentTeamWorkflowStage
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

const RICH_MARKDOWN_DIRECTIVES = [
  "图表语法: [图表: 标题; 维度A=120; 维度B=90; 维度C=140]",
  "强调文字颜色语法: [文字颜色:#0b5fff] 这是一句需要强调的文案",
  "定制网页背景语法: 使用 ```background-html``` fenced code block，写可直接渲染的 HTML/CSS"
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

function buildBackgroundArtifactSchema(): Record<string, unknown> {
  return {
    type: "object",
    additionalProperties: false,
    properties: {
      theme: { type: "string" },
      bgColor: {
        type: "string",
        pattern: "^#[0-9a-fA-F]{6}$"
      },
      textColor: {
        type: "string",
        pattern: "^#[0-9a-fA-F]{6}$"
      },
      visualHint: { type: "string" }
    },
    required: ["theme", "bgColor", "textColor", "visualHint"]
  };
}

function buildLayoutArtifactSchema(): Record<string, unknown> {
  return {
    type: "object",
    additionalProperties: false,
    properties: {
      template: { type: "string" },
      regions: {
        type: "array",
        minItems: 3,
        maxItems: 6,
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            id: { type: "string" },
            kind: {
              type: "string",
              enum: ["title", "subtitle", "bullets", "visual", "notes"]
            },
            x: { type: "number", minimum: 0, maximum: 1 },
            y: { type: "number", minimum: 0, maximum: 1 },
            width: { type: "number", minimum: 0.05, maximum: 1 },
            height: { type: "number", minimum: 0.05, maximum: 1 }
          },
          required: ["id", "kind", "x", "y", "width", "height"]
        }
      }
    },
    required: ["template", "regions"]
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

function parseCopyArtifact(text: string, plan: OutlineSlidePlan): SlideCopyArtifact {
  const lines = text
    .split("\n")
    .map((line) => line.trim().replace(/^[-*]\s*/, ""))
    .filter(Boolean);

  const bullets = lines.slice(0, 5);
  while (bullets.length < 2) {
    bullets.push(plan.keyPoints[bullets.length] || `补充要点 ${bullets.length + 1}`);
  }

  return {
    index: plan.index,
    title: plan.title,
    bullets,
    notes: plan.objective
  };
}

function parseBackgroundArtifact(text: string, plan: OutlineSlidePlan, index: number): SlideBackgroundArtifact {
  const fallback: SlideBackgroundArtifact = {
    index: plan.index,
    theme: `theme-${index + 1}`,
    bgColor: normalizeHexColor(undefined, index),
    textColor: "#0f172a",
    visualHint: plan.visualStrategy
  };

  try {
    const parsed = JSON.parse(cleanJsonText(text)) as {
      theme?: string;
      bgColor?: string;
      textColor?: string;
      visualHint?: string;
    };

    return {
      index: plan.index,
      theme: (parsed.theme || fallback.theme).trim(),
      bgColor: normalizeHexColor(parsed.bgColor, index),
      textColor: /^#[0-9a-fA-F]{6}$/.test(parsed.textColor || "") ? (parsed.textColor as string) : fallback.textColor,
      visualHint: (parsed.visualHint || fallback.visualHint).trim()
    };
  } catch {
    return fallback;
  }
}

function fallbackLayoutRegions(): SlideLayoutRegion[] {
  return [
    { id: "title", kind: "title", x: 0.08, y: 0.08, width: 0.84, height: 0.12 },
    { id: "bullets", kind: "bullets", x: 0.08, y: 0.24, width: 0.52, height: 0.64 },
    { id: "visual", kind: "visual", x: 0.64, y: 0.24, width: 0.28, height: 0.52 }
  ];
}

function parseLayoutArtifact(text: string, plan: OutlineSlidePlan): SlideLayoutArtifact {
  const fallback: SlideLayoutArtifact = {
    index: plan.index,
    template: "two-column",
    regions: fallbackLayoutRegions()
  };

  try {
    const parsed = JSON.parse(cleanJsonText(text)) as {
      template?: string;
      regions?: SlideLayoutRegion[];
    };

    if (!Array.isArray(parsed.regions) || !parsed.regions.length) {
      return fallback;
    }

    return {
      index: plan.index,
      template: (parsed.template || fallback.template).trim(),
      regions: parsed.regions
    };
  } catch {
    return fallback;
  }
}

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const clean = hex.replace("#", "");
  const r = Number.parseInt(clean.slice(0, 2), 16);
  const g = Number.parseInt(clean.slice(2, 4), 16);
  const b = Number.parseInt(clean.slice(4, 6), 16);
  return { r, g, b };
}

function relativeLuminance(hex: string): number {
  const { r, g, b } = hexToRgb(hex);
  const transform = (v: number) => {
    const scaled = v / 255;
    return scaled <= 0.03928 ? scaled / 12.92 : Math.pow((scaled + 0.055) / 1.055, 2.4);
  };

  const R = transform(r);
  const G = transform(g);
  const B = transform(b);
  return 0.2126 * R + 0.7152 * G + 0.0722 * B;
}

function contrastRatio(colorA: string, colorB: string): number {
  const l1 = relativeLuminance(colorA);
  const l2 = relativeLuminance(colorB);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

function overlap(a: SlideLayoutRegion, b: SlideLayoutRegion): boolean {
  const ax2 = a.x + a.width;
  const ay2 = a.y + a.height;
  const bx2 = b.x + b.width;
  const by2 = b.y + b.height;
  return a.x < bx2 && ax2 > b.x && a.y < by2 && ay2 > b.y;
}

function buildValidationIssues(input: {
  outline: GenerateStructuredOutlineResponse;
  copies: SlideCopyArtifact[];
  backgrounds: SlideBackgroundArtifact[];
  layouts: SlideLayoutArtifact[];
}): SlideAgentTeamValidationIssue[] {
  const issues: SlideAgentTeamValidationIssue[] = [];

  if (!input.outline.slides.length) {
    issues.push({
      code: "OUTLINE_MISSING",
      stage: "outline",
      message: "Outline stage returned no slides.",
      retryHint: "Regenerate outline with explicit pages and topic."
    });
  }

  const expectedPages = input.outline.slides.length;
  if (input.copies.length !== expectedPages || input.backgrounds.length !== expectedPages || input.layouts.length !== expectedPages) {
    issues.push({
      code: "PAGE_COUNT_MISMATCH",
      stage: "compose",
      message: "Artifact page counts are inconsistent between stages.",
      retryHint: "Retry copy/background/layout generation for missing pages."
    });
  }

  input.copies.forEach((copy) => {
    if (!copy.title.trim() || copy.bullets.length < 2) {
      issues.push({
        code: "COPY_INCOMPLETE",
        stage: "copy",
        slideIndex: copy.index,
        message: `Slide ${copy.index} copy is incomplete.`,
        retryHint: "Ensure each page has title and at least two bullets."
      });
    }
  });

  input.backgrounds.forEach((background) => {
    const ratio = contrastRatio(background.bgColor, background.textColor);
    if (ratio < 3) {
      issues.push({
        code: "BACKGROUND_READABILITY",
        stage: "background",
        slideIndex: background.index,
        message: `Slide ${background.index} contrast ratio (${ratio.toFixed(2)}) is too low.`,
        retryHint: "Use higher-contrast text and background colors."
      });
    }
  });

  input.layouts.forEach((layout) => {
    const invalidBounds = layout.regions.some(
      (region) => region.x < 0 || region.y < 0 || region.width <= 0 || region.height <= 0 || region.x + region.width > 1 || region.y + region.height > 1
    );

    const hasOverlap = layout.regions.some((region, idx) => layout.regions.slice(idx + 1).some((next) => overlap(region, next)));

    if (invalidBounds || hasOverlap) {
      issues.push({
        code: "LAYOUT_INVALID",
        stage: "layout",
        slideIndex: layout.index,
        message: `Slide ${layout.index} layout has invalid bounds or overlapping regions.`,
        retryHint: "Regenerate layout with non-overlapping regions inside 0-1 bounds."
      });
    }
  });

  return issues;
}

function getFaultFlags(requirements?: string): { missingOutline: boolean; pageMismatch: boolean; invalidLayout: boolean } {
  const text = (requirements || "").toLowerCase();
  return {
    missingOutline: text.includes("[team-fault:missing-outline]"),
    pageMismatch: text.includes("[team-fault:page-mismatch]"),
    invalidLayout: text.includes("[team-fault:invalid-layout]")
  };
}

function buildSlideMarkdownFromCopy(copy: SlideCopyArtifact): string {
  const bullets = copy.bullets.map((bullet) => `- ${bullet}`).join("\n");
  return `# ${copy.title}\n\n${bullets}`;
}

class AgentTeamValidationError extends Error {
  readonly issues: SlideAgentTeamValidationIssue[];

  constructor(issues: SlideAgentTeamValidationIssue[]) {
    super(`Agent team validation failed: ${issues.map((item) => item.code).join(", ")}`);
    this.name = "AgentTeamValidationError";
    this.issues = issues;
  }
}

const STAGE_ORDER: SlideAgentTeamWorkflowStage[] = ["outline", "copy", "background", "layout", "compose", "fallback"];

function ensureWorkflowIntegrity(events: SlideAgentTeamWorkflowEvent[]): void {
  let lastOrder = -1;

  for (const event of events) {
    if (event.endedAt < event.startedAt || event.durationMs < 0) {
      throw new Error(`Workflow event has invalid timing for stage: ${event.stage}`);
    }

    const order = STAGE_ORDER.indexOf(event.stage);
    if (order < lastOrder) {
      throw new Error(`Workflow stage order is invalid: ${event.stage}`);
    }

    lastOrder = order;
  }
}

function createWorkflowRecorder() {
  const workflow: SlideAgentTeamWorkflowEvent[] = [];

  const record = (event: SlideAgentTeamWorkflowEvent) => {
    workflow.push(event);
  };

  const runStage = async <T>(stage: SlideAgentTeamWorkflowStage, slideIndexes: number[] | undefined, fn: () => Promise<T>): Promise<T> => {
    const startedAt = Date.now();
    try {
      const result = await fn();
      const endedAt = Date.now();
      record({
        stage,
        status: "succeeded",
        startedAt,
        endedAt,
        durationMs: endedAt - startedAt,
        slideIndexes
      });
      return result;
    } catch (error) {
      const endedAt = Date.now();
      const issue = error instanceof AgentTeamValidationError ? error.issues[0] : undefined;
      record({
        stage,
        status: "failed",
        startedAt,
        endedAt,
        durationMs: endedAt - startedAt,
        slideIndexes,
        issueCode: issue?.code,
        message: issue?.message || (error as Error).message,
        retryHint: issue?.retryHint
      });
      throw error;
    }
  };

  return {
    workflow,
    runStage,
    record
  };
}

export async function generateDeckByAgentTeam(
  config: AIConfig,
  input: GenerateDeckFromOutlineRequest
): Promise<{ outline: GenerateStructuredOutlineResponse; orchestration: SlideAgentTeamResult }> {
  const pages = Math.max(1, Math.min(input.pages || 1, 30));
  const themeTemplate = input.themeTemplate || "business";
  const provider = createProvider(config);
  const faults = getFaultFlags(input.requirements);
  const recorder = createWorkflowRecorder();
  const pageIndexes = Array.from({ length: pages }, (_, idx) => idx + 1);

  const buildFallback = async (
    issues: SlideAgentTeamValidationIssue[]
  ): Promise<{ outline: GenerateStructuredOutlineResponse; orchestration: SlideAgentTeamResult }> => {
    const startedAt = Date.now();
    const outline = await generateStructuredOutline(config, {
      topic: input.topic,
      pages,
      requirements: input.requirements,
      themeTemplate
    });

    const copies = await Promise.all(
      outline.slides.map(async (plan) => {
        const content = await generatePaginatedCopy(config, input.topic, outline.slides.map((item) => item.title).join(" | "), plan.index - 1);
        return parseCopyArtifact(content, plan);
      })
    );

    const backgrounds = outline.slides.map((plan, index) => ({
      index: plan.index,
      theme: `${themeTemplate}-fallback`,
      bgColor: normalizeHexColor(undefined, index),
      textColor: "#0f172a",
      visualHint: plan.visualStrategy
    }));

    const layouts = outline.slides.map((plan) => ({
      index: plan.index,
      template: "two-column",
      regions: fallbackLayoutRegions()
    }));

    const slides: SlideAgentTeamSlide[] = outline.slides.map((plan, index) => ({
      index: plan.index,
      title: plan.title,
      markdown: buildSlideMarkdownFromCopy(copies[index]),
      copy: copies[index],
      background: backgrounds[index],
      layout: layouts[index]
    }));

    const endedAt = Date.now();
    recorder.record({
      stage: "fallback",
      status: "succeeded",
      startedAt,
      endedAt,
      durationMs: endedAt - startedAt,
      slideIndexes: outline.slides.map((item) => item.index),
      issueCode: issues[0]?.code,
      message: issues[0]?.message,
      retryHint: issues[0]?.retryHint
    });

    ensureWorkflowIntegrity(recorder.workflow);

    return {
      outline,
      orchestration: {
        mode: "single-agent",
        fallbackTriggered: true,
        issues,
        slides,
        workflow: recorder.workflow
      }
    };
  };

  try {
    const outline = await recorder.runStage("outline", pageIndexes, async () =>
      generateStructuredOutline(config, {
        topic: input.topic,
        pages,
        requirements: input.requirements,
        themeTemplate
      })
    );

    if (faults.missingOutline) {
      outline.slides = [];
    }

    const copies = await recorder.runStage(
      "copy",
      outline.slides.map((item) => item.index),
      async () =>
        Promise.all(
          outline.slides.map(async (plan) => {
            const content = await generatePaginatedCopy(config, input.topic, outline.slides.map((item) => item.title).join(" | "), plan.index - 1);
            return parseCopyArtifact(content, plan);
          })
        )
    );

    if (faults.pageMismatch && copies.length > 1) {
      copies.pop();
    }

    const backgrounds = await recorder.runStage(
      "background",
      outline.slides.map((item) => item.index),
      async () =>
        Promise.all(
          outline.slides.map(async (plan, index) => {
            const backgroundText = await provider.generate(
              [
                "TEAM_BACKGROUND_JSON",
                "你是PPT背景设计助手，只能输出JSON。",
                `风格模板: ${THEME_PROFILE[themeTemplate]}`,
                `页标题: ${plan.title}`,
                `目标: ${plan.objective}`,
                `视觉策略: ${plan.visualStrategy}`
              ].join("\n"),
              {
                model: config.model,
                temperature: config.temperature ?? 0.5,
                maxTokens: config.maxTokens ?? 600,
                jsonSchema: buildBackgroundArtifactSchema()
              }
            );
            return parseBackgroundArtifact(backgroundText, plan, index);
          })
        )
    );

    const layouts = await recorder.runStage(
      "layout",
      outline.slides.map((item) => item.index),
      async () =>
        Promise.all(
          outline.slides.map(async (plan) => {
            const layoutText = await provider.generate(
              [
                "TEAM_LAYOUT_JSON",
                "你是PPT布局助手，只能输出JSON。",
                `页标题: ${plan.title}`,
                `要点数量: ${Math.max(2, plan.keyPoints.length)}`,
                "坐标使用 0-1 相对值，避免重叠。"
              ].join("\n"),
              {
                model: config.model,
                temperature: config.temperature ?? 0.3,
                maxTokens: config.maxTokens ?? 800,
                jsonSchema: buildLayoutArtifactSchema()
              }
            );
            return parseLayoutArtifact(layoutText, plan);
          })
        )
    );

    if (faults.invalidLayout && layouts[0]) {
      layouts[0] = {
        ...layouts[0],
        regions: [
          { id: "title", kind: "title", x: 0.1, y: 0.1, width: 0.8, height: 0.3 },
          { id: "bullets", kind: "bullets", x: 0.2, y: 0.2, width: 0.8, height: 0.4 }
        ]
      };
    }

    const slides = await recorder.runStage(
      "compose",
      outline.slides.map((item) => item.index),
      async (): Promise<SlideAgentTeamSlide[]> => {
        const issues = buildValidationIssues({ outline, copies, backgrounds, layouts });
        if (issues.length) {
          throw new AgentTeamValidationError(issues);
        }

        return outline.slides.map((plan, index) => ({
          index: plan.index,
          title: plan.title,
          markdown: buildSlideMarkdownFromCopy(copies[index]),
          copy: copies[index],
          background: backgrounds[index],
          layout: layouts[index]
        }));
      }
    );

    ensureWorkflowIntegrity(recorder.workflow);

    return {
      outline,
      orchestration: {
        mode: "agent-team",
        fallbackTriggered: false,
        issues: [],
        slides,
        workflow: recorder.workflow
      }
    };
  } catch (error) {
    if (input.disableFallback) {
      throw error;
    }

    const issues: SlideAgentTeamValidationIssue[] =
      error instanceof AgentTeamValidationError
        ? error.issues
        : [
            {
              code: "OUTLINE_MISSING",
              stage: "outline",
              message: `Agent team failed: ${(error as Error).message}`,
              retryHint: "Retry with clearer topic and page count."
            }
          ];

    return buildFallback(issues);
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
      `可选增强语法:\n${RICH_MARKDOWN_DIRECTIVES}`,
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
8. 图表请使用语法：[图表: 标题; 维度A=120; 维度B=90]
9. 强调文字颜色请使用语法：[文字颜色:#0b5fff] 文案
10. 网页背景请使用 fenced code（三个反引号 + background-html）并在代码块中写HTML
11. 要求内容清晰、层级分明、易于转换为演示幻灯片
12. 每个模块应该能独立成为一张或多张幻灯片`;

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
      "4) 如需图表，使用 [图表: 标题; 指标A=120; 指标B=90]",
      "5) 如需彩色强调文字，使用 [文字颜色:#0b5fff] 文案",
      "6) 如需网页背景，请用 ```background-html``` 代码块输出背景HTML",
      "7) 不要使用代码块包裹整页Markdown（背景HTML代码块除外）"
    ].join("\n");

    const text = await provider.generate(prompt, {
      model: config.model,
      temperature: config.temperature ?? 0.6,
      maxTokens: config.maxTokens ?? 1200
    });

    return text.trim();
  });
}
