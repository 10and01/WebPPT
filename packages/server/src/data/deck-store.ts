import { nanoid } from "nanoid";
import type { AddSlideRequest, CreateDeckRequest, Deck, ElementModel, Slide } from "@web-ppt/shared";

const now = () => Date.now();

const decks = new Map<string, Deck>();

const defaultDeckConfig = {
  provider: "openai" as const,
  model: "gpt-4.1-mini"
};

export const deckStore = {
  list(): Deck[] {
    return [...decks.values()];
  },

  create(input: CreateDeckRequest): Deck {
    const createdAt = now();
    const id = nanoid();
    const deck: Deck = {
      id,
      title: input.title,
      createdBy: input.createdBy,
      createdAt,
      updatedAt: createdAt,
      version: 1,
      permissions: [
        {
          userId: input.createdBy,
          role: "owner",
          grantedAt: createdAt
        }
      ],
      slides: [],
      aiConfig: defaultDeckConfig
    };

    decks.set(id, deck);
    return deck;
  },

  getById(id: string): Deck | undefined {
    return decks.get(id);
  },

  addSlide(deckId: string, input: AddSlideRequest): Slide | undefined {
    const deck = decks.get(deckId);
    if (!deck) {
      return undefined;
    }

    const createdAt = now();
    const slide: Slide = {
      id: nanoid(),
      deckId,
      slideNumber: deck.slides.length + 1,
      title: input.title ?? `Slide ${deck.slides.length + 1}`,
      bgColor: "#ffffff",
      elements: [],
      createdAt,
      updatedAt: createdAt
    };

    deck.slides.push(slide);
    deck.updatedAt = createdAt;
    deck.version += 1;

    return slide;
  },

  replaceSlideElements(deckId: string, slideId: string, elements: ElementModel[]): Slide | undefined {
    const deck = decks.get(deckId);
    if (!deck) {
      return undefined;
    }

    const slide = deck.slides.find((item) => item.id === slideId);
    if (!slide) {
      return undefined;
    }

    slide.elements = elements;
    slide.updatedAt = now();
    deck.updatedAt = slide.updatedAt;
    deck.version += 1;
    return slide;
  },

  overwriteDeck(deckId: string, nextDeck: Deck): Deck | undefined {
    const existing = decks.get(deckId);
    if (!existing) {
      return undefined;
    }

    const merged: Deck = {
      ...existing,
      ...nextDeck,
      id: existing.id,
      createdBy: existing.createdBy,
      createdAt: existing.createdAt,
      updatedAt: now(),
      version: existing.version + 1
    };

    decks.set(deckId, merged);
    return merged;
  },

  getSlideById(slideId: string): Slide | undefined {
    for (const deck of decks.values()) {
      const slide = deck.slides.find((s) => s.id === slideId);
      if (slide) return slide;
    }
    return undefined;
  },

  addElement(deckId: string, slideId: string, element: ElementModel): ElementModel | undefined {
    const deck = decks.get(deckId);
    if (!deck) return undefined;

    const slide = deck.slides.find((s) => s.id === slideId);
    if (!slide) return undefined;

    slide.elements.push(element);
    slide.updatedAt = now();
    deck.updatedAt = slide.updatedAt;
    deck.version += 1;

    return element;
  }
};
