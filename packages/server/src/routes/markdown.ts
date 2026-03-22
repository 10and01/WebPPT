import { nanoid } from "nanoid";
import type { FastifyInstance } from "fastify";
import { marked } from "marked";
import type {
  AppendSlideMarkdownRequest,
  ImportMarkdownRequest,
  OverwriteSlideMarkdownRequest,
  Slide,
  ElementModel
} from "@web-ppt/shared";
import { deckStore } from "../data/deck-store";
import {
  appendSlideMarkdown,
  overwriteSlideMarkdown,
  readSlideMarkdown
} from "../services/markdown/page-tools";

const PAGE_TOP = 120;
const PAGE_BOTTOM = 520;
const CONTENT_X = 80;
const CONTENT_W = 760;

function estimateTextHeight(text: string, fontSize: number, maxCharsPerLine: number): number {
  const lines = Math.max(1, Math.ceil((text || "").length / maxCharsPerLine));
  const lineHeight = Math.ceil(fontSize * 1.4);
  return Math.max(lineHeight + 6, lines * lineHeight + 10);
}

function makeSlide(deckId: string, title: string, slideNumber: number): Slide {
  const now = Date.now();
  return {
    id: nanoid(),
    deckId,
    slideNumber,
    title,
    bgColor: "#ffffff",
    elements: [],
    createdAt: now,
    updatedAt: now
  };
}

function makeTextElement(slideId: string, text: string, y: number): ElementModel {
  const fontSize = 24;
  return {
    id: nanoid(),
    slideId,
    type: "text",
    x: CONTENT_X,
    y,
    width: CONTENT_W,
    height: estimateTextHeight(text, fontSize, 42),
    rotate: 0,
    zIndex: 1,
    content: { text },
    style: {
      fill: "#0f172a",
      stroke: "transparent",
      strokeWidth: 0,
      opacity: 1,
      fontSize,
      fontWeight: 500,
      textAlign: "left"
    }
  };
}

function makeListElement(slideId: string, text: string, y: number, level = 0): ElementModel {
  const indent = Math.max(0, level) * 28;
  const bulletText = `${"  ".repeat(Math.max(0, level))}• ${text}`;
  const fontSize = 21;
  return {
    ...makeTextElement(slideId, bulletText, y),
    x: CONTENT_X + indent,
    width: CONTENT_W - indent,
    height: estimateTextHeight(bulletText, fontSize, 48),
    style: {
      fill: "#0f172a",
      stroke: "transparent",
      strokeWidth: 0,
      opacity: 1,
      fontSize,
      fontWeight: 500,
      textAlign: "left"
    }
  };
}

function makeCodeBlockElements(slideId: string, codeText: string, y: number): ElementModel[] {
  const normalized = (codeText || "").split("\n").slice(0, 20).join("\n");
  const boxHeight = Math.min(220, Math.max(90, estimateTextHeight(normalized, 16, 65) + 24));

  const box: ElementModel = {
    id: nanoid(),
    slideId,
    type: "shape",
    x: CONTENT_X,
    y,
    width: CONTENT_W,
    height: boxHeight,
    rotate: 0,
    zIndex: 1,
    content: { shapeKind: "roundRect" },
    style: {
      fill: "#0b1220",
      stroke: "#1e293b",
      strokeWidth: 1,
      opacity: 1,
      borderRadius: 10
    }
  };

  const text: ElementModel = {
    id: nanoid(),
    slideId,
    type: "text",
    x: CONTENT_X + 16,
    y: y + 12,
    width: CONTENT_W - 32,
    height: boxHeight - 20,
    rotate: 0,
    zIndex: 2,
    content: { text: normalized },
    style: {
      fill: "transparent",
      stroke: "transparent",
      strokeWidth: 0,
      opacity: 1,
      fontSize: 16,
      fontWeight: 400,
      fontFamily: "Consolas",
      color: "#e2e8f0",
      textAlign: "left"
    }
  };

  return [box, text];
}

