import type { FastifyInstance } from "fastify";
import { nanoid } from "nanoid";
import type {
  AISlideEditRequest,
  AIToolPolicy,
  AIConfig,
  ElementModel,
  GenerateDeckFromOutlineRequest,
  GenerateDeckRequest,
  ImportMarkdownRequest,
  PolishTextRequest,
  Slide,
  DeckThemeTemplate
} from "@web-ppt/shared";
import { deckStore } from "../data/deck-store";
import {
  generateDeckByAgentTeam,
  generateDeckDraft,
  generateSlideMarkdownFromOutline,
  generateStructuredOutline,
  rewriteSlideMarkdown,
  generateRichMarkdown,
  polishText,
  suggestVisuals,
  generateOutline,
  generatePaginatedCopy,
  testAIConnection
} from "../services/ai/gateway";
import {
  appendSlideMarkdown,
  overwriteSlideMarkdownBySlideId,
  readSlideMarkdownBySlideId
} from "../services/markdown/page-tools";

const DEFAULT_SLIDE_BG = "#ffffff";
const BEAUTIFIED_BG = "#eef6ff";

function extractBackgroundHtml(markdown: string): string | undefined {
  const fenced = markdown.match(/```(?:background-html|bg-html|slide-bg-html)\s*([\s\S]*?)```/i);
  if (!fenced?.[1]) {
    return undefined;
  }

  const html = fenced[1].trim();
  return html || undefined;
}

function normalizeToolPolicy(input?: AIToolPolicy): AIToolPolicy {
  const defaults: AIToolPolicy = {
    allowedTools: ["generate-outline", "read-slide-markdown", "overwrite-slide-markdown", "append-slide-markdown"]
  };

  if (!input?.allowedTools?.length) {
    return defaults;
  }

  return {
    allowedTools: input.allowedTools
  };
}

function shouldUseAgentTeamMode(input: GenerateDeckFromOutlineRequest): boolean {
  if (input.orchestrationMode === "agent-team") {
    return true;
  }

  if (input.orchestrationMode === "single-agent") {
    return false;
  }

  const source = `${input.topic || ""} ${input.requirements || ""}`.toLowerCase();
  const keywords = [
    "multi-agent",
    "agent team",
    "outline",
    "copy",
    "background",
    "layout",
    "大纲",
    "文案",
    "背景",
    "排版",
    "布局"
  ];

  return keywords.some((keyword) => source.includes(keyword));
}

function buildAiImageElement(slideId: string, promptText: string, zIndex: number): ElementModel {
  const encodedPrompt = encodeURIComponent(promptText || "presentation background");
  return {
    id: nanoid(),
    slideId,
    type: "image",
    x: 500,
    y: 120,
    width: 300,
    height: 200,
    rotate: 0,
    zIndex,
    content: {
      src: `https://picsum.photos/seed/${encodedPrompt}/800/500`,
      alt: promptText || "AI suggested image"
    },
    style: {
      fill: "#e2e8f0",
      stroke: "#94a3b8",
      strokeWidth: 1,
      opacity: 1,
      borderRadius: 10
    }
  };
}

