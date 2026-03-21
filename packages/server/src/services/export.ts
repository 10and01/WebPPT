import puppeteer, { type Browser } from "puppeteer";
import PptxGenJS from "pptxgenjs";
import { promises as fs } from "node:fs";
import path from "node:path";
import type { Deck } from "@web-ppt/shared";

let browser: Browser | null = null;

async function resolveExecutablePath(): Promise<string | undefined> {
  if (process.env.PUPPETEER_EXECUTABLE_PATH) {
    return process.env.PUPPETEER_EXECUTABLE_PATH;
  }

  const candidates = [
    "C:/Program Files/Google/Chrome/Application/chrome.exe",
    "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
    "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
    "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"
  ];

  for (const candidate of candidates) {
    try {
      await fs.access(candidate);
      return candidate;
    } catch {
      continue;
    }
  }

  return undefined;
}

async function getBrowser(): Promise<Browser> {
  if (browser) return browser;

  const executablePath = await resolveExecutablePath();

  try {
    browser = await puppeteer.launch({
      headless: true,
      executablePath,
      args: ["--no-sandbox", "--disable-setuid-sandbox"]
    });
  } catch (error) {
    throw new Error(
      `Failed to launch browser for export. ${
        (error as Error).message
      }. Configure PUPPETEER_EXECUTABLE_PATH or install Chromium via \"npx puppeteer browsers install chrome\".`
    );
  }

  return browser;
}

function cssColorToPptx(color?: string, fallback = "000000"): string {
  if (!color) {
    return fallback;
  }
  return color.replace("#", "") || fallback;
}

function normalizeImageData(src?: string): { path?: string; data?: string } {
  if (!src) {
    return {};
  }

  if (src.startsWith("data:image")) {
    const commaIndex = src.indexOf(",");
    if (commaIndex > -1) {
      return { data: src.slice(commaIndex + 1) };
    }
  }

  return { path: src };
}

function generateSlideHtml(deck: Deck): string {
  const slidesHtml = deck.slides
    .map((slide, idx) => {
      const elementsHtml = slide.elements
        .map((element) => {
          const x = element.x ?? element.style?.x ?? 0;
          const y = element.y ?? element.style?.y ?? 0;
          const width = element.width ?? element.style?.width ?? 300;
          const height = element.height ?? element.style?.height ?? 100;
          const zIndex = element.zIndex ?? element.style?.zIndex ?? 0;

          if (element.type === "text") {
            const style = `position: absolute; 
              left: ${x}px; 
              top: ${y}px; 
              width: ${width}px; 
              height: ${height}px;
              font-size: ${element.style?.fontSize || 16}px;
              color: ${element.style?.color || "#000"};
              font-family: ${element.style?.fontFamily || "Arial"};
              z-index: ${zIndex};`;
            return `<div style="${style}">${element.content?.text || ""}</div>`;
          }

          if (element.type === "shape") {
            const style = `position: absolute;
              left: ${x}px;
              top: ${y}px;
              width: ${width}px;
              height: ${height}px;
              background-color: ${element.style?.fill || "#ccc"};
              border: 2px solid ${element.style?.stroke || "#666"};
              z-index: ${zIndex};`;
            return `<div style="${style}"></div>`;
          }

          if (element.type === "image") {
            const style = `position: absolute;
              left: ${x}px;
              top: ${y}px;
              width: ${width}px;
              height: ${height}px;
              z-index: ${zIndex};`;
            return `<img src="${element.content?.src || ""}" style="${style}" alt="${element.content?.alt || "slide-element"}" />`;
          }

          return "";
        })
        .join("\n");

      return `
        <div style="
          width: 960px;
          height: 540px;
          margin: 20px auto;
          padding: 40px;
          background: #fff;
          border: 1px solid #eee;
          page-break-after: always;
          position: relative;
          overflow: hidden;
        ">
          <h1 style="margin: 0 0 20px 0; font-size: 32px;">${slide.title || `Slide ${idx + 1}`}</h1>
          <div style="position: relative; width: 100%; height: 100%;">
            ${elementsHtml}
          </div>
        </div>
      `;
    })
    .join("\n");

  return `
    <!DOCTYPE html>
    <html lang="zh-CN">
    <head>
      <meta charset="UTF-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1.0" />
      <title>${deck.title}</title>
      <style>
        body {
          margin: 0;
          padding: 20px;
          font-family: "Segoe UI", Tahoma, Geneva, Verdana, sans-serif;
          background: #f5f5f5;
        }
        @page {
          size: A4;
          margin: 0;
        }
        @media print {
          body {
            margin: 0;
            padding: 0;
            background: none;
          }
        }
      </style>
    </head>
    <body>
      ${slidesHtml}
    </body>
    </html>
  `;
}

export async function exportToPdf(deck: Deck, outputPath: string): Promise<void> {
  const b = await getBrowser();
  const page = await b.newPage();

  try {
    const html = generateSlideHtml(deck);
    await page.setContent(html, { waitUntil: "networkidle0" });

    await page.pdf({
      path: outputPath,
      format: "A4",
      margin: { top: 0, right: 0, bottom: 0, left: 0 },
      printBackground: true,
      scale: 0.8
    });
  } finally {
    await page.close();
  }
}

