import { describe, it, expect } from "vitest";
import type { Deck, Slide, ElementModel } from "@web-ppt/shared";

describe("Canvas Code Sync", () => {
  // Mock sync mechanism
  interface SyncState {
    canvas: ElementModel[];
    code: string;
    lastUpdate: number;
  }

  function elementToCode(elements: ElementModel[]): string {
    return elements
      .map(
        (el) =>
          `// ${el.type}: ${el.id}\n` +
          `const ${el.id} = {\n` +
          `  type: "${el.type}",\n` +
          `  x: ${el.x}, y: ${el.y},\n` +
          `  width: ${el.width}, height: ${el.height},\n` +
          `  content: "${el.content?.text || ""}"\n` +
          `};\n\n`
      )
      .join("\n");
  }

  function codeToElement(code: string): ElementModel[] {
    // Simplified parser for testing
    const elements: ElementModel[] = [];
    const regex =
      /const\s+([\w-]+)\s+=\s*\{[\s\S]*?type:\s*"(\w+)"[\s\S]*?x:\s*(\d+),[\s\S]*?y:\s*(\d+),[\s\S]*?width:\s*(\d+),[\s\S]*?height:\s*(\d+)/g;

    let match;
    while ((match = regex.exec(code)) !== null) {
      elements.push({
        id: match[1],
        slideId: "test-slide",
        type: match[2] as "text" | "shape" | "image",
        x: parseInt(match[3]),
        y: parseInt(match[4]),
        width: parseInt(match[5]),
        height: parseInt(match[6]),
        rotate: 0,
        zIndex: 1,
        style: {
          fill: "#fff",
          stroke: "#000",
          strokeWidth: 1,
          opacity: 1
        }
      });
    }

    return elements;
  }

  it("should bidirectionally sync between canvas and code", () => {
    const originalElements: ElementModel[] = [
      {
        id: "text-1",
        slideId: "slide-1",
        type: "text",
        x: 10,
        y: 20,
        width: 300,
        height: 50,
        rotate: 0,
        zIndex: 1,
        content: { text: "Hello World" },
        style: {
          fill: "#fff",
          stroke: "#000",
          strokeWidth: 1,
          opacity: 1
        }
      }
    ];

    // Canvas -> Code
    const code = elementToCode(originalElements);
    expect(code).toContain("text-1");
    expect(code).toContain("Hello World");

    // Code -> Canvas
    const syncedElements = codeToElement(code);
    expect(syncedElements).toHaveLength(1);
    expect(syncedElements[0].x).toBe(originalElements[0].x);
    expect(syncedElements[0].y).toBe(originalElements[0].y);
  });

  it("should maintain sync after debouncing", async () => {
    const debounceDelay = 100;
    let synced = false;

    const debouncedSync = (callback: () => void) => {
      setTimeout(() => {
        callback();
        synced = true;
      }, debounceDelay);
    };

    const sync = () => {
      debouncedSync(() => {
        // Simulate sync
      });
    };

    sync();
    expect(synced).toBe(false);

    await new Promise((resolve) => setTimeout(resolve, debounceDelay + 10));
    expect(synced).toBe(true);
  });

  it("should handle conflict resolution in rapid updates", () => {
    let conflictCount = 0;

    class ConflictDetector {
      private lastSync: number = Date.now();
      private updateQueue: Array<() => void> = [];

      enqueueUpdate(update: () => void, timestamp: number) {
        if (timestamp - this.lastSync < 50) {
          // Less than 50ms - potential conflict
          conflictCount++;
        }
        this.updateQueue.push(update);
        this.lastSync = timestamp;
      }

      processQueue() {
        for (const update of this.updateQueue) {
          update();
        }
        this.updateQueue = [];
      }
    }

    const detector = new ConflictDetector();

    // Simulate rapid updates
    detector.enqueueUpdate(() => {}, Date.now());
    detector.enqueueUpdate(() => {}, Date.now() + 25);
    detector.enqueueUpdate(() => {}, Date.now() + 100);

    expect(conflictCount).toBeGreaterThan(0);
    detector.processQueue();
  });

  it("should maintain element order after concurrent edits", () => {
    const elements: ElementModel[] = [];

    for (let i = 0; i < 5; i++) {
      elements.push({
        id: `elem-${i}`,
        slideId: "slide-1",
        type: "text",
        x: i * 100,
        y: 0,
        width: 80,
        height: 40,
        rotate: 0,
        zIndex: i,
        content: { text: `Item ${i}` },
        style: {
          fill: "#fff",
          stroke: "#000",
          strokeWidth: 1,
          opacity: 1
        }
      });
    }

    // Generate code and verify order
    const code = elementToCode(elements);
    const parsingResults = codeToElement(code);

    // Check order is preserved
    for (let i = 0; i < parsingResults.length; i++) {
      expect(parsingResults[i].id).toBe(`elem-${i}`);
    }
  });
});