export async function aiRoutes(app: FastifyInstance): Promise<void> {
  app.post<{ Body: { aiConfig: AIConfig } }>("/ai/test-connection", async (request, reply) => {
    try {
      const payload = request.body as { aiConfig: AIConfig };
      const result = await testAIConnection(payload.aiConfig);
      return {
        ok: true,
        provider: result.provider,
        model: result.model,
        message: `Connection OK (${result.provider}/${result.model})`
      };
    } catch (error) {
      request.log.error(error, "AI connection test failed");
      return reply.code(502).send({ message: `AI connection test failed: ${(error as Error).message}` });
    }
  });

  app.post<{ Params: { deckId: string }; Body: GenerateDeckRequest }>(
    "/ai/decks/:deckId/generate",
    async (request, reply) => {
      try {
        const deck = deckStore.getById(request.params.deckId);
        if (!deck) {
          return reply.code(404).send({ message: "deck not found" });
        }

        const payload = request.body as GenerateDeckRequest;
        const slides = Math.max(1, Math.min(payload.slides || 5, 12));
        const result = await generateDeckDraft(deck.aiConfig, { topic: payload.topic, slides });
        return { draft: result };
      } catch (error) {
        request.log.error(error, "AI generate failed");
        return reply.code(502).send({ message: `AI generate failed: ${(error as Error).message}` });
      }
    }
  );

  app.post<{ Params: { deckId: string }; Body: PolishTextRequest }>(
    "/ai/decks/:deckId/polish",
    async (request, reply) => {
      try {
        const deck = deckStore.getById(request.params.deckId);
        if (!deck) {
          return reply.code(404).send({ message: "deck not found" });
        }

        const content = await polishText(deck.aiConfig, request.body as PolishTextRequest);
        return { content };
      } catch (error) {
        request.log.error(error, "AI polish failed");
        return reply.code(502).send({ message: `AI polish failed: ${(error as Error).message}` });
      }
    }
  );

  app.post<{ Params: { deckId: string }; Body: ImportMarkdownRequest }>(
    "/ai/decks/:deckId/visuals",
    async (request, reply) => {
      try {
        const deck = deckStore.getById(request.params.deckId);
        if (!deck) {
          return reply.code(404).send({ message: "deck not found" });
        }

        const payload = request.body as ImportMarkdownRequest;
        const suggestions = await suggestVisuals(deck.aiConfig, payload.markdown);
        return { suggestions };
      } catch (error) {
        request.log.error(error, "AI visuals failed");
        return reply.code(502).send({ message: `AI visuals failed: ${(error as Error).message}` });
      }
    }
  );

  app.post<{ Params: { deckId: string }; Body: { topic: string; pages: number } }>(
    "/ai/decks/:deckId/outline",
    async (request, reply) => {
      const deck = deckStore.getById(request.params.deckId);
      if (!deck) {
        return reply.code(404).send({ message: "deck not found" });
      }

      const { topic, pages } = request.body;
      const outline = await generateOutline(deck.aiConfig, topic, pages);
      return { outline };
    }
  );

  app.post<{
    Params: { deckId: string };
    Body: { topic: string; outline: string; slideIndex: number };
  }>("/ai/decks/:deckId/copy", async (request, reply) => {
    const deck = deckStore.getById(request.params.deckId);
    if (!deck) {
      return reply.code(404).send({ message: "deck not found" });
    }

    const { topic, outline, slideIndex } = request.body;
    const content = await generatePaginatedCopy(deck.aiConfig, topic, outline, slideIndex);
    return { content };
  });

  app.post<{
    Params: { deckId: string };
    Body: { topic: string; requirements: string };
  }>("/ai/decks/:deckId/generate-markdown", async (request, reply) => {
    try {
      const deck = deckStore.getById(request.params.deckId);
      if (!deck) {
        return reply.code(404).send({ message: "deck not found" });
      }

      const { topic, requirements } = request.body;
      const markdown = await generateRichMarkdown(deck.aiConfig, topic, requirements);
      return { markdown };
    } catch (error) {
      request.log.error(error, "AI generate markdown failed");
      return reply.code(502).send({ message: `AI generate markdown failed: ${(error as Error).message}` });
    }
  });

  app.post<{
    Params: { deckId: string };
    Body: GenerateDeckFromOutlineRequest;
  }>("/ai/decks/:deckId/generate-by-outline", async (request, reply) => {
    try {
      const deck = deckStore.getById(request.params.deckId);
      if (!deck) {
        return reply.code(404).send({ message: "deck not found" });
      }

      const payload = request.body as GenerateDeckFromOutlineRequest;
      const topic = payload.topic?.trim();
      if (!topic) {
        return reply.code(400).send({ message: "topic is required" });
      }

      const pages = Math.max(1, Math.min(payload.pages || 1, 30));
      const themeTemplate: DeckThemeTemplate = payload.themeTemplate || "business";
      const toolPolicy = normalizeToolPolicy(payload.toolPolicy);
      if (!toolPolicy.allowedTools.includes("generate-outline")) {
        return reply.code(400).send({ message: "tool policy must allow generate-outline" });
      }
      if (!toolPolicy.allowedTools.includes("append-slide-markdown")) {
        return reply.code(400).send({ message: "tool policy must allow append-slide-markdown" });
      }

      const outline = await generateStructuredOutline(deck.aiConfig, {
        topic,
        pages,
        requirements: payload.requirements,
        themeTemplate
      });

      const createdSlides: Array<{ slideId: string; slideNumber: number; title: string; markdown: string }> = [];
      for (const plan of outline.slides) {
        const markdown = await generateSlideMarkdownFromOutline(deck.aiConfig, {
          topic,
          plan,
          themeTemplate
        });

        const appended = appendSlideMarkdown(deck.id, {
          markdown,
          title: plan.title
        });

        if (!appended) {
          return reply.code(500).send({ message: "failed to append generated slide markdown" });
        }

        createdSlides.push({
          slideId: appended.slide.id,
          slideNumber: appended.slide.slideNumber,
          title: appended.slide.title,
          markdown: appended.markdown
        });
      }

      const latest = deckStore.getById(deck.id);
      if (!latest) {
        return reply.code(500).send({ message: "deck update failed" });
      }

      return {
        outline,
        slides: createdSlides,
        deck: latest
      };
    } catch (error) {
      request.log.error(error, "AI outline pipeline failed");
      return reply.code(502).send({ message: `AI outline pipeline failed: ${(error as Error).message}` });
    }
  });

  app.post<{
    Params: { deckId: string; slideId: string };
    Body: AISlideEditRequest;
  }>("/ai/decks/:deckId/slides/:slideId/rewrite", async (request, reply) => {
    try {
      const deck = deckStore.getById(request.params.deckId);
      if (!deck) {
        return reply.code(404).send({ message: "deck not found" });
      }

      const slide = deck.slides.find((item) => item.id === request.params.slideId);
      if (!slide) {
        return reply.code(404).send({ message: "slide not found" });
      }

      const payload = request.body as AISlideEditRequest;
      if (!payload.instruction?.trim()) {
        return reply.code(400).send({ message: "instruction is required" });
      }

      const current = readSlideMarkdownBySlideId(deck.id, slide.id);
      if (!current) {
        return reply.code(404).send({ message: "slide not found" });
      }

      const currentMarkdown = current.markdown;
      const markdown = await rewriteSlideMarkdown(deck.aiConfig, {
        topic: deck.title,
        currentMarkdown,
        instruction: payload.instruction.trim()
      });
      const instruction = payload.instruction;
      const overwritten = overwriteSlideMarkdownBySlideId(deck.id, slide.id, markdown);
      if (!overwritten) {
        return reply.code(500).send({ message: "failed to overwrite slide markdown" });
      }

      const rewrittenSlide = overwritten.slide;

      const shouldAddImage = /图片|image|配图/i.test(instruction);
      const shouldBeautifyBg = /背景|bg|background|美化/i.test(instruction);
      const imageHint = (markdown.match(/\[图片建议:\s*([^\]]+)\]/)?.[1] || instruction).trim();
      const backgroundHtml = extractBackgroundHtml(markdown);

      const nextElements = rewrittenSlide.elements.map((element, index) => ({
        ...element,
        zIndex: index + 1
      }));

      if (shouldAddImage) {
        nextElements.push(buildAiImageElement(slide.id, imageHint, nextElements.length + 1));
      }

      const updatedSlide: Slide = {
        ...rewrittenSlide,
        bgColor: shouldBeautifyBg ? BEAUTIFIED_BG : rewrittenSlide.bgColor || DEFAULT_SLIDE_BG,
        bgHtml: backgroundHtml ?? rewrittenSlide.bgHtml,
        elements: nextElements,
        updatedAt: Date.now()
      };

      const nextDeck = {
        ...deck,
        slides: deck.slides.map((item) => (item.id === slide.id ? updatedSlide : item))
      };

      const merged = deckStore.overwriteDeck(deck.id, nextDeck);
      return { markdown, deck: merged };
    } catch (error) {
      request.log.error(error, "AI rewrite slide failed");
      return reply.code(502).send({ message: `AI rewrite slide failed: ${(error as Error).message}` });
    }
  });
}
