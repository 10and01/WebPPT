import type { AppendSlideMarkdownRequest, Deck, Slide, SlideMarkdownReadResponse } from "@web-ppt/shared";
import { deckStore } from "../../data/deck-store";
import { markdownToSlideElements, toSlideMarkdown } from "./slide-markdown";

function findSlideByPageNumber(deck: Deck, pageNumber: number): Slide | undefined {
  return deck.slides.find((slide) => slide.slideNumber === pageNumber);
}

function createReadResponse(deck: Deck, slide: Slide): SlideMarkdownReadResponse {
  return {
    deckId: deck.id,
    slideId: slide.id,
    slideNumber: slide.slideNumber,
    markdown: toSlideMarkdown(slide),
    title: slide.title
  };
}

export function readSlideMarkdown(deckId: string, pageNumber: number): SlideMarkdownReadResponse | undefined {
  const deck = deckStore.getById(deckId);
  if (!deck) {
    return undefined;
  }

  const slide = findSlideByPageNumber(deck, pageNumber);
  if (!slide) {
    return undefined;
  }

  return createReadResponse(deck, slide);
}

export function readSlideMarkdownBySlideId(deckId: string, slideId: string): SlideMarkdownReadResponse | undefined {
  const deck = deckStore.getById(deckId);
  if (!deck) {
    return undefined;
  }

  const slide = deck.slides.find((item) => item.id === slideId);
  if (!slide) {
    return undefined;
  }

  return createReadResponse(deck, slide);
}

export function overwriteSlideMarkdown(
  deckId: string,
  pageNumber: number,
  markdown: string
): { deck: Deck; slide: Slide; markdown: string } | undefined {
  const deck = deckStore.getById(deckId);
  if (!deck) {
    return undefined;
  }

  const target = findSlideByPageNumber(deck, pageNumber);
  if (!target) {
    return undefined;
  }

  const { title, elements } = markdownToSlideElements(target.id, markdown);
  const updatedSlide: Slide = {
    ...target,
    title,
    elements: elements.map((element, index) => ({
      ...element,
      slideId: target.id,
      zIndex: index + 1
    })),
    updatedAt: Date.now()
  };

  const nextDeck = {
    ...deck,
    slides: deck.slides.map((slide) => (slide.id === target.id ? updatedSlide : slide))
  };

  const merged = deckStore.overwriteDeck(deckId, nextDeck);
  if (!merged) {
    return undefined;
  }

  return {
    deck: merged,
    slide: merged.slides.find((slide) => slide.id === target.id) || updatedSlide,
    markdown: toSlideMarkdown(updatedSlide)
  };
}

export function overwriteSlideMarkdownBySlideId(
  deckId: string,
  slideId: string,
  markdown: string
): { deck: Deck; slide: Slide; markdown: string } | undefined {
  const deck = deckStore.getById(deckId);
  if (!deck) {
    return undefined;
  }

  const target = deck.slides.find((item) => item.id === slideId);
  if (!target) {
    return undefined;
  }

  return overwriteSlideMarkdown(deckId, target.slideNumber, markdown);
}

export function appendSlideMarkdown(
  deckId: string,
  request: AppendSlideMarkdownRequest
): { deck: Deck; slide: Slide; markdown: string } | undefined {
  const created = deckStore.addSlide(deckId, { title: request.title });
  if (!created) {
    return undefined;
  }

  const overwritten = overwriteSlideMarkdownBySlideId(deckId, created.id, request.markdown || "");
  if (!overwritten) {
    return undefined;
  }

  return overwritten;
}
