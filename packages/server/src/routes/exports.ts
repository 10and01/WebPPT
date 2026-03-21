import { promises as fs } from "node:fs";
import { createReadStream } from "node:fs";
import path from "node:path";
import { nanoid } from "nanoid";
import type { FastifyInstance } from "fastify";
import type { ExportDeckRequest, ExportJob } from "@web-ppt/shared";
import { deckStore } from "../data/deck-store";
import { exportToPdf, exportToPng, exportToPptx } from "../services/export";

const jobs = new Map<string, ExportJob>();
const jobArtifacts = new Map<string, { singleFile?: string; files?: string[] }>();

const exportDir = path.join(process.cwd(), "exports");

async function ensureDir() {
  await fs.mkdir(exportDir, { recursive: true });
}

function toHtml(deckTitle: string, slidesHtml: string): string {
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${deckTitle}</title>
  <style>
    body { margin: 0; font-family: Segoe UI, sans-serif; background: #f3f6fb; }
    .slide { width: 960px; min-height: 540px; margin: 20px auto; background: #fff; padding: 48px; border-radius: 16px; box-shadow: 0 8px 32px rgba(15, 23, 42, 0.12); }
    h1 { margin-top: 0; }
    .item { margin: 10px 0; }
  </style>
</head>
<body>
${slidesHtml}
</body>
</html>`;
}

export async function exportRoutes(app: FastifyInstance): Promise<void> {
  app.post<{ Body: ExportDeckRequest }>("/exports", async (request, reply) => {
    const payload = request.body as ExportDeckRequest;
    const deck = deckStore.getById(payload.deckId);
    if (!deck) {
      return reply.code(404).send({ message: "deck not found" });
    }

    const id = nanoid();
    const now = Date.now();
    const job: ExportJob = {
      id,
      deckId: deck.id,
      format: payload.format,
      status: "pending",
      createdAt: now,
      updatedAt: now
    };
    jobs.set(id, job);

    void (async () => {
      try {
        job.status = "processing";
        job.updatedAt = Date.now();
        await ensureDir();

        if (payload.format === "html") {
          const slidesHtml = deck.slides
            .map((slide) => {
              const lines = slide.elements
                .filter((element) => element.type === "text")
                .map((element) => `<div class=\"item\">${element.content?.text || ""}</div>`)
                .join("\n");
              return `<section class=\"slide\"><h1>${slide.title}</h1>${lines}</section>`;
            })
            .join("\n");

          const fileName = `${deck.id}-${Date.now()}.html`;
          const filePath = path.join(exportDir, fileName);
          await fs.writeFile(filePath, toHtml(deck.title, slidesHtml), "utf8");
          jobArtifacts.set(job.id, { singleFile: filePath });
          job.outputPath = `/api/exports/${job.id}/download`;
          job.status = "completed";
          job.updatedAt = Date.now();
          return;
        }

        if (payload.format === "pdf") {
          const fileName = `${deck.id}-${Date.now()}.pdf`;
          const filePath = path.join(exportDir, fileName);
          await exportToPdf(deck, filePath);
          jobArtifacts.set(job.id, { singleFile: filePath });
          job.outputPath = `/api/exports/${job.id}/download`;
          job.status = "completed";
          job.updatedAt = Date.now();
          return;
        }

        if (payload.format === "pptx") {
          const fileName = `${deck.id}-${Date.now()}.pptx`;
          const filePath = path.join(exportDir, fileName);
          await exportToPptx(deck, filePath);
          jobArtifacts.set(job.id, { singleFile: filePath });
          job.outputPath = `/api/exports/${job.id}/download`;
          job.status = "completed";
          job.updatedAt = Date.now();
          return;
        }

        if (payload.format === "png") {
          const dirName = `${deck.id}-${Date.now()}`;
          const dirPath = path.join(exportDir, dirName);
          const files = await exportToPng(deck, dirPath);
          jobArtifacts.set(job.id, { files });
          job.outputPath = `/api/exports/${job.id}/files`;
          job.outputFiles = files.map((_, index) => `/api/exports/${job.id}/files/${index}`);
          job.status = "completed";
          job.updatedAt = Date.now();
          return;
        }

        job.status = "failed";
        job.message = `${payload.format} export format not supported`;
        job.updatedAt = Date.now();
      } catch (error) {
        job.status = "failed";
        job.message = (error as Error).message;
        job.updatedAt = Date.now();
      }
    })();

    return reply.code(202).send({ job });
  });

  app.get<{ Params: { jobId: string } }>("/exports/:jobId", async (request, reply) => {
    const job = jobs.get(request.params.jobId);
    if (!job) {
      return reply.code(404).send({ message: "job not found" });
    }

    return { job };
  });

  app.get<{ Params: { jobId: string } }>("/exports/:jobId/download", async (request, reply) => {
    const artifact = jobArtifacts.get(request.params.jobId);
    if (!artifact?.singleFile) {
      return reply.code(404).send({ message: "download not found" });
    }

    const filePath = artifact.singleFile;
    const fileName = path.basename(filePath);
    const ext = path.extname(filePath).toLowerCase();
    const contentType =
      ext === ".pdf"
        ? "application/pdf"
        : ext === ".pptx"
          ? "application/vnd.openxmlformats-officedocument.presentationml.presentation"
          : "text/html; charset=utf-8";

    reply.header("Content-Type", contentType);
    reply.header("Content-Disposition", `attachment; filename=\"${fileName}\"`);
    return reply.send(createReadStream(filePath));
  });

  app.get<{ Params: { jobId: string } }>("/exports/:jobId/files", async (request, reply) => {
    const artifact = jobArtifacts.get(request.params.jobId);
    if (!artifact?.files?.length) {
      return reply.code(404).send({ message: "files not found" });
    }

    return {
      files: artifact.files.map((_, index) => `/api/exports/${request.params.jobId}/files/${index}`)
    };
  });

  app.get<{ Params: { jobId: string; index: string } }>("/exports/:jobId/files/:index", async (request, reply) => {
    const artifact = jobArtifacts.get(request.params.jobId);
    const index = Number(request.params.index);
    const filePath = artifact?.files?.[index];

    if (!filePath) {
      return reply.code(404).send({ message: "file not found" });
    }

    const fileName = path.basename(filePath);
    reply.header("Content-Type", "image/png");
    reply.header("Content-Disposition", `attachment; filename=\"${fileName}\"`);
    return reply.send(createReadStream(filePath));
  });
}
