import type { AddSlideRequest, AIConfig, CreateDeckRequest, Deck, ElementModel, ExportDeckRequest, ExportJob, GenerateDeckRequest, ImportMarkdownRequest, PolishTextRequest, Slide } from "@web-ppt/shared";
export declare function listDecks(): Promise<Deck[]>;
export declare function createDeck(input: CreateDeckRequest): Promise<Deck>;
export declare function addSlide(deckId: string, input: AddSlideRequest): Promise<Slide>;
export declare function replaceSlideElements(deckId: string, slideId: string, elements: ElementModel[]): Promise<Slide>;
export declare function updateAIConfig(deckId: string, aiConfig: Partial<AIConfig>): Promise<Deck>;
export declare function generateDeckDraft(deckId: string, input: GenerateDeckRequest): Promise<{
    draft: {
        title: string;
        slideDrafts: Array<{
            title: string;
            bullets: string[];
            visualHint: string;
        }>;
    };
}>;
export declare function polishSelectedText(deckId: string, input: PolishTextRequest): Promise<{
    content: string;
}>;
export declare function suggestVisuals(deckId: string, text: string): Promise<{
    suggestions: string[];
}>;
export declare function importMarkdown(deckId: string, input: ImportMarkdownRequest): Promise<Deck>;
export declare function startExport(input: ExportDeckRequest): Promise<{
    job: ExportJob;
}>;
export declare function getExportJob(jobId: string): Promise<{
    job: ExportJob;
}>;