function flattenInline(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => flattenInline((item as { text?: string }).text ?? item)).join("");
  }
  return "";
}

function makeTableElements(slideId: string, header: string[], rows: string[][], y: number): ElementModel[] {
  const elements: ElementModel[] = [];
  const tableRows = [header, ...rows].filter((r) => r.length > 0);
  const maxCols = Math.max(1, ...tableRows.map((r) => r.length));
  const rowHeight = 40;
  const colWidth = CONTENT_W / maxCols;

  for (let r = 0; r < tableRows.length; r += 1) {
    const row = tableRows[r];
    for (let c = 0; c < maxCols; c += 1) {
      const cellText = row[c] ?? "";
      const x = CONTENT_X + c * colWidth;
      const cellY = y + r * rowHeight;
      const isHeader = r === 0;

      elements.push({
        id: nanoid(),
        slideId,
        type: "shape",
        x,
        y: cellY,
        width: colWidth,
        height: rowHeight,
        rotate: 0,
        zIndex: 1,
        content: { shapeKind: "rect" },
        style: {
          fill: isHeader ? "#e2e8f0" : "#ffffff",
          stroke: "#cbd5e1",
          strokeWidth: 1,
          opacity: 1
        }
      });

      elements.push({
        id: nanoid(),
        slideId,
        type: "text",
        x: x + 8,
        y: cellY + 8,
        width: colWidth - 16,
        height: rowHeight - 16,
        rotate: 0,
        zIndex: 2,
        content: { text: cellText },
        style: {
          fill: "transparent",
          stroke: "transparent",
          strokeWidth: 0,
          opacity: 1,
          fontSize: isHeader ? 18 : 16,
          fontWeight: isHeader ? 700 : 400,
          textAlign: "left"
        }
      });
    }
  }

  return elements;
}

