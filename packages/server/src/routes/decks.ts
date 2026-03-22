import type { FastifyInstance } from "fastify";
import type { AddSlideRequest, AIConfig, CreateDeckRequest, ElementModel } from "@web-ppt/shared";
import { deckStore } from "../data/deck-store";

export async function deckRoutes(app: FastifyInstance): Promise<void> {
  app.get("/decks", async () => {
    return { decks: deckStore.list() };
  });

  app.post<{ Body: CreateDeckRequest }>("/decks", async (request, reply) => {
    const { title, createdBy } = request.body as CreateDeckRequest;
    if (!title?.trim() || !createdBy?.trim()) {
      return reply.code(400).send({ message: "title and createdBy are required" });
    }

    const deck = deckStore.create({
      title: title.trim(),
      createdBy: createdBy.trim()
    });

    return reply.code(201).send({ deck });
  });

  app.get<{ Params: { deckId: string } }>("/decks/:deckId", async (request, reply) => {
    const deck = deckStore.getById(request.params.deckId);
    if (!deck) {
      return reply.code(404).send({ message: "deck not found" });
    }

    return { deck };
  });

  app.post<{ Params: { deckId: string }; Body: AddSlideRequest }>(
    "/decks/:deckId/slides",
    async (request, reply) => {
      const payload = (request.body ?? {}) as AddSlideRequest;
      const slide = deckStore.addSlide(request.params.deckId, payload);
      if (!slide) {
        return reply.code(404).send({ message: "deck not found" });
      }

      return reply.code(201).send({ slide });
    }
  );

  app.put<{ Params: { deckId: string; slideId: string }; Body: { elements: ElementModel[] } }>(
    "/decks/:deckId/slides/:slideId/elements",
    async (request, reply) => {
      const { deckId, slideId } = request.params;
      const payload = request.body as { elements: ElementModel[] };
      
      request.log.info({ deckId, slideId, elementCount: Array.isArray(payload.elements) ? payload.elements.length : 0 }, "Updating slide elements");
      
      const slide = deckStore.replaceSlideElements(
        deckId,
        slideId,
        Array.isArray(payload.elements) ? payload.elements : []
      );

      if (!slide) {
        request.log.warn({ deckId, slideId }, "Failed to find deck or slide");
        return reply.code(404).send({ message: "slide not found" });
      }

      request.log.info({ deckId, slideId, elementCount: slide.elements.length }, "Slide elements updated successfully");
      return { slide };
    }
  );

  app.delete<{ Params: { deckId: string; slideId: string } }>(
    "/decks/:deckId/slides/:slideId",
    async (request, reply) => {
      const { deckId, slideId } = request.params;
      const deck = deckStore.deleteSlide(deckId, slideId);
      if (!deck) {
        return reply.code(404).send({ message: "slide not found" });
      }

      return { deck };
    }
  );

  app.put<{ Params: { deckId: string }; Body: { aiConfig: AIConfig } }>(
    "/decks/:deckId/ai-config",
    async (request, reply) => {
      const deck = deckStore.getById(request.params.deckId);
      if (!deck) {
        return reply.code(404).send({ message: "deck not found" });
      }

      const nextDeck = {
        ...deck,
        aiConfig: {
          ...deck.aiConfig,
          ...(request.body as { aiConfig: AIConfig }).aiConfig
        }
      };

      const merged = deckStore.overwriteDeck(deck.id, nextDeck);
      return { deck: merged };
    }
  );
}
