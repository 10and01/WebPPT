<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { nanoid } from "nanoid";
import { marked } from "marked";
import type {
  CollaboratorPresence,
  Deck,
  DeckOrchestrationMode,
  DeckThemeTemplate,
  ElementModel,
  Slide,
  SlideAgentTeamWorkflowEvent
} from "@web-ppt/shared";
import {
  addSlide,
  createDeck,
  deleteSlide,
  generateDeckByOutline,
  getExportJob,
  importMarkdown,
  listDecks,
  polishSelectedText,
  replaceSlideElements,
  rewriteSlideWithAI,
  startExport,
  testAIConnection,
  updateAIConfig
} from "./services/api";
import { createCollabClient, readDeckFromDoc } from "./services/collab";

const decks = ref<Deck[]>([]);
const activeDeckId = ref("");
const activeSlideId = ref("");
const selectedElementId = ref("");
const collaborators = ref<CollaboratorPresence[]>([]);
const error = ref("");
const status = ref("idle");
const codeText = ref("[]");
const codeChecksum = ref("");
const canvasChecksum = ref("");
const conflictMessage = ref("");
const markdownInput = ref("# 数据分析报告\n\n- 结论一\n- 结论二");
const aiGenerateRequirements = ref("主标题：\n副标题：\n主要内容点（每行一个）");
const aiSlideInstruction = ref("请在当前页添加一张图片并美化背景，保持内容专业简洁");
const aiTopic = ref("介绍碳中和的商业模式");
const aiThemeTemplate = ref<DeckThemeTemplate>("business");
const aiOrchestrationMode = ref<DeckOrchestrationMode>("auto");
const aiProvider = ref<"openai" | "anthropic">("openai");
const aiModel = ref("gpt-4.1-mini");
const aiApiKey = ref("");
const aiApiEndpoint = ref("");
const aiTestMessage = ref("");
const aiWorkflow = ref<SlideAgentTeamWorkflowEvent[]>([]);
const aiWorkflowIssues = ref<Array<{ code: string; stage: string; message: string; slideIndex?: number; retryHint?: string }>>([]);
const aiWorkflowMode = ref<"agent-team" | "single-agent" | "-">("-");
const aiWorkflowFallback = ref(false);
const aiWorkflowIntegrityError = ref("");
const collabEnabled = ref(false);
const role = ref<"editor" | "viewer">("editor");
const currentUserId = `user-${Math.random().toString(36).slice(2, 7)}`;
const currentUserName = `U-${Math.random().toString(36).slice(2, 6)}`;
const exportState = ref("-");
const exportLinks = ref<string[]>([]);
const uploadInputRef = ref<HTMLInputElement | null>(null);

let collabClient: ReturnType<typeof createCollabClient> | null = null;
let codeDebounce: ReturnType<typeof setTimeout> | null = null;
let saveDebounce: ReturnType<typeof setTimeout> | null = null;

const AI_SETTINGS_STORAGE_KEY = "webppt.ai.settings.v1";

type PersistedAISettings = {
  provider: "openai" | "anthropic";
  model: string;
  apiEndpoint: string;
  apiKey: string;
};

function readPersistedAISettings(): PersistedAISettings | null {
  try {
    const raw = localStorage.getItem(AI_SETTINGS_STORAGE_KEY);
    if (!raw) {
      return null;
    }

    const parsed = JSON.parse(raw) as Partial<PersistedAISettings>;
    const provider = parsed.provider === "anthropic" ? "anthropic" : "openai";
    return {
      provider,
      model: typeof parsed.model === "string" ? parsed.model : "",
      apiEndpoint: typeof parsed.apiEndpoint === "string" ? parsed.apiEndpoint : "",
      apiKey: typeof parsed.apiKey === "string" ? parsed.apiKey : ""
    };
  } catch {
    return null;
  }
}

function persistAISettings() {
  const payload: PersistedAISettings = {
    provider: aiProvider.value,
    model: aiModel.value,
    apiEndpoint: aiApiEndpoint.value,
    apiKey: aiApiKey.value
  };

  localStorage.setItem(AI_SETTINGS_STORAGE_KEY, JSON.stringify(payload));
}

function getPreferredAIConfig() {
  return {
    provider: aiProvider.value,
    model: aiModel.value.trim() || undefined,
    apiKey: aiApiKey.value.trim() || undefined,
    apiEndpoint: aiApiEndpoint.value.trim() || undefined
  };
}

function hashText(text: string): string {
  let h = 0;
  for (let i = 0; i < text.length; i += 1) {
    h = (h << 5) - h + text.charCodeAt(i);
    h |= 0;
  }
  return String(h);
}

