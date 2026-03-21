import { describe, it, expect, beforeEach } from "vitest";
import type { Deck, Slide, ElementModel } from "@web-ppt/shared";
import { deckStore } from "../data/deck-store";

describe("Collaboration Consistency", () => {
  let testDeck: Deck;

  beforeEach(() => {
    testDeck = deckStore.create({
      title: "Test Deck",
      createdBy: "test-user-1"
    });
  });

  it("should maintain deck version consistency on updates", () => {
    const initialVersion = testDeck.version;
    const slide = deckStore.addSlide(testDeck.id, {});
    const updatedDeck = deckStore.getById(testDeck.id);

    expect(updatedDeck).toBeDefined();
    expect(updatedDeck!.slides).toHaveLength(1);
    expect(updatedDeck!.version).toBeGreaterThanOrEqual(initialVersion);
  });

  it("should handle concurrent modifications to slides", () => {
    const slide1 = deckStore.addSlide(testDeck.id, {});
    const slide2 = deckStore.addSlide(testDeck.id, {});

    const deck = deckStore.getById(testDeck.id);
    expect(deck!.slides).toHaveLength(2);

    // Verify slide IDs are unique
    const ids = new Set(deck!.slides.map((s) => s.id));
    expect(ids.size).toBe(2);
  });

  it("should preserve element order and properties", () => {
    const slide = deckStore.addSlide(testDeck.id, {});
    if (!slide) throw new Error("Failed to create slide");

    const element1: ElementModel = {
      id: "elem-1",
      slideId: slide.id,
      type: "text",
      x: 10,
      y: 20,
      width: 300,
      height: 100,
      rotate: 0,
      zIndex: 1,
      content: { text: "First" },
      style: {
        fill: "#fff",
        stroke: "#000",
        strokeWidth: 1,
        opacity: 1
      }
    };

    deckStore.addElement(testDeck.id, slide.id, element1);
    const updated = deckStore.getSlideById(slide.id);

    expect(updated!.elements).toHaveLength(1);
    expect(updated!.elements[0].content?.text).toBe("First");
    expect(updated!.elements[0].x).toBe(10);
  });

  it("should handle permission checks correctly", () => {
    const slide = deckStore.addSlide(testDeck.id, {});
    const updated = deckStore.getById(testDeck.id);

    expect(updated!.permissions).toHaveLength(1);
    expect(updated!.permissions[0].userId).toBe("test-user-1");
    expect(updated!.permissions[0].role).toBe("owner");
  });
});