export async function markdownRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Params: { deckId: string; pageNumber: string } }>(
    "/decks/:deckId/pages/:pageNumber/markdown",
    async (request, reply) => {
      const pageNumber = Number(request.params.pageNumber);
      if (!Number.isInteger(pageNumber) || pageNumber < 1) {
        return reply.code(400).send({ message: "pageNumber must be a positive integer" });
      }

      const result = readSlideMarkdown(request.params.deckId, pageNumber);
      if (!result) {
        return reply.code(404).send({ message: "slide not found" });
      }

      return result;
    }
  );

  app.put<{ Params: { deckId: string; pageNumber: string }; Body: OverwriteSlideMarkdownRequest }>(
    "/decks/:deckId/pages/:pageNumber/markdown",
    async (request, reply) => {
      const pageNumber = Number(request.params.pageNumber);
      if (!Number.isInteger(pageNumber) || pageNumber < 1) {
        return reply.code(400).send({ message: "pageNumber must be a positive integer" });
      }

      const payload = request.body as OverwriteSlideMarkdownRequest;
      if (!payload.markdown?.trim()) {
        return reply.code(400).send({ message: "markdown is required" });
      }

      const updated = overwriteSlideMarkdown(request.params.deckId, pageNumber, payload.markdown);
      if (!updated) {
        return reply.code(404).send({ message: "slide not found" });
      }

      return {
        pageNumber,
        slideId: updated.slide.id,
        markdown: updated.markdown,
        deck: updated.deck
      };
    }
  );

  app.post<{ Params: { deckId: string }; Body: AppendSlideMarkdownRequest }>(
    "/decks/:deckId/pages/append-markdown",
    async (request, reply) => {
      const payload = request.body as AppendSlideMarkdownRequest;
      if (!payload.markdown?.trim()) {
        return reply.code(400).send({ message: "markdown is required" });
      }

      const appended = appendSlideMarkdown(request.params.deckId, payload);
      if (!appended) {
        return reply.code(404).send({ message: "deck not found" });
      }

      return reply.code(201).send({
        slideId: appended.slide.id,
        pageNumber: appended.slide.slideNumber,
        markdown: appended.markdown,
        deck: appended.deck
      });
    }
  );

  app.post<{ Params: { deckId: string }; Body: ImportMarkdownRequest }>(
    "/decks/:deckId/import-markdown",
    async (request, reply) => {
      const deck = deckStore.getById(request.params.deckId);
      if (!deck) {
        return reply.code(404).send({ message: "deck not found" });
      }

      const payload = request.body as ImportMarkdownRequest;
      const tokens = marked.lexer(payload.markdown || "") as any[];
      const slides: Slide[] = [];
      let current: Slide | null = null;
      let lineY = PAGE_TOP + 24;
      let currentTitle = "Imported Slide";

      const pushCurrent = () => {
        if (current) {
          current.updatedAt = Date.now();
          slides.push(current);
        }
      };

      const ensureSlide = () => {
        if (!current) {
          current = makeSlide(deck.id, currentTitle, slides.length + 1);
          lineY = PAGE_TOP + 24;
        }
      };

      const ensureSpace = (requiredHeight: number) => {
        ensureSlide();
        if (lineY + requiredHeight <= PAGE_BOTTOM) {
          return;
        }

        pushCurrent();
        current = makeSlide(deck.id, `${currentTitle} (cont.)`, slides.length + 1);
        lineY = PAGE_TOP + 24;
      };

      const appendElement = (element: ElementModel) => {
        ensureSlide();
        current!.elements.push({
          ...element,
          slideId: current!.id,
          zIndex: current!.elements.length + 1
        });
      };

      for (const token of tokens) {
        if (token.type === "heading" && token.depth === 1) {
          pushCurrent();
          currentTitle = token.text || "Untitled";
          current = makeSlide(deck.id, currentTitle, slides.length + 1);
          lineY = PAGE_TOP + 24;
          continue;
        }

        ensureSlide();

        if (token.type === "paragraph") {
          const el = makeTextElement(current!.id, token.text, lineY);
          ensureSpace(el.height + 10);
          appendElement({ ...el, y: lineY });
          lineY += el.height + 10;
        }

        if (token.type === "list") {
          for (const item of token.items || []) {
            const level = Number(item.depth || 0) - 1;
            const el = makeListElement(current!.id, item.text || "", lineY, level);
            ensureSpace(el.height + 8);
            appendElement({ ...el, y: lineY });
            lineY += el.height + 8;
          }
        }

        if (token.type === "code") {
          const label = token.lang ? `// ${token.lang}` : "// code";
          const code = `${label}\n${token.text || ""}`;
          const previewHeight = Math.min(220, Math.max(90, estimateTextHeight(code, 16, 65) + 24));
          ensureSpace(previewHeight + 14);
          const elements = makeCodeBlockElements(current!.id, code, lineY);
          for (const e of elements) {
            appendElement({ ...e, y: e.y });
          }
          lineY += previewHeight + 14;
        }

        if (token.type === "table") {
          const header = Array.isArray(token.header)
            ? token.header.map((cell: any) => flattenInline(cell?.text ?? cell))
            : [];
          const rows = Array.isArray(token.rows)
            ? token.rows.map((row: any[]) => row.map((cell: any) => flattenInline(cell?.text ?? cell)))
            : [];

          const totalRows = Math.max(1, rows.length + 1);
          const required = totalRows * 40 + 10;
          ensureSpace(required);
          const elements = makeTableElements(current!.id, header, rows, lineY);
          for (const e of elements) {
            appendElement(e);
          }
          lineY += required;
        }
      }

      pushCurrent();
      if (slides.length === 0) {
        return reply.code(400).send({ message: "No slide content detected" });
      }

      const nextDeck = {
        ...deck,
        slides: slides.map((slide, index) => ({ ...slide, slideNumber: index + 1 }))
      };
      const merged = deckStore.overwriteDeck(deck.id, nextDeck);
      return { deck: merged };
    }
  );
}