const activeDeck = computed(() => decks.value.find((deck) => deck.id === activeDeckId.value) || null);
const activeSlide = computed(
  () => activeDeck.value?.slides.find((slide) => slide.id === activeSlideId.value) || null
);
const markdownPreviewHtml = computed(() => {
  try {
    return marked.parse(markdownInput.value || "") as string;
  } catch {
    return "<p>Markdown parse failed.</p>";
  }
});

function validateWorkflowSequence(events: SlideAgentTeamWorkflowEvent[]): string {
  const stageOrder = ["outline", "copy", "background", "layout", "compose", "fallback"];
  let last = -1;

  for (const event of events) {
    if (event.endedAt < event.startedAt || event.durationMs < 0) {
      return `Invalid timing on stage: ${event.stage}`;
    }

    const current = stageOrder.indexOf(event.stage);
    if (current < last) {
      return `Invalid stage order at: ${event.stage}`;
    }
    last = current;
  }

  return "";
}

function normalizeWorkflow(events: SlideAgentTeamWorkflowEvent[]): SlideAgentTeamWorkflowEvent[] {
  return [...events].sort((a, b) => a.startedAt - b.startedAt || a.endedAt - b.endedAt);
}

function assertValidOrchestrationMode(mode: DeckOrchestrationMode): void {
  const allowed: DeckOrchestrationMode[] = ["auto", "agent-team", "single-agent"];
  if (!allowed.includes(mode)) {
    throw new Error(`Invalid orchestration mode: ${mode}`);
  }
}

function formatDuration(durationMs: number): string {
  if (durationMs < 1000) {
    return `${durationMs}ms`;
  }
  return `${(durationMs / 1000).toFixed(2)}s`;
}

function getWorkflowStatusClass(status: SlideAgentTeamWorkflowEvent["status"]): string {
  if (status === "succeeded") {
    return "ok";
  }
  if (status === "failed") {
    return "fail";
  }
  if (status === "skipped") {
    return "skip";
  }
  return "run";
}
const activeSlideBackgroundDoc = computed(() => {
  const raw = activeSlide.value?.bgHtml?.trim();
  if (!raw) {
    return "";
  }

  return `<!doctype html><html><head><meta charset=\"utf-8\"><style>html,body{margin:0;padding:0;width:100%;height:100%;overflow:hidden;background:transparent;}*{box-sizing:border-box;}</style></head><body>${raw}</body></html>`;
});
const selectedElement = computed(
  () => activeSlide.value?.elements.find((element) => element.id === selectedElementId.value) || null
);

watch(
  activeDeck,
  (deck) => {
    const persisted = readPersistedAISettings();
    const provider = (deck?.aiConfig.provider === "anthropic" ? "anthropic" : "openai") as "openai" | "anthropic";
    const modelFallback = provider === "anthropic" ? "claude-3-5-haiku-20241022" : "gpt-4.1-mini";

    aiProvider.value = provider;
    aiModel.value = deck?.aiConfig.model || persisted?.model || modelFallback;
    aiApiEndpoint.value = deck?.aiConfig.apiEndpoint || persisted?.apiEndpoint || "";
    aiApiKey.value = deck?.aiConfig.apiKey || persisted?.apiKey || "";

    aiTestMessage.value = "";
  },
  { immediate: true }
);

watch([aiProvider, aiModel, aiApiEndpoint, aiApiKey], () => {
  persistAISettings();
});

type ShapeKind = "rect" | "roundRect" | "circle" | "triangle" | "diamond";

function makeDefaultStyle() {
  return {
    fill: "#e2e8f0",
    stroke: "#334155",
    strokeWidth: 1,
    opacity: 1,
    fontSize: 24,
    fontWeight: 600,
    textAlign: "left" as const,
    borderRadius: 8
  };
}

function extractBulletLinesFromMarkdown(markdown: string): string[] {
  return markdown
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => /^[-*+]\s+/.test(line))
    .map((line) => line.replace(/^[-*+]\s+/, "").trim())
    .filter(Boolean)
    .slice(0, 5);
}

function ensureSelectedSlide() {
  if (!activeDeck.value) {
    return;
  }
  if (!activeDeck.value.slides.length) {
    return;
  }
  if (!activeSlide.value) {
    activeSlideId.value = activeDeck.value.slides[0].id;
  }
}

function clearPendingEditTimers() {
  if (codeDebounce) {
    clearTimeout(codeDebounce);
    codeDebounce = null;
  }

  if (saveDebounce) {
    clearTimeout(saveDebounce);
    saveDebounce = null;
  }
}

function replaceDeckLocally(deck: Deck) {
  const idx = decks.value.findIndex((item) => item.id === deck.id);
  if (idx >= 0) {
    decks.value[idx] = deck;
  } else {
    decks.value.unshift(deck);
  }

  activeDeckId.value = deck.id;
  activeSlideId.value = deck.slides[0]?.id || "";
  selectedElementId.value = "";
}

