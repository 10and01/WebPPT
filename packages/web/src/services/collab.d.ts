import * as Y from "yjs";
import type { CollaboratorPresence, Deck } from "@web-ppt/shared";
export interface CollabClient {
    connect(): void;
    disconnect(): void;
    doc: Y.Doc;
    setDeck(deck: Deck): void;
    onPresenceChange(cb: (collaborators: CollaboratorPresence[]) => void): void;
    sendCursor(x: number, y: number, activeSlideId?: string): void;
}
export declare function createCollabClient(input: {
    wsBase: string;
    deckId: string;
    userId: string;
    userName: string;
    role: "owner" | "editor" | "viewer";
}): CollabClient;
export declare function readDeckFromDoc(doc: Y.Doc): Deck | null;
