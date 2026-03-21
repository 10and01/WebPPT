export type PermissionRole = "owner" | "editor" | "viewer";

export interface Permission {
  userId: string;
  role: PermissionRole;
  grantedAt: number;
}

export type ElementType = "text" | "shape" | "image";

export interface ElementStyle {
  fill: string;
  stroke: string;
  strokeWidth: number;
  opacity: number;
  fontSize?: number;
  fontWeight?: number;
  fontFamily?: string;
  color?: string;
  textAlign?: "left" | "center" | "right";
  borderRadius?: number;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  zIndex?: number;
}

export interface ElementModel {
  id: string;
  slideId: string;
  type: ElementType;
  x: number;
  y: number;
  width: number;
  height: number;
  rotate: number;
  zIndex: number;
  locked?: boolean;
  content?: {
    text?: string;
    src?: string;
    alt?: string;
    shapeKind?: "rect" | "roundRect" | "circle" | "triangle" | "diamond";
  };
  style: ElementStyle;
}

export interface Slide {
  id: string;
  deckId: string;
  slideNumber: number;
  title: string;
  bgColor: string;
  elements: ElementModel[];
  activeEditorId?: string;
  createdAt: number;
  updatedAt: number;
}

export interface AIConfig {
  provider: "openai" | "anthropic" | "ollama";
  apiEndpoint?: string;
  apiKey?: string;
  model?: string;
  temperature?: number;
  maxTokens?: number;
}

export interface Deck {
  id: string;
  title: string;
  createdBy: string;
  createdAt: number;
  updatedAt: number;
  version: number;
  permissions: Permission[];
  slides: Slide[];
  aiConfig: AIConfig;
}

export interface CollaboratorPresence {
  userId: string;
  userName: string;
  color: string;
  role: PermissionRole;
  activeSlideId?: string;
  cursorX?: number;
  cursorY?: number;
  updatedAt: number;
}

export interface CollabState {
  deckId: string;
  version: number;
  collaborators: CollaboratorPresence[];
  lastSyncTime?: number;
  yStateBase64?: string;
}

export interface SessionRecoveryState {
  deckId: string;
  userId: string;
  yStateBase64: string;
  version: number;
  timestamp: number;
}

export interface GenerateDeckRequest {
  topic: string;
  slides: number;
}

export interface GenerateDeckResponse {
  title: string;
  slideDrafts: Array<{ title: string; bullets: string[]; visualHint: string }>;
}

export interface PolishTextRequest {
  text: string;
  mode: "shorten" | "expand" | "professional";
}

export interface ImportMarkdownRequest {
  markdown: string;
}

export interface ExportDeckRequest {
  deckId: string;
  format: "html" | "pdf" | "png" | "pptx";
}

export interface ExportJob {
  id: string;
  deckId: string;
  format: "html" | "pdf" | "png" | "pptx";
  status: "pending" | "processing" | "completed" | "failed";
  message?: string;
  outputPath?: string;
  outputFiles?: string[];
  createdAt: number;
  updatedAt: number;
}

export interface CreateDeckRequest {
  title: string;
  createdBy: string;
}

export interface AddSlideRequest {
  title?: string;
}