async function loadDecks() {
  try {
    decks.value = await listDecks();
    if (!activeDeckId.value && decks.value.length) {
      activeDeckId.value = decks.value[0].id;
    }
    ensureSelectedSlide();
  } catch (err) {
    error.value = (err as Error).message;
  }
}

function setCodeFromSlide(slide: Slide | null) {
  if (!slide) {
    codeText.value = "[]";
    return;
  }
  const text = JSON.stringify(slide.elements, null, 2);
  codeText.value = text;
  codeChecksum.value = hashText(text);
  canvasChecksum.value = hashText(text);
}

watch(activeSlide, (slide) => {
  setCodeFromSlide(slide || null);
});

watch(
  () => activeSlide.value?.elements,
  () => {
    if (!activeSlide.value) {
      return;
    }

    if (codeDebounce) {
      clearTimeout(codeDebounce);
    }

    codeDebounce = setTimeout(() => {
      const text = JSON.stringify(activeSlide.value?.elements || [], null, 2);
      codeText.value = text;
      canvasChecksum.value = hashText(text);
      void maybeSaveElements();
    }, 220);
  },
  { deep: true }
);

function updateActiveSlide(mutator: (slide: Slide) => void) {
  const deck = activeDeck.value;
  const slide = activeSlide.value;
  if (!deck || !slide) {
    return;
  }

  if (role.value === "viewer") {
    error.value = "Viewer cannot edit.";
    return;
  }

  mutator(slide);
  deck.version += 1;
  deck.updatedAt = Date.now();

  if (collabClient && collabEnabled.value) {
    collabClient.setDeck(deck);
  }
}

async function maybeSaveElements() {
  if (!activeDeck.value || !activeSlide.value) {
    return;
  }

  const scheduledDeckId = activeDeck.value.id;
  const scheduledSlideId = activeSlide.value.id;

  if (saveDebounce) {
    clearTimeout(saveDebounce);
  }

  saveDebounce = setTimeout(async () => {
    try {
      const latestDeck = decks.value.find((deck) => deck.id === scheduledDeckId);
      const latestSlide = latestDeck?.slides.find((slide) => slide.id === scheduledSlideId);
      if (!latestDeck || !latestSlide) {
        return;
      }

      await replaceSlideElements(latestDeck.id, latestSlide.id, latestSlide.elements);
    } catch (err) {
      error.value = (err as Error).message;
    }
  }, 500);
}

async function onCreateDeck() {
  try {
    let deck = await createDeck({ title: `Deck ${decks.value.length + 1}`, createdBy: currentUserId });

    const preferredConfig = getPreferredAIConfig();
    if (preferredConfig.apiKey || preferredConfig.apiEndpoint || preferredConfig.model) {
      deck = await updateAIConfig(deck.id, preferredConfig);
    }

    decks.value.unshift(deck);
    activeDeckId.value = deck.id;
    selectedElementId.value = "";
  } catch (err) {
    error.value = (err as Error).message;
  }
}

async function onAddSlide() {
  if (!activeDeck.value) {
    return;
  }
  try {
    const slide = await addSlide(activeDeck.value.id, {});
    activeDeck.value.slides.push(slide);
    activeSlideId.value = slide.id;
  } catch (err) {
    error.value = (err as Error).message;
  }
}

function addElement(type: "text" | "shape" | "image", shapeKind?: "rect" | "roundRect" | "circle" | "triangle" | "diamond") {
  updateActiveSlide((slide) => {
    const element: ElementModel = {
      id: nanoid(),
      slideId: slide.id,
      type,
      x: 120,
      y: 120,
      width: type === "text" ? 360 : 180,
      height: 80,
      rotate: 0,
      zIndex: slide.elements.length + 1,
      content:
        type === "text"
          ? { text: "Double click to edit" }
          : type === "image"
            ? { src: "https://picsum.photos/400/240", alt: "image" }
            : { shapeKind: shapeKind || "rect" },
      style: makeDefaultStyle()
    };
    slide.elements.push(element);
    selectedElementId.value = element.id;
  });
}

function onPickLocalImage() {
  if (role.value === "viewer") {
    return;
  }
  uploadInputRef.value?.click();
}

function onLocalImageSelected(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file || !activeSlide.value) {
    return;
  }

  if (!file.type.startsWith("image/")) {
    error.value = "Please select an image file.";
    return;
  }

  const reader = new FileReader();
  reader.onload = () => {
    const src = String(reader.result || "");
    if (!src) {
      error.value = "Failed to load image file.";
      return;
    }

    updateActiveSlide((slide) => {
      const element: ElementModel = {
        id: nanoid(),
        slideId: slide.id,
        type: "image",
        x: 160,
        y: 140,
        width: 320,
        height: 200,
        rotate: 0,
        zIndex: slide.elements.length + 1,
        content: { src, alt: file.name },
        style: makeDefaultStyle()
      };
      slide.elements.push(element);
      selectedElementId.value = element.id;
    });
  };

  reader.onerror = () => {
    error.value = "Failed to read image file.";
  };

  reader.readAsDataURL(file);
  input.value = "";
}

