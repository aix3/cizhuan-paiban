import type {
  AnchorSide,
  ManualDivider,
  ManualSplit,
  Obstacle,
  OriginSettings,
  PaperSize,
  Surface,
  TextAnnotation,
  TileMerge,
  TileSpec,
  TileVisual
} from "../types";

export const WORKSPACE_STORAGE_KEY = "tile-layout-studio:draft:v1";
export const WORKSPACE_STORAGE_VERSION = 2;
const LEGACY_DRAFT_VERSION = 1;

export interface LayoutDraft {
  surface: Surface;
  tileSpec: TileSpec;
  origin: OriginSettings;
  obstacles: Obstacle[];
  defaultVisual: TileVisual;
  tileVisuals: Record<string, TileVisual>;
  manualDividers: ManualDivider[];
  tileMerges: TileMerge[];
  splits: ManualSplit[];
  textAnnotations: TextAnnotation[];
  paperSize: PaperSize;
  zoom: number;
}

export type LayoutHistorySnapshot = Omit<LayoutDraft, "paperSize" | "zoom">;

export interface LayoutTab {
  id: string;
  title: string;
  draft: LayoutDraft;
}

export interface SavedWorkspace {
  version: typeof WORKSPACE_STORAGE_VERSION;
  tabs: LayoutTab[];
  activeTabId: string;
  updatedAt: string;
}

const defaultSurface: Surface = {
  label: "",
  width: 3600,
  height: 2400
};

const defaultTileSpec: TileSpec = {
  width: 600,
  height: 600,
  grout: 3,
  pattern: "straight"
};

const defaultOrigin: OriginSettings = {
  anchorX: "start" as AnchorSide,
  anchorY: "start" as AnchorSide,
  offsetX: 0,
  offsetY: 0
};

const defaultVisual: TileVisual = {
  mode: "color",
  color: "#d8c8b0"
};

function cloneValue<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export function createDefaultLayoutDraft(): LayoutDraft {
  return {
    surface: cloneValue(defaultSurface),
    tileSpec: cloneValue(defaultTileSpec),
    origin: cloneValue(defaultOrigin),
    obstacles: [],
    defaultVisual: cloneValue(defaultVisual),
    tileVisuals: {},
    manualDividers: [],
    tileMerges: [],
    splits: [],
    textAnnotations: [],
    paperSize: "a3",
    zoom: 1
  };
}

export function draftTitle(draft: LayoutDraft) {
  return draft.surface.label.trim() || "未命名排版";
}

export function normalizeLayoutDraft(value: Partial<LayoutDraft> | null | undefined): LayoutDraft {
  const fallback = createDefaultLayoutDraft();

  return {
    surface: value?.surface ?? fallback.surface,
    tileSpec: value?.tileSpec ?? fallback.tileSpec,
    origin: value?.origin ?? fallback.origin,
    obstacles: value?.obstacles ?? fallback.obstacles,
    defaultVisual: value?.defaultVisual ?? fallback.defaultVisual,
    tileVisuals: value?.tileVisuals ?? fallback.tileVisuals,
    manualDividers: value?.manualDividers ?? fallback.manualDividers,
    tileMerges: value?.tileMerges ?? fallback.tileMerges,
    splits: value?.splits ?? fallback.splits,
    textAnnotations: value?.textAnnotations ?? fallback.textAnnotations,
    paperSize: value?.paperSize ?? fallback.paperSize,
    zoom: value?.zoom ?? fallback.zoom
  };
}

export function createLayoutTab(id: string, draft = createDefaultLayoutDraft()): LayoutTab {
  const normalizedDraft = normalizeLayoutDraft(draft);
  return {
    id,
    title: draftTitle(normalizedDraft),
    draft: normalizedDraft
  };
}

export function createDefaultWorkspace(tabId: string, updatedAt = new Date().toISOString()): SavedWorkspace {
  const tab = createLayoutTab(tabId);
  return {
    version: WORKSPACE_STORAGE_VERSION,
    tabs: [tab],
    activeTabId: tab.id,
    updatedAt
  };
}

export function syncActiveTab(tabs: LayoutTab[], activeTabId: string, activeDraft: LayoutDraft): LayoutTab[] {
  return tabs.map((tab) =>
    tab.id === activeTabId
      ? {
          ...tab,
          title: draftTitle(activeDraft),
          draft: cloneValue(activeDraft)
        }
      : tab
  );
}

export function chooseActiveTabAfterClose(tabs: LayoutTab[], activeTabId: string, closingTabId: string) {
  if (tabs.length <= 1) return activeTabId;
  if (activeTabId !== closingTabId) return activeTabId;

  const closingIndex = Math.max(0, tabs.findIndex((tab) => tab.id === closingTabId));
  const remaining = tabs.filter((tab) => tab.id !== closingTabId);
  return remaining[Math.min(closingIndex, remaining.length - 1)]?.id ?? remaining[0]?.id ?? activeTabId;
}

export function closeLayoutTab(tabs: LayoutTab[], activeTabId: string, closingTabId: string) {
  if (tabs.length <= 1 || !tabs.some((tab) => tab.id === closingTabId)) {
    return { tabs, activeTabId };
  }

  const nextActiveTabId = chooseActiveTabAfterClose(tabs, activeTabId, closingTabId);
  return {
    tabs: tabs.filter((tab) => tab.id !== closingTabId),
    activeTabId: nextActiveTabId
  };
}

export function parseSavedWorkspace(value: unknown): SavedWorkspace | null {
  if (!value || typeof value !== "object") return null;

  const parsed = value as Partial<SavedWorkspace> & { version?: number } & Partial<LayoutDraft>;

  if (parsed.version === WORKSPACE_STORAGE_VERSION) {
    const validTabs = Array.isArray(parsed.tabs)
      ? parsed.tabs
          .filter((tab): tab is LayoutTab => Boolean(tab?.id && tab?.draft))
          .map((tab) => createLayoutTab(tab.id, tab.draft))
      : [];

    if (!validTabs.length) return null;

    const activeTabId = validTabs.some((tab) => tab.id === parsed.activeTabId)
      ? String(parsed.activeTabId)
      : validTabs[0].id;

    return {
      version: WORKSPACE_STORAGE_VERSION,
      tabs: validTabs,
      activeTabId,
      updatedAt: parsed.updatedAt ?? ""
    };
  }

  if (parsed.version === LEGACY_DRAFT_VERSION) {
    const draft = normalizeLayoutDraft(parsed);
    const tab = createLayoutTab("legacy-tab", draft);
    return {
      version: WORKSPACE_STORAGE_VERSION,
      tabs: [tab],
      activeTabId: tab.id,
      updatedAt: parsed.updatedAt ?? ""
    };
  }

  return null;
}
