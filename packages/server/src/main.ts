import Fastify from "fastify";
import cors from "@fastify/cors";
import websocket from "@fastify/websocket";
import { deckRoutes } from "./routes/decks";
import { markdownRoutes } from "./routes/markdown";
import { aiRoutes } from "./routes/ai";
import { exportRoutes } from "./routes/exports";
import { attachClient } from "./collab/hub";

async function buildServer() {
  const app = Fastify({ logger: true });

  await app.register(cors, {
    origin: true
  });
  await app.register(websocket);

  app.get("/health", async () => ({ status: "ok" }));

  await app.register(deckRoutes, { prefix: "/api" });
  await app.register(markdownRoutes, { prefix: "/api" });
  await app.register(aiRoutes, { prefix: "/api" });
  await app.register(exportRoutes, { prefix: "/api" });

  app.get("/ws/collab", { websocket: true }, (socket, request) => {
    const query = request.query as Record<string, string | undefined>;
    attachClient(socket, {
      deckId: query.deckId || "",
      userId: query.userId || "anonymous",
      userName: query.userName || "Anonymous",
      role: (query.role as "owner" | "editor" | "viewer") || "editor"
    });
  });

  return app;
}

async function start() {
  const app = await buildServer();
  const port = Number(process.env.PORT ?? 4000);
  const host = process.env.HOST ?? "0.0.0.0";

  try {
    await app.listen({ port, host });
  } catch (error) {
    app.log.error(error);
    process.exit(1);
  }
}

start();