function onDeleteElement() {
  if (!selectedElementId.value) {
    return;
  }

  updateActiveSlide((slide) => {
    slide.elements = slide.elements.filter((item) => item.id !== selectedElementId.value);
    selectedElementId.value = "";
  });
}

function applyCodeToCanvas() {
  if (!activeSlide.value) {
    return;
  }

  try {
    const parsed = JSON.parse(codeText.value) as ElementModel[];
    if (!Array.isArray(parsed)) {
      throw new Error("JSON must be an element array.");
    }

    const newChecksum = hashText(codeText.value);
    if (canvasChecksum.value !== codeChecksum.value && canvasChecksum.value !== newChecksum) {
      conflictMessage.value = "Canvas changed while code was edited. Last write wins applied.";
    } else {
      conflictMessage.value = "";
    }

    updateActiveSlide((slide) => {
      slide.elements = parsed.map((item, index) => ({
        ...item,
        zIndex: index + 1,
        style: { ...makeDefaultStyle(), ...(item.style || {}) },
        content: item.content || {},
        slideId: slide.id
      }));
    });
    codeChecksum.value = newChecksum;
  } catch (err) {
    error.value = `Code parse error: ${(err as Error).message}`;
  }
}

function onCodeInput() {
  if (codeDebounce) {
    clearTimeout(codeDebounce);
  }

  codeDebounce = setTimeout(() => {
    applyCodeToCanvas();
  }, 400);
}

function updateSelectedStyle<K extends keyof NonNullable<ElementModel["style"]>>(
  key: K,
  value: NonNullable<ElementModel["style"]>[K]
) {
  if (!selectedElement.value) {
    return;
  }

  updateActiveSlide((slide) => {
    const target = slide.elements.find((item) => item.id === selectedElement.value!.id);
    if (!target) {
      return;
    }

    target.style = {
      ...target.style,
      [key]: value
    };
  });
}

function updateSelectedShapeKind(kind: ShapeKind) {
  if (!selectedElement.value || selectedElement.value.type !== "shape") {
    return;
  }

  updateActiveSlide((slide) => {
    const target = slide.elements.find((item) => item.id === selectedElement.value!.id);
    if (!target || target.type !== "shape") {
      return;
    }

    target.content = {
      ...(target.content || {}),
      shapeKind: kind
    };
  });
}

let dragState: { id: string; offsetX: number; offsetY: number } | null = null;
let resizeState: { id: string; startX: number; startY: number; startW: number; startH: number } | null = null;

function onElementMouseDown(event: MouseEvent, id: string) {
  const target = activeSlide.value?.elements.find((item) => item.id === id);
  if (!target || role.value === "viewer") {
    return;
  }

  selectedElementId.value = id;
  dragState = {
    id,
    offsetX: event.clientX - target.x,
    offsetY: event.clientY - target.y
  };
}

function onResizeMouseDown(event: MouseEvent, id: string) {
  event.stopPropagation();
  const target = activeSlide.value?.elements.find((item) => item.id === id);
  if (!target || role.value === "viewer") {
    return;
  }

  resizeState = {
    id,
    startX: event.clientX,
    startY: event.clientY,
    startW: target.width,
    startH: target.height
  };
}

function onWindowMouseMove(event: MouseEvent) {
  if (dragState) {
    updateActiveSlide((slide) => {
      const target = slide.elements.find((item) => item.id === dragState!.id);
      if (!target) {
        return;
      }
      target.x = Math.max(0, event.clientX - dragState!.offsetX - 260);
      target.y = Math.max(0, event.clientY - dragState!.offsetY - 120);
    });
  }

  if (resizeState) {
    updateActiveSlide((slide) => {
      const target = slide.elements.find((item) => item.id === resizeState!.id);
      if (!target) {
        return;
      }
      target.width = Math.max(40, resizeState!.startW + (event.clientX - resizeState!.startX));
      target.height = Math.max(30, resizeState!.startH + (event.clientY - resizeState!.startY));
    });
  }

  collabClient?.sendCursor(event.clientX, event.clientY, activeSlideId.value);
}

function onWindowMouseUp() {
  dragState = null;
  resizeState = null;
}

