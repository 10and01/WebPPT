const API_BASE = "/api";
export async function listDecks() {
    const response = await fetch(`${API_BASE}/decks`);
    if (!response.ok) {
        throw new Error("Failed to load decks");
    }
    const data = (await response.json());
    return data.decks;
}
export async function createDeck(input) {
    const response = await fetch(`${API_BASE}/decks`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input)
    });
    if (!response.ok) {
        throw new Error("Failed to create deck");
    }
    const data = (await response.json());
    return data.deck;
}
export async function addSlide(deckId, input) {
    const response = await fetch(`${API_BASE}/decks/${deckId}/slides`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input)
    });
    if (!response.ok) {
        throw new Error("Failed to add slide");
    }
    const data = (await response.json());
    return data.slide;
}
export async function replaceSlideElements(deckId, slideId, elements) {
    const response = await fetch(`${API_BASE}/decks/${deckId}/slides/${slideId}/elements`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ elements })
    });
    if (!response.ok) {
        throw new Error("Failed to save slide");
    }
    const data = (await response.json());
    return data.slide;
}
export async function updateAIConfig(deckId, aiConfig) {
    const response = await fetch(`${API_BASE}/decks/${deckId}/ai-config`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ aiConfig })
    });
    if (!response.ok) {
        throw new Error("Failed to update AI config");
    }
    const data = (await response.json());
    return data.deck;
}
export async function generateDeckDraft(deckId, input) {
    const response = await fetch(`${API_BASE}/ai/decks/${deckId}/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input)
    });
    if (!response.ok) {
        throw new Error("Failed to generate draft");
    }
    return (await response.json());
}
export async function polishSelectedText(deckId, input) {
    const response = await fetch(`${API_BASE}/ai/decks/${deckId}/polish`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input)
    });
    if (!response.ok) {
        throw new Error("Failed to polish text");
    }
    return (await response.json());
}
export async function suggestVisuals(deckId, text) {
    const response = await fetch(`${API_BASE}/ai/decks/${deckId}/visuals`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ markdown: text })
    });
    if (!response.ok) {
        throw new Error("Failed to get visual suggestions");
    }
    return (await response.json());
}
export async function importMarkdown(deckId, input) {
    const response = await fetch(`${API_BASE}/decks/${deckId}/import-markdown`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input)
    });
    if (!response.ok) {
        throw new Error("Failed to import markdown");
    }
    const data = (await response.json());
    return data.deck;
}
export async function startExport(input) {
    const response = await fetch(`${API_BASE}/exports`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input)
    });
    if (!response.ok) {
        throw new Error("Failed to start export");
    }
    return (await response.json());
}
export async function getExportJob(jobId) {
    const response = await fetch(`${API_BASE}/exports/${jobId}`);
    if (!response.ok) {
        throw new Error("Failed to read export job");
    }
    return (await response.json());
}
