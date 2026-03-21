import type { FastifyInstance } from "fastify";
import type {
  GenerateDeckRequest,
  ImportMarkdownRequest,
  PolishTextRequest
} from "@web-ppt/shared";
import { deckStore } from "../data/deck-store";
import {
  generateDeckDraft,
  polishText,
  suggestVisuals,
  generateOutline,
  generatePaginatedCopy
} from "../services/ai/gateway";

export async function aiRoutes(app: FastifyInstance): Promise<void> {
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
}
