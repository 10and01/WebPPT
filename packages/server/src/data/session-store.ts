import type { SessionRecoveryState } from "@web-ppt/shared";
import * as Y from "yjs";

// In-memory session store - in production, would use Redis or similar
const sessionStates = new Map<string, SessionRecoveryState>();
const docSnapshots = new Map<string, { yState: Uint8Array; version: number; timestamp: number }>();
const deckVersions = new Map<string, number>();

function nextVersion(deckId: string): number {
  const current = deckVersions.get(deckId) ?? 0;
  const next = current + 1;
  deckVersions.set(deckId, next);
  return next;
}

export const sessionStore = {
  // Save session state for recovery
  saveSessionState(deckId: string, userId: string, yDoc: Y.Doc) {
    const key = `${deckId}:${userId}`;
    const update = Y.encodeStateAsUpdate(yDoc);
    const version = nextVersion(deckId);

    sessionStates.set(key, {
      deckId,
      userId,
      yStateBase64: Buffer.from(update).toString("base64"),
      version,
      timestamp: Date.now()
    });

    // Also store snapshot for faster full restoration
    docSnapshots.set(deckId, {
      yState: update,
      version,
      timestamp: Date.now()
    });
  },

  // Retrieve session state for recovery
  getSessionState(deckId: string, userId: string): SessionRecoveryState | undefined {
    const key = `${deckId}:${userId}`;
    return sessionStates.get(key);
  },

  // Retrieve doc snapshot for faster restoration
  getDocSnapshot(deckId: string) {
    return docSnapshots.get(deckId);
  },

  // Clean old sessions
  cleanOldSessions(maxAgeMs: number = 24 * 60 * 60 * 1000) {
    const now = Date.now();
    for (const [key, state] of sessionStates) {
      if (now - state.timestamp > maxAgeMs) {
        sessionStates.delete(key);
      }
    }
  },

  // Clear session
  clearSession(deckId: string, userId: string) {
    const key = `${deckId}:${userId}`;
    sessionStates.delete(key);
  },

  // Get all users in a session
  getUsersInSession(deckId: string): string[] {
    const users: string[] = [];
    for (const key of sessionStates.keys()) {
      if (key.startsWith(deckId)) {
        const userId = key.split(":")[1];
        if (userId) users.push(userId);
      }
    }
    return users;
  }
};