function enableCollab() {
  if (!activeDeck.value || collabEnabled.value) {
    return;
  }

  collabClient = createCollabClient({
    wsBase: "",
    deckId: activeDeck.value.id,
    userId: currentUserId,
    userName: currentUserName,
    role: role.value
  });

  collabClient.onPresenceChange((users) => {
    collaborators.value = users as CollaboratorPresence[];
  });

  collabClient.doc.on("update", (_update, origin) => {
    if (origin !== "remote") {
      return;
    }

    const remote = readDeckFromDoc(collabClient!.doc);
    if (!remote) {
      return;
    }

    const idx = decks.value.findIndex((item) => item.id === remote.id);
    if (idx >= 0) {
      decks.value[idx] = remote;
    }
  });

  collabClient.connect();
  collabClient.setDeck(activeDeck.value);
  collabEnabled.value = true;
  status.value = "collab-on";
}

function disableCollab() {
  collabClient?.disconnect();
  collabClient = null;
  collabEnabled.value = false;
  collaborators.value = [];
  status.value = "collab-off";
}

async function onAIGenerate() {
  if (!activeDeck.value) {
    return;
  }

  status.value = "ai-outline-generating";
  try {
    assertValidOrchestrationMode(aiOrchestrationMode.value);

    const generated = await generateDeckByOutline(activeDeck.value.id, {
      topic: aiTopic.value,
      pages: 6,
      requirements: aiGenerateRequirements.value,
      themeTemplate: aiThemeTemplate.value,
      orchestrationMode: aiOrchestrationMode.value,
      toolPolicy: {
        allowedTools: ["generate-outline", "append-slide-markdown", "read-slide-markdown", "overwrite-slide-markdown"]
      }
    });

    aiWorkflow.value = normalizeWorkflow(generated.orchestration?.workflow || []);
    aiWorkflowIssues.value = generated.orchestration?.issues || [];
    aiWorkflowMode.value = generated.orchestration?.mode || "-";
    aiWorkflowFallback.value = generated.orchestration?.fallbackTriggered || false;
    aiWorkflowIntegrityError.value = validateWorkflowSequence(aiWorkflow.value);

    markdownInput.value = generated.slides.map((slide) => slide.markdown).join("\n\n---\n\n");
    clearPendingEditTimers();
    replaceDeckLocally(generated.deck);
    status.value = "ai-outline-imported";
  } catch (err) {
    error.value = (err as Error).message;
    status.value = "ai-outline-failed";
  }
}

async function onSaveAIConfig() {
  if (!activeDeck.value) {
    return;
  }

  try {
    const deck = await updateAIConfig(activeDeck.value.id, {
      ...getPreferredAIConfig()
    });

    const idx = decks.value.findIndex((item) => item.id === deck.id);
    if (idx >= 0) {
      decks.value[idx] = deck;
    }

    status.value = "ai-config-saved";
    aiTestMessage.value = "";
  } catch (err) {
    error.value = (err as Error).message;
  }
}

async function onTestAIConnection() {
  try {
    aiTestMessage.value = "Testing...";
    const result = await testAIConnection(getPreferredAIConfig());
    aiTestMessage.value = result.message;
    status.value = "ai-connected";
  } catch (err) {
    const message = (err as Error).message;
    aiTestMessage.value = message;
    error.value = message;
  }
}

async function onPolishSelected() {
  if (!activeDeck.value || !selectedElement.value?.content?.text) {
    return;
  }
  try {
    const data = await polishSelectedText(activeDeck.value.id, {
      text: selectedElement.value.content.text,
      mode: "professional"
    });

    updateActiveSlide((slide) => {
      const target = slide.elements.find((item) => item.id === selectedElement.value!.id);
      if (target?.content) {
        target.content.text = data.content;
      }
    });
  } catch (err) {
    error.value = (err as Error).message;
  }
}

async function onImportMarkdown() {
  if (!activeDeck.value) {
    return;
  }
  try {
    clearPendingEditTimers();
    const deck = await importMarkdown(activeDeck.value.id, { markdown: markdownInput.value });
    replaceDeckLocally(deck);
  } catch (err) {
    error.value = (err as Error).message;
  }
}

async function onRewriteSelectedSlideWithAI() {
  if (!activeDeck.value || !activeSlide.value) {
    return;
  }

  const instruction = aiSlideInstruction.value.trim();
  if (!instruction) {
    error.value = "请输入当前页的AI修改要求。";
    return;
  }

  try {
    status.value = "ai-rewriting-slide";
    const result = await rewriteSlideWithAI(activeDeck.value.id, activeSlide.value.id, { instruction });
    markdownInput.value = result.markdown;
    replaceDeckLocally(result.deck);
    status.value = "ai-slide-updated";
  } catch (err) {
    error.value = (err as Error).message;
    status.value = "ai-slide-failed";
  }
}

async function onDeleteActiveSlide() {
  if (!activeDeck.value || !activeSlide.value) {
    return;
  }

  if (role.value === "viewer") {
    error.value = "Viewer cannot edit.";
    return;
  }

  try {
    const nextDeck = await deleteSlide(activeDeck.value.id, activeSlide.value.id);
    replaceDeckLocally(nextDeck);
    ensureSelectedSlide();
  } catch (err) {
    error.value = (err as Error).message;
  }
}