export async function exportToPng(
  deck: Deck,
  outputDir: string,
  options?: { quality?: number; dpiMultiplier?: number }
): Promise<string[]> {
  const b = await getBrowser();
  const page = await b.newPage();
  const files: string[] = [];

  try {
    await fs.mkdir(outputDir, { recursive: true });

    for (let i = 0; i < deck.slides.length; i++) {
      const slide = deck.slides[i];
      const slideHtml = `
        <!DOCTYPE html>
        <html lang="zh-CN">
        <head>
          <meta charset="UTF-8" />
          <meta name="viewport" content="width=device-width, initial-scale=1.0" />
          <title>${slide.title}</title>
          <style>
            body { margin: 0; padding: 0; }
            .slide-container {
              width: 960px;
              height: 540px;
              padding: 40px;
              background: #fff;
              position: relative;
              overflow: hidden;
            }
            h1 { margin: 0 0 20px 0; font-size: 32px; }
          </style>
        </head>
        <body>
          <div class="slide-container">
            <h1>${slide.title || `Slide ${i + 1}`}</h1>
            <div style="position: relative; width: 100%; height: calc(100% - 60px);">
              ${slide.elements
                .map((element) => {
                  if (element.type === "text") {
                    return `<div style="position: absolute; left: ${element.x ?? element.style?.x ?? 0}px; top: ${element.y ?? element.style?.y ?? 0}px; width: ${element.width ?? element.style?.width ?? 300}px; height: ${element.height ?? element.style?.height ?? 100}px; font-size: ${element.style?.fontSize || 16}px; color: ${element.style?.color || "#000"};">${element.content?.text || ""}</div>`;
                  }
                  if (element.type === "image") {
                    return `<img src="${element.content?.src || ""}" style="position: absolute; left: ${element.x ?? element.style?.x ?? 0}px; top: ${element.y ?? element.style?.y ?? 0}px; width: ${element.width ?? element.style?.width ?? 200}px; height: ${element.height ?? element.style?.height ?? 150}px;" alt="${element.content?.alt || "element"}" />`;
                  }
                  return "";
                })
                .join("\n")}
            </div>
          </div>
        </body>
        </html>
      `;

      await page.setContent(slideHtml, { waitUntil: "networkidle0" });

      const fileName = `${deck.id}-slide-${i + 1}.png`;
      const filePath = path.join(outputDir, fileName);

      await page.screenshot({
        path: filePath,
        type: "png",
        fullPage: true,
        omitBackground: false
      });

      files.push(filePath);
    }
  } finally {
    await page.close();
  }

  return files;
}

export async function exportToPptx(deck: Deck, outputPath: string): Promise<void> {
  const pptx = new PptxGenJS();
  pptx.layout = "LAYOUT_WIDE";
  pptx.author = "WEB-PPT";
  pptx.subject = deck.title;
  pptx.title = deck.title;

  for (const slideModel of deck.slides) {
    const slide = pptx.addSlide();

    slide.background = { color: cssColorToPptx(slideModel.bgColor, "FFFFFF") };
    slide.addText(slideModel.title || "Untitled", {
      x: 0.5,
      y: 0.2,
      w: 12,
      h: 0.6,
      bold: true,
      fontSize: 24,
      color: "1E293B"
    });

    for (const element of slideModel.elements) {
      const x = (element.x ?? 0) / 96;
      const y = (element.y ?? 0) / 96;
      const w = Math.max((element.width ?? 80) / 96, 0.1);
      const h = Math.max((element.height ?? 40) / 96, 0.1);

      if (element.type === "text") {
        slide.addText(element.content?.text || "", {
          x,
          y,
          w,
          h,
          fontSize: element.style?.fontSize || 18,
          bold: Boolean((element.style?.fontWeight || 400) >= 600),
          color: cssColorToPptx(element.style?.color, "0F172A"),
          align: element.style?.textAlign || "left"
        });
        continue;
      }

      if (element.type === "shape") {
        const kind = element.content?.shapeKind || "rect";
        const shapeType =
          kind === "circle"
            ? pptx.ShapeType.ellipse
            : kind === "triangle"
              ? pptx.ShapeType.rtTriangle
              : kind === "diamond"
                ? pptx.ShapeType.diamond
                : kind === "roundRect"
                  ? pptx.ShapeType.roundRect
                  : pptx.ShapeType.rect;

        slide.addShape(shapeType, {
          x,
          y,
          w,
          h,
          fill: { color: cssColorToPptx(element.style?.fill, "E2E8F0"), transparency: (1 - (element.style?.opacity ?? 1)) * 100 },
          line: {
            color: cssColorToPptx(element.style?.stroke, "334155"),
            pt: element.style?.strokeWidth || 1
          }
        });
        continue;
      }

      if (element.type === "image") {
        const image = normalizeImageData(element.content?.src);
        if (image.data || image.path) {
          slide.addImage({
            ...(image.data ? { data: image.data } : { path: image.path! }),
            x,
            y,
            w,
            h
          });
        }
      }
    }
  }

  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await pptx.writeFile({ fileName: outputPath });
}

export async function closeBrowser(): Promise<void> {
  if (browser) {
    await browser.close();
    browser = null;
  }
}
