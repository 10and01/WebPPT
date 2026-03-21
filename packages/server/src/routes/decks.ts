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
      const payload = request.body as { elements: ElementModel[] };
      const slide = deckStore.replaceSlideElements(
        request.params.deckId,
        request.params.slideId,
        Array.isArray(payload.elements) ? payload.elements : []
      );

      if (!slide) {
        return reply.code(404).send({ message: "slide not found" });
      }

      return { slide };
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