async function onExport(format: "html" | "pdf" | "pptx") {
  if (!activeDeck.value) {
    return;
  }

  exportState.value = "submitting";
  exportLinks.value = [];
  try {
    const { job } = await startExport({ deckId: activeDeck.value.id, format });
    exportState.value = job.status;
    const timer = setInterval(async () => {
      const current = await getExportJob(job.id);
      exportState.value = `${current.job.status}${current.job.message ? `: ${current.job.message}` : ""}`;
      if (current.job.status === "completed" || current.job.status === "failed") {
        clearInterval(timer);
        if (current.job.status === "completed") {
          const links: string[] = [];
          if (current.job.outputPath) {
            links.push(current.job.outputPath);
          }
          if (current.job.outputFiles?.length) {
            links.push(...current.job.outputFiles);
          }
          exportLinks.value = links;
        }
      }
    }, 1200);
  } catch (err) {
    error.value = (err as Error).message;
    exportState.value = "failed";
  }
}

function onKeyDelete(event: KeyboardEvent) {
  if (!selectedElement.value || role.value === "viewer") {
    return;
  }

  const target = event.target as HTMLElement | null;
  if (target) {
    const tag = target.tagName.toLowerCase();
    const editable = target.isContentEditable;
    if (editable || tag === "input" || tag === "textarea" || tag === "select") {
      return;
    }
  }

  if (event.key === "Delete" || event.key === "Backspace") {
    event.preventDefault();
    onDeleteElement();
  }
}

function updateElementText(event: Event, element: ElementModel) {
  const value = (event.target as HTMLElement).innerText;
  updateActiveSlide((slide) => {
    const target = slide.elements.find((item) => item.id === element.id);
    if (!target) {
      return;
    }
    target.content = {
      ...(target.content || {}),
      text: value
    };
  });
}

onMounted(async () => {
  await loadDecks();
  window.addEventListener("mousemove", onWindowMouseMove);
  window.addEventListener("mouseup", onWindowMouseUp);
  window.addEventListener("keydown", onKeyDelete);

  if (!decks.value.length) {
    await onCreateDeck();
    await onAddSlide();
  }
});

onBeforeUnmount(() => {
  window.removeEventListener("mousemove", onWindowMouseMove);
  window.removeEventListener("mouseup", onWindowMouseUp);
  window.removeEventListener("keydown", onKeyDelete);
  disableCollab();
});
</script>

