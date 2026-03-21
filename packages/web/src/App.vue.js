import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { nanoid } from "nanoid";
import { addSlide, createDeck, generateDeckDraft, getExportJob, importMarkdown, listDecks, polishSelectedText, replaceSlideElements, startExport, suggestVisuals, updateAIConfig } from "./services/api";
import { createCollabClient, readDeckFromDoc } from "./services/collab";
const decks = ref([]);
const activeDeckId = ref("");
const activeSlideId = ref("");
const selectedElementId = ref("");
const collaborators = ref([]);
const error = ref("");
const status = ref("idle");
const codeText = ref("[]");
const codeChecksum = ref("");
const canvasChecksum = ref("");
const conflictMessage = ref("");
const markdownInput = ref("# 数据分析报告\n\n- 结论一\n- 结论二");
const aiTopic = ref("介绍碳中和的商业模式");
const aiProvider = ref("openai");
const aiModel = ref("gpt-4.1-mini");
const aiApiKey = ref("");
const aiApiEndpoint = ref("");
const visualHints = ref([]);
const collabEnabled = ref(false);
const role = ref("editor");
const currentUserId = `user-${Math.random().toString(36).slice(2, 7)}`;
const currentUserName = `U-${Math.random().toString(36).slice(2, 6)}`;
const exportState = ref("-");
const exportLinks = ref([]);
const uploadInputRef = ref(null);
let collabClient = null;
let codeDebounce = null;
let saveDebounce = null;
function hashText(text) {
    let h = 0;
    for (let i = 0; i < text.length; i += 1) {
        h = (h << 5) - h + text.charCodeAt(i);
        h |= 0;
    }
    return String(h);
}
const activeDeck = computed(() => decks.value.find((deck) => deck.id === activeDeckId.value) || null);
const activeSlide = computed(() => activeDeck.value?.slides.find((slide) => slide.id === activeSlideId.value) || null);
const selectedElement = computed(() => activeSlide.value?.elements.find((element) => element.id === selectedElementId.value) || null);
watch(activeDeck, (deck) => {
    aiProvider.value = (deck?.aiConfig.provider === "anthropic" ? "anthropic" : "openai");
    aiModel.value = deck?.aiConfig.model || (aiProvider.value === "anthropic" ? "claude-3-5-haiku-20241022" : "gpt-4.1-mini");
    aiApiEndpoint.value = deck?.aiConfig.apiEndpoint || "";
    aiApiKey.value = deck?.aiConfig.apiKey || "";
}, { immediate: true });
function makeDefaultStyle() {
    return {
        fill: "#e2e8f0",
        stroke: "#334155",
        strokeWidth: 1,
        opacity: 1,
        fontSize: 24,
        fontWeight: 600,
        textAlign: "left",
        borderRadius: 8
    };
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
async function loadDecks() {
    try {
        decks.value = await listDecks();
        if (!activeDeckId.value && decks.value.length) {
            activeDeckId.value = decks.value[0].id;
        }
        ensureSelectedSlide();
    }
    catch (err) {
        error.value = err.message;
    }
}
function setCodeFromSlide(slide) {
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
watch(() => activeSlide.value?.elements, () => {
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
}, { deep: true });
function updateActiveSlide(mutator) {
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
    if (saveDebounce) {
        clearTimeout(saveDebounce);
    }
    saveDebounce = setTimeout(async () => {
        try {
            await replaceSlideElements(activeDeck.value.id, activeSlide.value.id, activeSlide.value.elements);
        }
        catch (err) {
            error.value = err.message;
        }
    }, 500);
}
async function onCreateDeck() {
    try {
        const deck = await createDeck({ title: `Deck ${decks.value.length + 1}`, createdBy: currentUserId });
        decks.value.unshift(deck);
        activeDeckId.value = deck.id;
        selectedElementId.value = "";
    }
    catch (err) {
        error.value = err.message;
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
    }
    catch (err) {
        error.value = err.message;
    }
}
function addElement(type, shapeKind) {
    updateActiveSlide((slide) => {
        const element = {
            id: nanoid(),
            slideId: slide.id,
            type,
            x: 120,
            y: 120,
            width: type === "text" ? 360 : 180,
            height: 80,
            rotate: 0,
            zIndex: slide.elements.length + 1,
            content: type === "text"
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
function onLocalImageSelected(event) {
    const input = event.target;
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
            const element = {
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
        const parsed = JSON.parse(codeText.value);
        if (!Array.isArray(parsed)) {
            throw new Error("JSON must be an element array.");
        }
        const newChecksum = hashText(codeText.value);
        if (canvasChecksum.value !== codeChecksum.value && canvasChecksum.value !== newChecksum) {
            conflictMessage.value = "Canvas changed while code was edited. Last write wins applied.";
        }
        else {
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
    }
    catch (err) {
        error.value = `Code parse error: ${err.message}`;
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
function updateSelectedStyle(key, value) {
    if (!selectedElement.value) {
        return;
    }
    updateActiveSlide((slide) => {
        const target = slide.elements.find((item) => item.id === selectedElement.value.id);
        if (!target) {
            return;
        }
        target.style = {
            ...target.style,
            [key]: value
        };
    });
}
function updateSelectedShapeKind(kind) {
    if (!selectedElement.value || selectedElement.value.type !== "shape") {
        return;
    }
    updateActiveSlide((slide) => {
        const target = slide.elements.find((item) => item.id === selectedElement.value.id);
        if (!target || target.type !== "shape") {
            return;
        }
        target.content = {
            ...(target.content || {}),
            shapeKind: kind
        };
    });
}
let dragState = null;
let resizeState = null;
function onElementMouseDown(event, id) {
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
function onResizeMouseDown(event, id) {
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
function onWindowMouseMove(event) {
    if (dragState) {
        updateActiveSlide((slide) => {
            const target = slide.elements.find((item) => item.id === dragState.id);
            if (!target) {
                return;
            }
            target.x = Math.max(0, event.clientX - dragState.offsetX - 260);
            target.y = Math.max(0, event.clientY - dragState.offsetY - 120);
        });
    }
    if (resizeState) {
        updateActiveSlide((slide) => {
            const target = slide.elements.find((item) => item.id === resizeState.id);
            if (!target) {
                return;
            }
            target.width = Math.max(40, resizeState.startW + (event.clientX - resizeState.startX));
            target.height = Math.max(30, resizeState.startH + (event.clientY - resizeState.startY));
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
        collaborators.value = users;
    });
    collabClient.doc.on("update", (_update, origin) => {
        if (origin !== "remote") {
            return;
        }
        const remote = readDeckFromDoc(collabClient.doc);
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
    status.value = "ai-generating";
    try {
        const data = await generateDeckDraft(activeDeck.value.id, { topic: aiTopic.value, slides: 5 });
        const newSlides = data.draft.slideDrafts.map((item, index) => {
            const id = nanoid();
            const elements = item.bullets.map((bullet, bIndex) => ({
                id: nanoid(),
                slideId: id,
                type: "text",
                x: 90,
                y: 180 + bIndex * 56,
                width: 740,
                height: 48,
                rotate: 0,
                zIndex: bIndex + 1,
                content: { text: `• ${bullet}` },
                style: makeDefaultStyle()
            }));
            return {
                id,
                deckId: activeDeck.value.id,
                slideNumber: index + 1,
                title: item.title,
                bgColor: "#ffffff",
                elements,
                createdAt: Date.now(),
                updatedAt: Date.now()
            };
        });
        activeDeck.value.slides = newSlides;
        activeSlideId.value = newSlides[0]?.id || "";
        visualHints.value = await (async () => {
            const v = await suggestVisuals(activeDeck.value.id, aiTopic.value);
            return v.suggestions;
        })();
        status.value = "ai-done";
    }
    catch (err) {
        error.value = err.message;
        status.value = "ai-failed";
    }
}
async function onSaveAIConfig() {
    if (!activeDeck.value) {
        return;
    }
    try {
        const deck = await updateAIConfig(activeDeck.value.id, {
            provider: aiProvider.value,
            model: aiModel.value.trim() || undefined,
            apiKey: aiApiKey.value.trim() || undefined,
            apiEndpoint: aiApiEndpoint.value.trim() || undefined
        });
        const idx = decks.value.findIndex((item) => item.id === deck.id);
        if (idx >= 0) {
            decks.value[idx] = deck;
        }
        status.value = "ai-config-saved";
    }
    catch (err) {
        error.value = err.message;
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
            const target = slide.elements.find((item) => item.id === selectedElement.value.id);
            if (target?.content) {
                target.content.text = data.content;
            }
        });
    }
    catch (err) {
        error.value = err.message;
    }
}
async function onImportMarkdown() {
    if (!activeDeck.value) {
        return;
    }
    try {
        const deck = await importMarkdown(activeDeck.value.id, { markdown: markdownInput.value });
        const idx = decks.value.findIndex((item) => item.id === deck.id);
        if (idx >= 0) {
            decks.value[idx] = deck;
            activeSlideId.value = deck.slides[0]?.id || "";
        }
    }
    catch (err) {
        error.value = err.message;
    }
}
async function onExport(format) {
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
                    const links = [];
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
    }
    catch (err) {
        error.value = err.message;
        exportState.value = "failed";
    }
}
function onKeyDelete(event) {
    if (!selectedElement.value || role.value === "viewer") {
        return;
    }
    const target = event.target;
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
function updateElementText(event, element) {
    const value = event.target.innerText;
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
debugger; /* PartiallyEnd: #3632/scriptSetup.vue */
const __VLS_ctx = {};
let __VLS_components;
let __VLS_directives;
__VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
    ...{ class: "layout" },
});
__VLS_asFunctionalElement(__VLS_intrinsicElements.aside, __VLS_intrinsicElements.aside)({
    ...{ class: "left-panel" },
});
__VLS_asFunctionalElement(__VLS_intrinsicElements.h2, __VLS_intrinsicElements.h2)({});
__VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
    ...{ class: "row" },
});
__VLS_asFunctionalElement(__VLS_intrinsicElements.button, __VLS_intrinsicElements.button)({
    ...{ onClick: (__VLS_ctx.onCreateDeck) },
});
__VLS_asFunctionalElement(__VLS_intrinsicElements.button, __VLS_intrinsicElements.button)({
    ...{ onClick: (__VLS_ctx.onAddSlide) },
    disabled: (!__VLS_ctx.activeDeck),
});
__VLS_asFunctionalElement(__VLS_intrinsicElements.select, __VLS_intrinsicElements.select)({
    ...{ onChange: (__VLS_ctx.ensureSelectedSlide) },
    value: (__VLS_ctx.activeDeckId),
});
for (const [deck] of __VLS_getVForSourceType((__VLS_ctx.decks))) {
    __VLS_asFunctionalElement(__VLS_intrinsicElements.option, __VLS_intrinsicElements.option)({
        key: (deck.id),
        value: (deck.id),
    });
    (deck.title);
}
if (__VLS_ctx.activeDeck) {
    __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
        ...{ class: "slides" },
    });
    for (const [slide] of __VLS_getVForSourceType((__VLS_ctx.activeDeck.slides))) {
        __VLS_asFunctionalElement(__VLS_intrinsicElements.button, __VLS_intrinsicElements.button)({
            ...{ onClick: (...[$event]) => {
                    if (!(__VLS_ctx.activeDeck))
                        return;
                    __VLS_ctx.activeSlideId = slide.id;
                } },
            key: (slide.id),
            ...{ class: "slide-item" },
            ...{ class: ({ active: slide.id === __VLS_ctx.activeSlideId }) },
        });
        (slide.slideNumber);
        (slide.title);
    }
}
__VLS_asFunctionalElement(__VLS_intrinsicElements.h3, __VLS_intrinsicElements.h3)({});
__VLS_asFunctionalElement(__VLS_intrinsicElements.input)({
    placeholder: "输入主题",
});
(__VLS_ctx.aiTopic);
__VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
    ...{ class: "stack" },
});
__VLS_asFunctionalElement(__VLS_intrinsicElements.label, __VLS_intrinsicElements.label)({});
__VLS_asFunctionalElement(__VLS_intrinsicElements.select, __VLS_intrinsicElements.select)({
    value: (__VLS_ctx.aiProvider),
});
__VLS_asFunctionalElement(__VLS_intrinsicElements.option, __VLS_intrinsicElements.option)({
    value: "openai",
});
__VLS_asFunctionalElement(__VLS_intrinsicElements.option, __VLS_intrinsicElements.option)({
    value: "anthropic",
});
__VLS_asFunctionalElement(__VLS_intrinsicElements.label, __VLS_intrinsicElements.label)({});
__VLS_asFunctionalElement(__VLS_intrinsicElements.input)({
    placeholder: "gpt-4.1-mini / claude-3-5-haiku-20241022",
});
(__VLS_ctx.aiModel);
__VLS_asFunctionalElement(__VLS_intrinsicElements.label, __VLS_intrinsicElements.label)({});
__VLS_asFunctionalElement(__VLS_intrinsicElements.input)({
    placeholder: "输入 API Key",
    type: "password",
});
(__VLS_ctx.aiApiKey);
__VLS_asFunctionalElement(__VLS_intrinsicElements.label, __VLS_intrinsicElements.label)({});
__VLS_asFunctionalElement(__VLS_intrinsicElements.input)({
    placeholder: (__VLS_ctx.aiProvider === 'openai'
        ? 'https://api.openai.com/v1 或兼容地址'
        : 'https://api.anthropic.com 或代理地址'),
});
(__VLS_ctx.aiApiEndpoint);
__VLS_asFunctionalElement(__VLS_intrinsicElements.button, __VLS_intrinsicElements.button)({
    ...{ onClick: (__VLS_ctx.onSaveAIConfig) },
    disabled: (!__VLS_ctx.activeDeck),
});
__VLS_asFunctionalElement(__VLS_intrinsicElements.button, __VLS_intrinsicElements.button)({
    ...{ onClick: (__VLS_ctx.onAIGenerate) },
    disabled: (!__VLS_ctx.activeDeck),
});
__VLS_asFunctionalElement(__VLS_intrinsicElements.button, __VLS_intrinsicElements.button)({
    ...{ onClick: (__VLS_ctx.onPolishSelected) },
    disabled: (!__VLS_ctx.selectedElement),
});
__VLS_asFunctionalElement(__VLS_intrinsicElements.h3, __VLS_intrinsicElements.h3)({});
__VLS_asFunctionalElement(__VLS_intrinsicElements.textarea, __VLS_intrinsicElements.textarea)({
    value: (__VLS_ctx.markdownInput),
    rows: "8",
});
__VLS_asFunctionalElement(__VLS_intrinsicElements.button, __VLS_intrinsicElements.button)({
    ...{ onClick: (__VLS_ctx.onImportMarkdown) },
    disabled: (!__VLS_ctx.activeDeck),
});
__VLS_asFunctionalElement(__VLS_intrinsicElements.h3, __VLS_intrinsicElements.h3)({});
__VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
    ...{ class: "row" },
});
__VLS_asFunctionalElement(__VLS_intrinsicElements.button, __VLS_intrinsicElements.button)({
    ...{ onClick: (...[$event]) => {
            __VLS_ctx.onExport('html');
        } },
    disabled: (!__VLS_ctx.activeDeck),
});
__VLS_asFunctionalElement(__VLS_intrinsicElements.button, __VLS_intrinsicElements.button)({
    ...{ onClick: (...[$event]) => {
            __VLS_ctx.onExport('pdf');
        } },
    disabled: (!__VLS_ctx.activeDeck),
});
__VLS_asFunctionalElement(__VLS_intrinsicElements.button, __VLS_intrinsicElements.button)({
    ...{ onClick: (...[$event]) => {
            __VLS_ctx.onExport('pptx');
        } },
    disabled: (!__VLS_ctx.activeDeck),
});
__VLS_asFunctionalElement(__VLS_intrinsicElements.p, __VLS_intrinsicElements.p)({
    ...{ class: "muted" },
});
(__VLS_ctx.exportState);
if (__VLS_ctx.exportLinks.length) {
    __VLS_asFunctionalElement(__VLS_intrinsicElements.ul, __VLS_intrinsicElements.ul)({
        ...{ class: "stack" },
    });
    for (const [link, idx] of __VLS_getVForSourceType((__VLS_ctx.exportLinks))) {
        __VLS_asFunctionalElement(__VLS_intrinsicElements.li, __VLS_intrinsicElements.li)({
            key: (link + idx),
        });
        __VLS_asFunctionalElement(__VLS_intrinsicElements.a, __VLS_intrinsicElements.a)({
            href: (`http://localhost:4000${link}`),
            target: "_blank",
            rel: "noopener noreferrer",
        });
        (idx + 1);
    }
}
__VLS_asFunctionalElement(__VLS_intrinsicElements.h3, __VLS_intrinsicElements.h3)({});
__VLS_asFunctionalElement(__VLS_intrinsicElements.select, __VLS_intrinsicElements.select)({
    value: (__VLS_ctx.role),
});
__VLS_asFunctionalElement(__VLS_intrinsicElements.option, __VLS_intrinsicElements.option)({
    value: "editor",
});
__VLS_asFunctionalElement(__VLS_intrinsicElements.option, __VLS_intrinsicElements.option)({
    value: "viewer",
});
__VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
    ...{ class: "row" },
});
__VLS_asFunctionalElement(__VLS_intrinsicElements.button, __VLS_intrinsicElements.button)({
    ...{ onClick: (__VLS_ctx.enableCollab) },
    disabled: (__VLS_ctx.collabEnabled || !__VLS_ctx.activeDeck),
});
__VLS_asFunctionalElement(__VLS_intrinsicElements.button, __VLS_intrinsicElements.button)({
    ...{ onClick: (__VLS_ctx.disableCollab) },
    disabled: (!__VLS_ctx.collabEnabled),
});
__VLS_asFunctionalElement(__VLS_intrinsicElements.p, __VLS_intrinsicElements.p)({
    ...{ class: "muted" },
});
(__VLS_ctx.status);
__VLS_asFunctionalElement(__VLS_intrinsicElements.p, __VLS_intrinsicElements.p)({
    ...{ class: "muted" },
});
(__VLS_ctx.collaborators.length);
__VLS_asFunctionalElement(__VLS_intrinsicElements.ul, __VLS_intrinsicElements.ul)({});
for (const [user] of __VLS_getVForSourceType((__VLS_ctx.collaborators))) {
    __VLS_asFunctionalElement(__VLS_intrinsicElements.li, __VLS_intrinsicElements.li)({
        key: (user.userId),
    });
    (user.userName);
    (user.role);
}
__VLS_asFunctionalElement(__VLS_intrinsicElements.h3, __VLS_intrinsicElements.h3)({});
__VLS_asFunctionalElement(__VLS_intrinsicElements.ul, __VLS_intrinsicElements.ul)({});
for (const [hint] of __VLS_getVForSourceType((__VLS_ctx.visualHints))) {
    __VLS_asFunctionalElement(__VLS_intrinsicElements.li, __VLS_intrinsicElements.li)({
        key: (hint),
    });
    (hint);
}
if (__VLS_ctx.error) {
    __VLS_asFunctionalElement(__VLS_intrinsicElements.p, __VLS_intrinsicElements.p)({
        ...{ class: "error" },
    });
    (__VLS_ctx.error);
}
if (__VLS_ctx.conflictMessage) {
    __VLS_asFunctionalElement(__VLS_intrinsicElements.p, __VLS_intrinsicElements.p)({
        ...{ class: "warn" },
    });
    (__VLS_ctx.conflictMessage);
}
__VLS_asFunctionalElement(__VLS_intrinsicElements.main, __VLS_intrinsicElements.main)({
    ...{ class: "center-panel" },
});
__VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
    ...{ class: "toolbar" },
});
__VLS_asFunctionalElement(__VLS_intrinsicElements.button, __VLS_intrinsicElements.button)({
    ...{ onClick: (...[$event]) => {
            __VLS_ctx.addElement('text');
        } },
    disabled: (__VLS_ctx.role === 'viewer'),
});
__VLS_asFunctionalElement(__VLS_intrinsicElements.button, __VLS_intrinsicElements.button)({
    ...{ onClick: (...[$event]) => {
            __VLS_ctx.addElement('shape', 'rect');
        } },
    disabled: (__VLS_ctx.role === 'viewer'),
});
__VLS_asFunctionalElement(__VLS_intrinsicElements.button, __VLS_intrinsicElements.button)({
    ...{ onClick: (__VLS_ctx.onPickLocalImage) },
    disabled: (__VLS_ctx.role === 'viewer'),
});
__VLS_asFunctionalElement(__VLS_intrinsicElements.input)({
    ...{ onChange: (__VLS_ctx.onLocalImageSelected) },
    ref: "uploadInputRef",
    type: "file",
    accept: "image/*",
    ...{ style: {} },
});
/** @type {typeof __VLS_ctx.uploadInputRef} */ ;
if (__VLS_ctx.activeSlide) {
    __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
        ...{ class: "canvas" },
    });
    __VLS_asFunctionalElement(__VLS_intrinsicElements.h1, __VLS_intrinsicElements.h1)({
        ...{ class: "slide-title" },
    });
    (__VLS_ctx.activeSlide.title);
    for (const [element] of __VLS_getVForSourceType((__VLS_ctx.activeSlide.elements))) {
        __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
            ...{ onMousedown: (...[$event]) => {
                    if (!(__VLS_ctx.activeSlide))
                        return;
                    __VLS_ctx.onElementMouseDown($event, element.id);
                } },
            ...{ onDblclick: (...[$event]) => {
                    if (!(__VLS_ctx.activeSlide))
                        return;
                    __VLS_ctx.selectedElementId = element.id;
                } },
            key: (element.id),
            ...{ class: "element" },
            ...{ class: ({ selected: __VLS_ctx.selectedElementId === element.id }) },
            ...{ style: ({
                    left: `${element.x}px`,
                    top: `${element.y}px`,
                    width: `${element.width}px`,
                    height: `${element.height}px`,
                    background: 'transparent',
                    border: 'none',
                    opacity: String(element.style.opacity),
                    borderRadius: `${element.style.borderRadius || 0}px`
                }) },
        });
        if (element.type === 'text') {
            __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
                ...{ onInput: (...[$event]) => {
                        if (!(__VLS_ctx.activeSlide))
                            return;
                        if (!(element.type === 'text'))
                            return;
                        __VLS_ctx.updateElementText($event, element);
                    } },
                ...{ class: "text-element" },
                contenteditable: true,
                ...{ style: ({
                        fontSize: `${element.style.fontSize || 22}px`,
                        fontWeight: String(element.style.fontWeight || 500),
                        textAlign: element.style.textAlign || 'left'
                    }) },
            });
            (element.content?.text);
        }
        else if (element.type === 'image') {
            __VLS_asFunctionalElement(__VLS_intrinsicElements.img)({
                ...{ class: "image-element" },
                src: (element.content?.src),
                alt: "img",
            });
        }
        else {
            __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
                ...{ class: "shape-element" },
                ...{ style: ({
                        background: element.style.fill,
                        border: `1px solid ${element.style.stroke}`,
                        clipPath: element.content?.shapeKind === 'triangle'
                            ? 'polygon(50% 0%, 0% 100%, 100% 100%)'
                            : element.content?.shapeKind === 'diamond'
                                ? 'polygon(50% 0%, 100% 50%, 50% 100%, 0% 50%)'
                                : 'none',
                        borderRadius: element.content?.shapeKind === 'circle'
                            ? '50%'
                            : element.content?.shapeKind === 'roundRect'
                                ? '16px'
                                : `${element.style.borderRadius || 0}px`
                    }) },
            });
        }
        __VLS_asFunctionalElement(__VLS_intrinsicElements.span, __VLS_intrinsicElements.span)({
            ...{ onMousedown: (...[$event]) => {
                    if (!(__VLS_ctx.activeSlide))
                        return;
                    __VLS_ctx.onResizeMouseDown($event, element.id);
                } },
            ...{ class: "resize-handle" },
        });
    }
}
else {
    __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
        ...{ class: "empty" },
    });
}
__VLS_asFunctionalElement(__VLS_intrinsicElements.aside, __VLS_intrinsicElements.aside)({
    ...{ class: "right-panel" },
});
__VLS_asFunctionalElement(__VLS_intrinsicElements.h3, __VLS_intrinsicElements.h3)({});
if (__VLS_ctx.selectedElement) {
    __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
        ...{ class: "stack" },
    });
    __VLS_asFunctionalElement(__VLS_intrinsicElements.label, __VLS_intrinsicElements.label)({});
    __VLS_asFunctionalElement(__VLS_intrinsicElements.input)({
        ...{ onInput: (...[$event]) => {
                if (!(__VLS_ctx.selectedElement))
                    return;
                __VLS_ctx.updateSelectedStyle('fill', $event.target.value);
            } },
        type: "color",
        value: (__VLS_ctx.selectedElement.style.fill),
    });
    __VLS_asFunctionalElement(__VLS_intrinsicElements.label, __VLS_intrinsicElements.label)({});
    __VLS_asFunctionalElement(__VLS_intrinsicElements.input)({
        ...{ onInput: (...[$event]) => {
                if (!(__VLS_ctx.selectedElement))
                    return;
                __VLS_ctx.updateSelectedStyle('stroke', $event.target.value);
            } },
        type: "color",
        value: (__VLS_ctx.selectedElement.style.stroke),
    });
    __VLS_asFunctionalElement(__VLS_intrinsicElements.label, __VLS_intrinsicElements.label)({});
    __VLS_asFunctionalElement(__VLS_intrinsicElements.input)({
        ...{ onInput: (...[$event]) => {
                if (!(__VLS_ctx.selectedElement))
                    return;
                __VLS_ctx.updateSelectedStyle('opacity', Number($event.target.value));
            } },
        type: "range",
        min: "0.1",
        max: "1",
        step: "0.05",
        value: (__VLS_ctx.selectedElement.style.opacity),
    });
    if (__VLS_ctx.selectedElement.type === 'text') {
        __VLS_asFunctionalElement(__VLS_intrinsicElements.label, __VLS_intrinsicElements.label)({});
    }
    if (__VLS_ctx.selectedElement.type === 'text') {
        __VLS_asFunctionalElement(__VLS_intrinsicElements.input)({
            ...{ onInput: (...[$event]) => {
                    if (!(__VLS_ctx.selectedElement))
                        return;
                    if (!(__VLS_ctx.selectedElement.type === 'text'))
                        return;
                    __VLS_ctx.updateSelectedStyle('fontSize', Number($event.target.value));
                } },
            type: "number",
            min: "12",
            max: "72",
            value: (__VLS_ctx.selectedElement.style.fontSize || 24),
        });
    }
    if (__VLS_ctx.selectedElement.type === 'shape') {
        __VLS_asFunctionalElement(__VLS_intrinsicElements.label, __VLS_intrinsicElements.label)({});
    }
    if (__VLS_ctx.selectedElement.type === 'shape') {
        __VLS_asFunctionalElement(__VLS_intrinsicElements.select, __VLS_intrinsicElements.select)({
            ...{ onChange: (...[$event]) => {
                    if (!(__VLS_ctx.selectedElement))
                        return;
                    if (!(__VLS_ctx.selectedElement.type === 'shape'))
                        return;
                    __VLS_ctx.updateSelectedShapeKind($event.target.value);
                } },
            value: (__VLS_ctx.selectedElement.content?.shapeKind || 'rect'),
        });
        __VLS_asFunctionalElement(__VLS_intrinsicElements.option, __VLS_intrinsicElements.option)({
            value: "rect",
        });
        __VLS_asFunctionalElement(__VLS_intrinsicElements.option, __VLS_intrinsicElements.option)({
            value: "roundRect",
        });
        __VLS_asFunctionalElement(__VLS_intrinsicElements.option, __VLS_intrinsicElements.option)({
            value: "circle",
        });
        __VLS_asFunctionalElement(__VLS_intrinsicElements.option, __VLS_intrinsicElements.option)({
            value: "triangle",
        });
        __VLS_asFunctionalElement(__VLS_intrinsicElements.option, __VLS_intrinsicElements.option)({
            value: "diamond",
        });
    }
}
else {
    __VLS_asFunctionalElement(__VLS_intrinsicElements.p, __VLS_intrinsicElements.p)({
        ...{ class: "muted" },
    });
}
__VLS_asFunctionalElement(__VLS_intrinsicElements.h3, __VLS_intrinsicElements.h3)({});
__VLS_asFunctionalElement(__VLS_intrinsicElements.textarea, __VLS_intrinsicElements.textarea)({
    ...{ onInput: (__VLS_ctx.onCodeInput) },
    value: (__VLS_ctx.codeText),
    rows: "26",
});
__VLS_asFunctionalElement(__VLS_intrinsicElements.button, __VLS_intrinsicElements.button)({
    ...{ onClick: (__VLS_ctx.applyCodeToCanvas) },
    disabled: (__VLS_ctx.role === 'viewer'),
});
/** @type {__VLS_StyleScopedClasses['layout']} */ ;
/** @type {__VLS_StyleScopedClasses['left-panel']} */ ;
/** @type {__VLS_StyleScopedClasses['row']} */ ;
/** @type {__VLS_StyleScopedClasses['slides']} */ ;
/** @type {__VLS_StyleScopedClasses['slide-item']} */ ;
/** @type {__VLS_StyleScopedClasses['stack']} */ ;
/** @type {__VLS_StyleScopedClasses['row']} */ ;
/** @type {__VLS_StyleScopedClasses['muted']} */ ;
/** @type {__VLS_StyleScopedClasses['stack']} */ ;
/** @type {__VLS_StyleScopedClasses['row']} */ ;
/** @type {__VLS_StyleScopedClasses['muted']} */ ;
/** @type {__VLS_StyleScopedClasses['muted']} */ ;
/** @type {__VLS_StyleScopedClasses['error']} */ ;
/** @type {__VLS_StyleScopedClasses['warn']} */ ;
/** @type {__VLS_StyleScopedClasses['center-panel']} */ ;
/** @type {__VLS_StyleScopedClasses['toolbar']} */ ;
/** @type {__VLS_StyleScopedClasses['canvas']} */ ;
/** @type {__VLS_StyleScopedClasses['slide-title']} */ ;
/** @type {__VLS_StyleScopedClasses['element']} */ ;
/** @type {__VLS_StyleScopedClasses['text-element']} */ ;
/** @type {__VLS_StyleScopedClasses['image-element']} */ ;
/** @type {__VLS_StyleScopedClasses['shape-element']} */ ;
/** @type {__VLS_StyleScopedClasses['resize-handle']} */ ;
/** @type {__VLS_StyleScopedClasses['empty']} */ ;
/** @type {__VLS_StyleScopedClasses['right-panel']} */ ;
/** @type {__VLS_StyleScopedClasses['stack']} */ ;
/** @type {__VLS_StyleScopedClasses['muted']} */ ;
var __VLS_dollars;
const __VLS_self = (await import('vue')).defineComponent({
    setup() {
        return {
            decks: decks,
            activeDeckId: activeDeckId,
            activeSlideId: activeSlideId,
            selectedElementId: selectedElementId,
            collaborators: collaborators,
            error: error,
            status: status,
            codeText: codeText,
            conflictMessage: conflictMessage,
            markdownInput: markdownInput,
            aiTopic: aiTopic,
            aiProvider: aiProvider,
            aiModel: aiModel,
            aiApiKey: aiApiKey,
            aiApiEndpoint: aiApiEndpoint,
            visualHints: visualHints,
            collabEnabled: collabEnabled,
            role: role,
            exportState: exportState,
            exportLinks: exportLinks,
            uploadInputRef: uploadInputRef,
            activeDeck: activeDeck,
            activeSlide: activeSlide,
            selectedElement: selectedElement,
            ensureSelectedSlide: ensureSelectedSlide,
            onCreateDeck: onCreateDeck,
            onAddSlide: onAddSlide,
            addElement: addElement,
            onPickLocalImage: onPickLocalImage,
            onLocalImageSelected: onLocalImageSelected,
            applyCodeToCanvas: applyCodeToCanvas,
            onCodeInput: onCodeInput,
            updateSelectedStyle: updateSelectedStyle,
            updateSelectedShapeKind: updateSelectedShapeKind,
            onElementMouseDown: onElementMouseDown,
            onResizeMouseDown: onResizeMouseDown,
            enableCollab: enableCollab,
            disableCollab: disableCollab,
            onAIGenerate: onAIGenerate,
            onSaveAIConfig: onSaveAIConfig,
            onPolishSelected: onPolishSelected,
            onImportMarkdown: onImportMarkdown,
            onExport: onExport,
            updateElementText: updateElementText,
        };
    },
});
export default (await import('vue')).defineComponent({
    setup() {
        return {};
    },
});
; /* PartiallyEnd: #4569/main.vue */
