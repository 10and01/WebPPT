import * as Y from "yjs";
function toBase64(data) {
    let binary = "";
    for (let i = 0; i < data.length; i += 1) {
        binary += String.fromCharCode(data[i]);
    }
    return btoa(binary);
}
function fromBase64(value) {
    const binary = atob(value);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) {
        bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
}
export function createCollabClient(input) {
    const doc = new Y.Doc();
    const deckText = doc.getText("deck");
    let socket = null;
    let presenceCb = () => { };
    doc.on("update", (update, origin) => {
        if (origin === "remote") {
            return;
        }
        if (!socket || socket.readyState !== WebSocket.OPEN) {
            return;
        }
        socket.send(JSON.stringify({
            type: "update",
            payload: { update: toBase64(update) }
        }));
    });
    return {
        doc,
        connect() {
            const protocol = location.protocol === "https:" ? "wss" : "ws";
            const base = input.wsBase || `${protocol}://${location.host}`;
            const url = `${base}/ws/collab?deckId=${encodeURIComponent(input.deckId)}&userId=${encodeURIComponent(input.userId)}&userName=${encodeURIComponent(input.userName)}&role=${input.role}`;
            socket = new WebSocket(url);
            socket.onmessage = (event) => {
                const message = JSON.parse(String(event.data));
                if (message.type === "sync") {
                    const update = fromBase64(message.payload.update);
                    Y.applyUpdate(doc, update, "remote");
                    presenceCb(message.payload.collaborators || []);
                }
                if (message.type === "update") {
                    const update = fromBase64(message.payload.update);
                    Y.applyUpdate(doc, update, "remote");
                }
                if (message.type === "presence") {
                    presenceCb(message.payload.collaborators || []);
                }
            };
        },
        disconnect() {
            socket?.close();
            socket = null;
        },
        setDeck(deck) {
            const next = JSON.stringify(deck);
            doc.transact(() => {
                deckText.delete(0, deckText.length);
                deckText.insert(0, next);
            }, "local");
        },
        onPresenceChange(cb) {
            presenceCb = cb;
        },
        sendCursor(x, y, activeSlideId) {
            if (!socket || socket.readyState !== WebSocket.OPEN) {
                return;
            }
            socket.send(JSON.stringify({
                type: "cursor",
                payload: { x, y, activeSlideId }
            }));
        }
    };
}
export function readDeckFromDoc(doc) {
    try {
        const text = doc.getText("deck").toString();
        if (!text) {
            return null;
        }
        return JSON.parse(text);
    }
    catch {
        return null;
    }
}