<template>
  <div class="layout">
    <aside class="left-panel">
      <div style="background: #ff0000; color: #fff; padding: 8px; margin-bottom: 16px; border-radius: 4px; font-weight: bold;">✓ App Loaded</div>
      <h2>Decks</h2>
      <div class="row">
        <button @click="onCreateDeck">New Deck</button>
        <button @click="onAddSlide" :disabled="!activeDeck">Add Slide</button>
      </div>
      <button @click="onDeleteActiveSlide" :disabled="!activeDeck || !activeSlide || role === 'viewer'">
        Delete Selected Slide
      </button>
      <select v-model="activeDeckId" @change="ensureSelectedSlide">
        <option v-for="deck in decks" :key="deck.id" :value="deck.id">{{ deck.title }}</option>
      </select>

      <div v-if="activeDeck" class="slides">
        <button
          v-for="slide in activeDeck.slides"
          :key="slide.id"
          class="slide-item"
          :class="{ active: slide.id === activeSlideId }"
          @click="activeSlideId = slide.id"
        >
          {{ slide.slideNumber }}. {{ slide.title }}
        </button>
      </div>

      <h3>AI</h3>
      <input v-model="aiTopic" placeholder="输入主题" />
      <div class="stack">
        <label>Provider</label>
        <select v-model="aiProvider">
          <option value="openai">OpenAI format</option>
          <option value="anthropic">Anthropic format</option>
        </select>

        <label>Model</label>
        <input v-model="aiModel" placeholder="gpt-4.1-mini / claude-3-5-haiku-20241022" />

        <label>Theme Template</label>
        <select v-model="aiThemeTemplate">
          <option value="business">Business</option>
          <option value="academic">Academic</option>
          <option value="product-launch">Product Launch</option>
        </select>

        <label>Orchestration Mode</label>
        <select v-model="aiOrchestrationMode">
          <option value="auto">auto</option>
          <option value="agent-team">agent-team</option>
          <option value="single-agent">single-agent</option>
        </select>

        <label>API Key</label>
        <input v-model="aiApiKey" placeholder="输入 API Key" type="password" />

        <label>API Endpoint (optional)</label>
        <input
          v-model="aiApiEndpoint"
          :placeholder="
            aiProvider === 'openai'
              ? 'https://api.openai.com/v1 或兼容地址'
              : 'https://api.anthropic.com 或代理地址'
          "
        />

        <button @click="onSaveAIConfig" :disabled="!activeDeck">Save AI Config</button>
        <button @click="onTestAIConnection">Test Connection</button>
        <p v-if="aiTestMessage" class="muted">{{ aiTestMessage }}</p>
      </div>
      <button @click="onAIGenerate" :disabled="!activeDeck">AI生成Markdown并导入预览</button>
      <button @click="onPolishSelected" :disabled="!selectedElement">Polish selected text</button>

      <h3>Agent Team Workflow</h3>
      <p class="muted">Mode: {{ aiWorkflowMode }} | Fallback: {{ aiWorkflowFallback ? 'yes' : 'no' }}</p>
      <p v-if="aiWorkflowIntegrityError" class="warn">Workflow integrity: {{ aiWorkflowIntegrityError }}</p>
      <div v-if="aiWorkflow.length" class="workflow-list">
        <div v-for="(event, idx) in aiWorkflow" :key="`${event.stage}-${idx}-${event.startedAt}`" class="workflow-item">
          <div class="workflow-row">
            <strong>{{ event.stage }}</strong>
            <span class="workflow-badge" :class="getWorkflowStatusClass(event.status)">{{ event.status }}</span>
          </div>
          <div class="muted">Duration: {{ formatDuration(event.durationMs) }}</div>
          <div v-if="event.slideIndexes?.length" class="muted">Slides: {{ event.slideIndexes.join(', ') }}</div>
          <div v-if="event.issueCode" class="error">Issue: {{ event.issueCode }}</div>
          <div v-if="event.message" class="muted">{{ event.message }}</div>
          <div v-if="event.retryHint" class="warn">Hint: {{ event.retryHint }}</div>
        </div>
      </div>
      <p v-else class="muted">Run generation to see workflow timeline.</p>

      <div v-if="aiWorkflowIssues.length" class="workflow-issues">
        <h4>Workflow Issues</h4>
        <ul>
          <li v-for="(issue, idx) in aiWorkflowIssues" :key="`${issue.code}-${idx}`">
            {{ issue.stage }} / {{ issue.code }}: {{ issue.message }}
            <span v-if="issue.slideIndex"> (slide {{ issue.slideIndex }})</span>
            <span v-if="issue.retryHint"> - {{ issue.retryHint }}</span>
          </li>
        </ul>
      </div>

      <h3>AI Modify Current Slide</h3>
      <textarea
        v-model="aiSlideInstruction"
        rows="4"
        placeholder="例如：添加一张与主题相关的图片，并美化背景色，保留原有核心结论"
      ></textarea>
      <button @click="onRewriteSelectedSlideWithAI" :disabled="!activeDeck || !activeSlide">
        AI修改当前Slide
      </button>

      <h3>Markdown Import</h3>
      <textarea v-model="markdownInput" rows="8"></textarea>
      <button @click="onImportMarkdown" :disabled="!activeDeck">Import Markdown</button>
      <div class="markdown-preview" v-html="markdownPreviewHtml"></div>

      <h3>Export</h3>
      <div class="row">
        <button @click="onExport('html')" :disabled="!activeDeck">HTML</button>
        <button @click="onExport('pdf')" :disabled="!activeDeck">PDF</button>
        <button @click="onExport('pptx')" :disabled="!activeDeck">PPTX</button>
      </div>
      <p class="muted">Export: {{ exportState }}</p>
      <ul v-if="exportLinks.length" class="stack">
        <li v-for="(link, idx) in exportLinks" :key="link + idx">
          <a :href="`http://localhost:4000${link}`" target="_blank" rel="noopener noreferrer">Download {{ idx + 1 }}</a>
        </li>
      </ul>

      <h3>Collaboration</h3>
      <select v-model="role">
        <option value="editor">editor</option>
        <option value="viewer">viewer</option>
      </select>
      <div class="row">
        <button @click="enableCollab" :disabled="collabEnabled || !activeDeck">Connect</button>
        <button @click="disableCollab" :disabled="!collabEnabled">Disconnect</button>
      </div>
      <p class="muted">{{ status }}</p>
      <p class="muted">Online: {{ collaborators.length }}</p>
      <ul>
        <li v-for="user in collaborators" :key="user.userId">{{ user.userName }} ({{ user.role }})</li>
      </ul>

      <p v-if="error" class="error">{{ error }}</p>
      <p v-if="conflictMessage" class="warn">{{ conflictMessage }}</p>
    </aside>

    <main class="center-panel">
      <div class="toolbar">
        <button @click="addElement('text')" :disabled="role === 'viewer'">Text</button>
        <button @click="addElement('shape', 'rect')" :disabled="role === 'viewer'">Shape</button>
        <button @click="onPickLocalImage" :disabled="role === 'viewer'">Upload Image</button>
      </div>
      <input ref="uploadInputRef" type="file" accept="image/*" style="display: none" @change="onLocalImageSelected" />

      <div class="canvas" v-if="activeSlide" :style="{ backgroundColor: activeSlide.bgColor || '#ffffff' }">
        <iframe
          v-if="activeSlideBackgroundDoc"
          class="canvas-bg-html"
          sandbox="allow-same-origin"
          :srcdoc="activeSlideBackgroundDoc"
        ></iframe>
        <h1 class="slide-title">{{ activeSlide.title }}</h1>

        <div
          v-for="element in activeSlide.elements"
          :key="element.id"
          class="element"
          :class="{ selected: selectedElementId === element.id }"
          :style="{
            left: `${element.x}px`,
            top: `${element.y}px`,
            width: `${element.width}px`,
            height: `${element.height}px`,
            background: 'transparent',
            border: 'none',
            opacity: String(element.style.opacity),
            borderRadius: `${element.style.borderRadius || 0}px`
          }"
          @mousedown="onElementMouseDown($event, element.id)"
          @dblclick="selectedElementId = element.id"
        >
          <div
            v-if="element.type === 'text'"
            class="text-element"
            contenteditable
            :style="{
              fontSize: `${element.style.fontSize || 22}px`,
              fontWeight: String(element.style.fontWeight || 500),
              textAlign: element.style.textAlign || 'left',
              color: element.style.color || element.style.fill || '#0f172a',
              fontFamily: element.style.fontFamily || 'Segoe UI, Tahoma, sans-serif'
            }"
            @input="updateElementText($event, element)"
          >
            {{ element.content?.text }}
          </div>
          <img v-else-if="element.type === 'image'" class="image-element" :src="element.content?.src" alt="img" />
          <div
            v-else
            class="shape-element"
            :style="{
              background: element.style.fill,
              border: `1px solid ${element.style.stroke}`,
              clipPath:
                element.content?.shapeKind === 'triangle'
                  ? 'polygon(50% 0%, 0% 100%, 100% 100%)'
                  : element.content?.shapeKind === 'diamond'
                    ? 'polygon(50% 0%, 100% 50%, 50% 100%, 0% 50%)'
                    : 'none',
              borderRadius:
                element.content?.shapeKind === 'circle'
                  ? '50%'
                  : element.content?.shapeKind === 'roundRect'
                    ? '16px'
                    : `${element.style.borderRadius || 0}px`
            }"
          ></div>
          <span class="resize-handle" @mousedown="onResizeMouseDown($event, element.id)"></span>
        </div>
      </div>

      <div v-else class="empty">Create or select a slide</div>
    </main>

    <aside class="right-panel">
      <h3>Style</h3>
      <div v-if="selectedElement" class="stack">
        <label>Fill</label>
        <input
          type="color"
          :value="selectedElement.style.fill"
          @input="updateSelectedStyle('fill', ($event.target as HTMLInputElement).value)"
        />

        <label>Stroke</label>
        <input
          type="color"
          :value="selectedElement.style.stroke"
          @input="updateSelectedStyle('stroke', ($event.target as HTMLInputElement).value)"
        />

        <label>Opacity</label>
        <input
          type="range"
          min="0.1"
          max="1"
          step="0.05"
          :value="selectedElement.style.opacity"
          @input="updateSelectedStyle('opacity', Number(($event.target as HTMLInputElement).value))"
        />

        <label v-if="selectedElement.type === 'text'">Font Size</label>
        <input
          v-if="selectedElement.type === 'text'"
          type="number"
          min="12"
          max="72"
          :value="selectedElement.style.fontSize || 24"
          @input="updateSelectedStyle('fontSize', Number(($event.target as HTMLInputElement).value))"
        />

        <label v-if="selectedElement.type === 'shape'">Shape Type</label>
        <select
          v-if="selectedElement.type === 'shape'"
          :value="selectedElement.content?.shapeKind || 'rect'"
          @change="updateSelectedShapeKind(($event.target as HTMLSelectElement).value as ShapeKind)"
        >
          <option value="rect">Rectangle</option>
          <option value="roundRect">Round Rectangle</option>
          <option value="circle">Circle</option>
          <option value="triangle">Triangle</option>
          <option value="diamond">Diamond</option>
        </select>
      </div>
      <p v-else class="muted">Select an element to edit style.</p>

      <h3>Code Panel (JSON)</h3>
      <textarea v-model="codeText" rows="26" @input="onCodeInput"></textarea>
      <button @click="applyCodeToCanvas" :disabled="role === 'viewer'">Apply Code</button>
    </aside>
  </div>
</template>
