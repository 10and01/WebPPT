import { nanoid } from "nanoid";
import type { ElementModel, Slide } from "@web-ppt/shared";

function estimateTextHeight(text: string, fontSize: number, maxCharsPerLine: number): number {
  const lines = Math.max(1, Math.ceil((text || "").length / maxCharsPerLine));
  const lineHeight = Math.ceil(fontSize * 1.35);
  return Math.max(lineHeight + 6, lines * lineHeight + 8);
}

export function toSlideMarkdown(slide: Slide): string {
  const title = slide.title?.trim() || "Untitled";
  const lines = slide.elements
    .slice()
    .sort((a, b) => a.y - b.y || a.x - b.x)
    .filter((element) => element.type === "text")
    .map((element) => String(element.content?.text || "").trim())
    .filter(Boolean)
    .map((text) => {
      if (text.startsWith("•")) {
        return `- ${text.replace(/^•\s*/, "")}`;
      }
      return text;
    });

  return [`# ${title}`, "", ...lines].join("\n").trim();
}

export function markdownToSlideElements(slideId: string, markdown: string): { title: string; elements: ElementModel[] } {
  const lines = (markdown || "")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  const titleLine = lines.find((line) => line.startsWith("# ")) || "# AI Slide";
  const title = titleLine.replace(/^#\s+/, "").trim() || "AI Slide";
  const contentLines = lines.filter((line) => line !== titleLine);

  let y = 120;
  const elements: ElementModel[] = [];

  for (const rawLine of contentLines) {
    const isBullet = /^[-*+]\s+/.test(rawLine);
    const text = isBullet ? `• ${rawLine.replace(/^[-*+]\s+/, "")}` : rawLine;
    const fontSize = isBullet ? 22 : 24;
    const height = estimateTextHeight(text, fontSize, 42);

    elements.push({
      id: nanoid(),
      slideId,
      type: "text",
      x: 80,
      y,
      width: 760,
      height,
      rotate: 0,
      zIndex: elements.length + 1,
      content: { text },
      style: {
        fill: "#0f172a",
        stroke: "transparent",
        strokeWidth: 0,
        opacity: 1,
        fontSize,
        fontWeight: isBullet ? 500 : 600,
        textAlign: "left"
      }
    });

    y += height + (isBullet ? 8 : 12);
  }

  return { title, elements };
}
