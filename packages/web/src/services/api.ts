import type {
  AddSlideRequest,
  AppendSlideMarkdownRequest,
  AISlideEditRequest,
  AIConfig,
  CreateDeckRequest,
  DeckThemeTemplate,
  Deck,
  ElementModel,
  ExportDeckRequest,
  ExportJob,
  GenerateDeckFromOutlineRequest,
  GenerateDeckRequest,
  ImportMarkdownRequest,
  OverwriteSlideMarkdownRequest,
  PolishTextRequest,
  SlideMarkdownReadResponse,
  Slide
} from "@web-ppt/shared";

const API_BASE = "/api";

async function readErrorMessage(response: Response, fallback: string): Promise<string> {
  const cloned = response.clone();

  try {
    const payload = (await response.json()) as { message?: string; error?: string };
    if (payload?.message && typeof payload.message === "string") {
      return payload.message;
    }
    if (payload?.error && typeof payload.error === "string") {
      return payload.error;
    }
  } catch {
    // ignore parsing errors and use fallback
  }

  try {
    const text = (await cloned.text()).trim();
    if (text) {
      return text;
    }
  } catch {
    // ignore parsing errors and use fallback
  }

  return `${fallback} (HTTP ${response.status})`;
}

export async function listDecks(): Promise<Deck[]> {
  const response = await fetch(`${API_BASE}/decks`);
  if (!response.ok) {
    throw new Error("Failed to load decks");
  }

  const data = (await response.json()) as { decks: Deck[] };
  return data.decks;
}

export async function createDeck(input: CreateDeckRequest): Promise<Deck> {
  const response = await fetch(`${API_BASE}/decks`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input)
  });

  if (!response.ok) {
    throw new Error("Failed to create deck");
  }

  const data = (await response.json()) as { deck: Deck };
  return data.deck;
}

export async function addSlide(deckId: string, input: AddSlideRequest): Promise<Slide> {
  const response = await fetch(`${API_BASE}/decks/${deckId}/slides`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input)
  });

  if (!response.ok) {
    throw new Error("Failed to add slide");
  }

  const data = (await response.json()) as { slide: Slide };
  return data.slide;
}

export async function deleteSlide(deckId: string, slideId: string): Promise<Deck> {
  const response = await fetch(`${API_BASE}/decks/${deckId}/slides/${slideId}`, {
    method: "DELETE"
  });

  if (!response.ok) {
    throw new Error(await readErrorMessage(response, "Failed to delete slide"));
  }

  const data = (await response.json()) as { deck: Deck };
  return data.deck;
}

export async function replaceSlideElements(
  deckId: string,
  slideId: string,
  elements: ElementModel[]
): Promise<Slide> {
  const response = await fetch(`${API_BASE}/decks/${deckId}/slides/${slideId}/elements`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ elements })
  });

  if (!response.ok) {
    const errorMsg = await readErrorMessage(response, "Failed to save slide");
    console.error("Save slide failed:", {
      status: response.status,
      deckId,
      slideId,
      elementCount: elements.length,
      error: errorMsg
    });
    throw new Error(errorMsg);
  }

  const data = (await response.json()) as { slide: Slide };
  return data.slide;
}

export async function updateAIConfig(deckId: string, aiConfig: Partial<AIConfig>): Promise<Deck> {
  const response = await fetch(`${API_BASE}/decks/${deckId}/ai-config`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ aiConfig })
  });

  if (!response.ok) {
    throw new Error("Failed to update AI config");
  }

  const data = (await response.json()) as { deck: Deck };
  return data.deck;
}

