import { nanoid } from "nanoid";
import type { ElementModel, Slide } from "@web-ppt/shared";

function estimateTextHeight(text: string, fontSize: number, maxCharsPerLine: number): number {
  const lines = Math.max(1, Math.ceil((text || "").length / maxCharsPerLine));
  const lineHeight = Math.ceil(fontSize * 1.35);
  return Math.max(lineHeight + 6, lines * lineHeight + 8);
}

function parseColoredText(line: string): { text: string; color?: string } {
  const trimmed = (line || "").trim();
  const zh = trimmed.match(/^\[文字颜色\s*:\s*(#[0-9a-fA-F]{6})\]\s*(.+)$/);
  if (zh) {
    return { text: zh[2].trim(), color: zh[1] };
  }

  const en = trimmed.match(/^\[text-color\s*:\s*(#[0-9a-fA-F]{6})\]\s*(.+)$/i);
  if (en) {
    return { text: en[2].trim(), color: en[1] };
  }

  return { text: trimmed };
}

function parseChartDirective(line: string): {
  title: string;
  points: Array<{ label: string; value: number }>;
} | null {
  const match = line.match(/^\[(图表|chart)\s*:\s*(.+)\]$/i);
  if (!match) {
    return null;
  }

  const parts = match[2]
    .split(/[;,|]/)
    .map((part) => part.trim())
    .filter(Boolean);

  if (parts.length < 2) {
    return null;
  }

  const points: Array<{ label: string; value: number }> = [];
  for (let i = 1; i < parts.length; i += 1) {
    const parsed = parts[i].match(/^([^:=]+)\s*[:=]\s*(-?\d+(?:\.\d+)?)$/);
    if (!parsed) {
      continue;
    }
    points.push({ label: parsed[1].trim(), value: Number(parsed[2]) });
  }

  if (!points.length) {
    return null;
  }

  return {
    title: parts[0],
    points: points.slice(0, 6)
  };
}

function makeTextElement(
  slideId: string,
  text: string,
  y: number,
  options?: {
    fontSize?: number;
    fontWeight?: number;
    color?: string;
    x?: number;
    width?: number;
  }
): ElementModel {
  const fontSize = options?.fontSize ?? 24;
  const fontWeight = options?.fontWeight ?? 600;
  const color = options?.color || "#0f172a";
  const x = options?.x ?? 80;
  const width = options?.width ?? 760;

  return {
    id: nanoid(),
    slideId,
    type: "text",
    x,
    y,
    width,
    height: estimateTextHeight(text, fontSize, 42),
    rotate: 0,
    zIndex: 1,
    content: { text },
    style: {
      fill: color,
      stroke: "transparent",
      strokeWidth: 0,
      opacity: 1,
      fontSize,
      fontWeight,
      color,
      textAlign: "left"
    }
  };
}

function makeTableElements(slideId: string, tableRows: string[][], y: number): ElementModel[] {
  const rows = tableRows.filter((row) => row.length > 0);
  const maxCols = Math.max(1, ...rows.map((row) => row.length));
  const rowHeight = 38;
  const tableWidth = 760;
  const colWidth = tableWidth / maxCols;
  const elements: ElementModel[] = [];

  rows.forEach((row, r) => {
    for (let c = 0; c < maxCols; c += 1) {
      const cell = row[c] || "";
      const x = 80 + c * colWidth;
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
        y: cellY + 7,
        width: colWidth - 16,
        height: rowHeight - 14,
        rotate: 0,
        zIndex: 2,
        content: { text: cell },
        style: {
          fill: "#0f172a",
          stroke: "transparent",
          strokeWidth: 0,
          opacity: 1,
          fontSize: isHeader ? 17 : 15,
          fontWeight: isHeader ? 700 : 500,
          textAlign: "left"
        }
      });
    }
  });

  return elements;
}

function makeSimpleBarChartElements(
  slideId: string,
  chart: { title: string; points: Array<{ label: string; value: number }> },
  y: number
): ElementModel[] {
  const elements: ElementModel[] = [];
  const titleElement = makeTextElement(slideId, chart.title, y, { fontSize: 20, fontWeight: 700 });
  elements.push(titleElement);

  const maxValue = Math.max(1, ...chart.points.map((point) => point.value));
  const barTop = y + titleElement.height + 8;
  const barAreaWidth = 620;
  const barHeight = 26;
  const rowGap = 12;

  chart.points.forEach((point, index) => {
    const rowY = barTop + index * (barHeight + rowGap);
    const barWidth = Math.max(20, Math.round((Math.max(0, point.value) / maxValue) * barAreaWidth));

    elements.push(
      makeTextElement(slideId, point.label, rowY + 2, {
        fontSize: 16,
        fontWeight: 500,
        x: 80,
        width: 120
      })
    );

    elements.push({
      id: nanoid(),
      slideId,
      type: "shape",
      x: 208,
      y: rowY,
      width: barWidth,
      height: barHeight,
      rotate: 0,
      zIndex: 1,
      content: { shapeKind: "roundRect" },
      style: {
        fill: "#3b82f6",
        stroke: "#1d4ed8",
        strokeWidth: 1,
        opacity: 0.92,
        borderRadius: 8
      }
    });

    elements.push(
      makeTextElement(slideId, String(point.value), rowY + 3, {
        fontSize: 15,
        fontWeight: 600,
        x: 216 + barWidth,
        width: 100
      })
    );
  });

  return elements;
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

  const backgroundBlock = slide.bgHtml?.trim()
    ? ["", "```background-html", slide.bgHtml.trim(), "```"]
    : [];

  return [`# ${title}`, "", ...lines, ...backgroundBlock].join("\n").trim();
}

export function markdownToSlideElements(
  slideId: string,
  markdown: string
): { title: string; elements: ElementModel[]; bgHtml?: string } {
  const backgroundMatch = (markdown || "").match(/```(?:background-html|bg-html|slide-bg-html)\s*([\s\S]*?)```/i);
  const bgHtml = backgroundMatch?.[1]?.trim() || undefined;
  const markdownWithoutBg = (markdown || "").replace(/```(?:background-html|bg-html|slide-bg-html)\s*[\s\S]*?```/gi, "");

  const lines = markdownWithoutBg
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  const titleLine = lines.find((line) => line.startsWith("# ")) || "# AI Slide";
  const title = titleLine.replace(/^#\s+/, "").trim() || "AI Slide";
  const contentLines = lines.filter((line) => line !== titleLine);

  let y = 120;
  const elements: ElementModel[] = [];

  for (let i = 0; i < contentLines.length; i += 1) {
    const rawLine = contentLines[i];
    if (!rawLine || rawLine === "---" || /^\[图片建议:/i.test(rawLine)) {
      continue;
    }

    if (/^\|.*\|$/.test(rawLine)) {
      const tableRows: string[][] = [];
      let cursor = i;
      while (cursor < contentLines.length && /^\|.*\|$/.test(contentLines[cursor])) {
        const row = contentLines[cursor]
          .split("|")
          .map((cell) => cell.trim())
          .filter((cell, idx, arr) => !(idx === 0 && cell === "") && !(idx === arr.length - 1 && cell === ""));

        if (!row.every((cell) => /^:?-{3,}:?$/.test(cell))) {
          tableRows.push(row);
        }
        cursor += 1;
      }

      if (tableRows.length) {
        const tableElements = makeTableElements(slideId, tableRows, y);
        tableElements.forEach((element) => {
          elements.push({ ...element, zIndex: elements.length + 1 });
        });
        y += tableRows.length * 38 + 12;
      }

      i = cursor - 1;
      continue;
    }

    const chart = parseChartDirective(rawLine);
    if (chart) {
      const chartElements = makeSimpleBarChartElements(slideId, chart, y);
      chartElements.forEach((element) => {
        elements.push({ ...element, zIndex: elements.length + 1 });
      });
      y += Math.max(120, chart.points.length * 38 + 56);
      continue;
    }

    if (/^##+\s+/.test(rawLine)) {
      const level = Math.min(4, (rawLine.match(/^#+/)?.[0].length || 2));
      const headingText = rawLine.replace(/^##+\s+/, "").trim();
      const heading = makeTextElement(slideId, headingText, y, {
        fontSize: Math.max(20, 30 - level * 2),
        fontWeight: 700
      });
      elements.push({ ...heading, zIndex: elements.length + 1 });
      y += heading.height + 10;
      continue;
    }

    if (/^>\s*/.test(rawLine)) {
      const quote = rawLine.replace(/^>\s*/, "").trim();
      const quoteEl = makeTextElement(slideId, `❝ ${quote}`, y, {
        fontSize: 20,
        fontWeight: 600,
        color: "#0b5fff"
      });
      elements.push({ ...quoteEl, zIndex: elements.length + 1 });
      y += quoteEl.height + 10;
      continue;
    }

    const isBullet = /^[-*+]\s+/.test(rawLine);
    const colored = parseColoredText(isBullet ? rawLine.replace(/^[-*+]\s+/, "") : rawLine);
    const text = isBullet ? `• ${colored.text}` : colored.text;
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
        fill: colored.color || "#0f172a",
        stroke: "transparent",
        strokeWidth: 0,
        opacity: 1,
        fontSize,
        fontWeight: isBullet ? 500 : 600,
        color: colored.color,
        textAlign: "left"
      }
    });

    y += height + (isBullet ? 8 : 12);
  }

  return { title, elements, bgHtml };
}
