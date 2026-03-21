import type { WebSocket } from "ws";
import * as Y from "yjs";
import { sessionStore } from "../data/session-store";

interface ClientInfo {
  deckId: string;
  userId: string;
  userName: string;
  role: "owner" | "editor" | "viewer";
  socket: WebSocket;
  activeSlideId?: string;
  lastHeartbeat: number;
}

const docs = new Map<string, Y.Doc>();
const clients = new Set<ClientInfo>();

function getDoc(deckId: string): Y.Doc {
  let doc = docs.get(deckId);
  if (!doc) {
    doc = new Y.Doc();

    // Try to restore from snapshot
    const snapshot = sessionStore.getDocSnapshot(deckId);
    if (snapshot && snapshot.yState) {
      try {
        Y.applyUpdate(doc, snapshot.yState);
      } catch {
        // If restoration fails, start fresh
        docs.set(deckId, doc);
      }
    }

    docs.set(deckId, doc);
  }
  return doc;
}

function broadcast(deckId: string, data: string, except?: WebSocket) {
  for (const client of clients) {
    if (client.deckId !== deckId || client.socket === except || client.socket.readyState !== 1) {
      continue;
    }
    try {
      client.socket.send(data);
    } catch {
      // Socket may be closed
    }
  }
}

function buildPresence(deckId: string) {
  return [...clients]
    .filter((client) => client.deckId === deckId)
    .map((client) => ({
      userId: client.userId,
      userName: client.userName,
      role: client.role,
      activeSlideId: client.activeSlideId
    }));
}

// Cleanup disconnected clients periodically
setInterval(() => {
  const now = Date.now();
  const deadClients: ClientInfo[] = [];

  for (const client of clients) {
    if (now - client.lastHeartbeat > 60000) {
      // 60 seconds timeout
      deadClients.push(client);
    }
  }

  for (const client of deadClients) {
    clients.delete(client);
    sessionStore.saveSessionState(client.deckId, client.userId, getDoc(client.deckId));
    broadcast(
      client.deckId,
      JSON.stringify({ type: "presence", payload: { collaborators: buildPresence(client.deckId) } })
    );
  }

  // Clean old sessions
  sessionStore.cleanOldSessions();
}, 30000);

export function attachClient(
  socket: WebSocket,
  input: { deckId: string; userId: string; userName: string; role: "owner" | "editor" | "viewer" }
) {
  const info: ClientInfo = { ...input, socket, lastHeartbeat: Date.now() };
  clients.add(info);
  const doc = getDoc(input.deckId);

  const update = Y.encodeStateAsUpdate(doc);

  socket.send(
    JSON.stringify({
      type: "sync",
      payload: {
        update: Buffer.from(update).toString("base64"),
        collaborators: buildPresence(input.deckId),
        deckId: input.deckId,
        userId: input.userId
      }
    })
  );

  broadcast(
    input.deckId,
    JSON.stringify({ type: "presence", payload: { collaborators: buildPresence(input.deckId) } }),
    socket
  );

  socket.on("message", (raw) => {
    try {
      info.lastHeartbeat = Date.now();
      const message = JSON.parse(String(raw));

      if (message.type === "update") {
        if (info.role === "viewer") {
          socket.send(JSON.stringify({ type: "error", payload: { message: "viewer cannot edit" } }));
          return;
        }

        const binary = Buffer.from(message.payload.update, "base64");
        Y.applyUpdate(doc, binary);

        // Periodically save session state
        if (Math.random() < 0.1) {
          sessionStore.saveSessionState(input.deckId, input.userId, doc);
        }

        broadcast(input.deckId, JSON.stringify({ type: "update", payload: message.payload }), socket);
        return;
      }

      if (message.type === "page") {
        // Track which slide user is viewing
        info.activeSlideId = message.payload.slideId;
        broadcast(
          input.deckId,
          JSON.stringify({
            type: "presence",
            payload: {
              collaborators: buildPresence(input.deckId),
              activePageNotification: {
                userId: info.userId,
                userName: info.userName,
                slideId: message.payload.slideId
              }
            }
          }),
          socket
        );
        return;
      }

      if (message.type === "cursor") {
        broadcast(
          input.deckId,
          JSON.stringify({
            type: "cursor",
            payload: { ...message.payload, userId: info.userId, userName: info.userName }
          }),
          socket
        );
      }

      if (message.type === "ping") {
        socket.send(JSON.stringify({ type: "pong", payload: {} }));
      }
    } catch {
      try {
        socket.send(JSON.stringify({ type: "error", payload: { message: "invalid message" } }));
      } catch {
        // Socket may be closed
      }
    }
  });

  socket.on("close", () => {
    clients.delete(info);
    // Save final state for recovery
    sessionStore.saveSessionState(input.deckId, input.userId, doc);
    broadcast(input.deckId, JSON.stringify({ type: "presence", payload: { collaborators: buildPresence(input.deckId) } }));
  });

  socket.on("error", () => {
    clients.delete(info);
  });
}