export async function generateDeckDraft(deckId: string, input: GenerateDeckRequest) {
  const response = await fetch(`${API_BASE}/ai/decks/${deckId}/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input)
  });

  if (!response.ok) {
    throw new Error(await readErrorMessage(response, "Failed to generate draft"));
  }

  return (await response.json()) as {
    draft: {
      title: string;
      slideDrafts: Array<{
        title: string;
        bullets: string[];
        markdown: string;
        bgColor: string;
        visualHint: string;
      }>;
    };
  };
}

export async function testAIConnection(aiConfig: Partial<AIConfig>) {
  const response = await fetch(`${API_BASE}/ai/test-connection`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ aiConfig })
  });

  if (!response.ok) {
    throw new Error(await readErrorMessage(response, "Failed to test AI connection"));
  }

  return (await response.json()) as { ok: boolean; provider: string; model: string; message: string };
}

export async function polishSelectedText(deckId: string, input: PolishTextRequest) {
  const response = await fetch(`${API_BASE}/ai/decks/${deckId}/polish`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input)
  });

  if (!response.ok) {
    throw new Error(await readErrorMessage(response, "Failed to polish text"));
  }

  return (await response.json()) as { content: string };
}

export async function suggestVisuals(deckId: string, text: string) {
  const response = await fetch(`${API_BASE}/ai/decks/${deckId}/visuals`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ markdown: text })
  });

  if (!response.ok) {
    throw new Error(await readErrorMessage(response, "Failed to get visual suggestions"));
  }

  return (await response.json()) as { suggestions: string[] };
}

export async function importMarkdown(deckId: string, input: ImportMarkdownRequest): Promise<Deck> {
  const response = await fetch(`${API_BASE}/decks/${deckId}/import-markdown`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input)
  });

  if (!response.ok) {
    throw new Error("Failed to import markdown");
  }

  const data = (await response.json()) as { deck: Deck };
  return data.deck;
}

export async function readPageMarkdown(deckId: string, pageNumber: number): Promise<SlideMarkdownReadResponse> {
  const response = await fetch(`${API_BASE}/decks/${deckId}/pages/${pageNumber}/markdown`);
  if (!response.ok) {
    throw new Error(await readErrorMessage(response, "Failed to read page markdown"));
  }

  return (await response.json()) as SlideMarkdownReadResponse;
}

export async function overwritePageMarkdown(
  deckId: string,
  pageNumber: number,
  input: OverwriteSlideMarkdownRequest
): Promise<{ pageNumber: number; slideId: string; markdown: string; deck: Deck }> {
  const response = await fetch(`${API_BASE}/decks/${deckId}/pages/${pageNumber}/markdown`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input)
  });

  if (!response.ok) {
    throw new Error(await readErrorMessage(response, "Failed to overwrite page markdown"));
  }

  return (await response.json()) as { pageNumber: number; slideId: string; markdown: string; deck: Deck };
}

export async function appendPageMarkdown(
  deckId: string,
  input: AppendSlideMarkdownRequest
): Promise<{ pageNumber: number; slideId: string; markdown: string; deck: Deck }> {
  const response = await fetch(`${API_BASE}/decks/${deckId}/pages/append-markdown`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input)
  });

  if (!response.ok) {
    throw new Error(await readErrorMessage(response, "Failed to append page markdown"));
  }

  return (await response.json()) as { pageNumber: number; slideId: string; markdown: string; deck: Deck };
}

export async function generateRichMarkdown(deckId: string, topic: string, requirements: string) {
  const response = await fetch(`${API_BASE}/ai/decks/${deckId}/generate-markdown`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ topic, requirements })
  });

  if (!response.ok) {
    throw new Error(await readErrorMessage(response, "Failed to generate markdown"));
  }

  return (await response.json()) as { markdown: string };
}

export async function generateDeckByOutline(
  deckId: string,
  input: GenerateDeckFromOutlineRequest
): Promise<{
  outline: {
    topic: string;
    themeTemplate: DeckThemeTemplate;
    slides: Array<{
      index: number;
      title: string;
      objective: string;
      keyPoints: string[];
      visualStrategy: string;
    }>;
  };
  slides: Array<{ slideId: string; slideNumber: number; title: string; markdown: string }>;
  deck: Deck;
}> {
  const response = await fetch(`${API_BASE}/ai/decks/${deckId}/generate-by-outline`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input)
  });

  if (!response.ok) {
    throw new Error(await readErrorMessage(response, "Failed to generate deck by outline"));
  }

  return (await response.json()) as {
    outline: {
      topic: string;
      themeTemplate: DeckThemeTemplate;
      slides: Array<{
        index: number;
        title: string;
        objective: string;
        keyPoints: string[];
        visualStrategy: string;
      }>;
    };
    slides: Array<{ slideId: string; slideNumber: number; title: string; markdown: string }>;
    deck: Deck;
  };
}

export async function rewriteSlideWithAI(deckId: string, slideId: string, input: AISlideEditRequest) {
  const response = await fetch(`${API_BASE}/ai/decks/${deckId}/slides/${slideId}/rewrite`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input)
  });

  if (!response.ok) {
    throw new Error(await readErrorMessage(response, "Failed to rewrite slide"));
  }

  return (await response.json()) as { markdown: string; deck: Deck };
}

export async function startExport(input: ExportDeckRequest) {
  const response = await fetch(`${API_BASE}/exports`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input)
  });

  if (!response.ok) {
    throw new Error("Failed to start export");
  }

  return (await response.json()) as { job: ExportJob };
}

export async function getExportJob(jobId: string) {
  const response = await fetch(`${API_BASE}/exports/${jobId}`);
  if (!response.ok) {
    throw new Error("Failed to read export job");
  }

  return (await response.json()) as { job: ExportJob };
}
