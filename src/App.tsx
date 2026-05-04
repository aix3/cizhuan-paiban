import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, MouseEvent } from "react";
import {
  Download,
  FileDown,
  FilePlus2,
  Grid2X2,
  Image as ImageIcon,
  Layers,
  Merge,
  Move,
  Palette,
  Plus,
  Redo2,
  RotateCw,
  Ruler,
  SplitSquareHorizontal,
  SplitSquareVertical,
  Type,
  Trash2,
  Ungroup,
  Undo2,
  X
} from "lucide-react";
import type {
  AnchorSide,
  DividerAxis,
  DividerEdge,
  LayoutPattern,
  ManualDivider,
  Obstacle,
  PaperSize,
  Point,
  SourceTile,
  SplitAxis,
  SplitSegment,
  Surface,
  TextAnnotation,
  TileMerge,
  TilePiece,
  TileSpec,
  TileVisual
} from "./types";
import { dimensionArrowPoints } from "./lib/cadDimensions";
import { clamp, pointsToPath, roundTo } from "./lib/geometry";
import { MIN_SPLIT_CHILD_SIZE, clampRectToSurface, computeLayout, getMergeCandidate, measureSplits, splitChildId } from "./lib/layout";
import { exportLayoutPdf, exportLayoutPng } from "./lib/pdf";
import { buildDividerSnapTargets, snapDividerPosition, type SnapResult } from "./lib/snapping";
import { buildTileLabelLayout, buildTileLabelMetrics } from "./lib/tileLabels";
import {
  WORKSPACE_STORAGE_KEY,
  WORKSPACE_STORAGE_VERSION,
  closeLayoutTab as closeWorkspaceLayoutTab,
  createDefaultLayoutDraft,
  createDefaultWorkspace,
  createLayoutTab,
  draftTitle,
  parseSavedWorkspace,
  syncActiveTab,
  type LayoutDraft,
  type LayoutHistorySnapshot,
  type LayoutTab,
  type SavedWorkspace
} from "./lib/workspace";

const anchorOptions: Array<{ value: AnchorSide; label: string }> = [
  { value: "start", label: "前" },
  { value: "center", label: "中" },
  { value: "end", label: "后" }
];

interface DividerHandle {
  id: string;
  kind: "pair" | "single";
  axis: DividerAxis;
  beforeId?: string;
  afterId?: string;
  sourceId?: string;
  edge?: DividerEdge;
  basePosition: number;
  position: number;
  gap: number;
  start: number;
  end: number;
  minPosition: number;
  maxPosition: number;
}

interface SplitDividerHandle {
  id: string;
  axis: DividerAxis;
  splitId: string;
  position: number;
  start: number;
  end: number;
  minPosition: number;
  maxPosition: number;
  parentStart: number;
  parentSize: number;
}

interface TabHistoryState {
  undoStack: LayoutHistorySnapshot[];
  redoStack: LayoutHistorySnapshot[];
}

function uid(prefix: string) {
  return `${prefix}-${Math.random().toString(36).slice(2, 8)}-${Date.now().toString(36)}`;
}

function createEmptyTabHistory(): TabHistoryState {
  return {
    undoStack: [],
    redoStack: []
  };
}

function loadSavedWorkspace(): SavedWorkspace {
  const fallback = () => createDefaultWorkspace(uid("layout-tab"));

  if (typeof window === "undefined") return fallback();

  try {
    const raw = window.localStorage.getItem(WORKSPACE_STORAGE_KEY);
    if (!raw) return fallback();

    return parseSavedWorkspace(JSON.parse(raw)) ?? fallback();
  } catch (error) {
    console.warn("读取本地排版工作区失败", error);
    return fallback();
  }
}

function mm(value: number) {
  return `${Math.round(value)}毫米`;
}

function squareMeters(value: number) {
  return `${(value / 1_000_000).toFixed(2)} m²`;
}

function cloneValue<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function annotationLines(text: string) {
  return text.split(/\r?\n/);
}

function textAnnotationBox(annotation: TextAnnotation) {
  const lines = annotationLines(annotation.text || "文字标注");
  const maxChars = Math.max(1, ...lines.map((line) => line.length));
  const width = maxChars * annotation.fontSize * 0.62 + 28;
  const height = lines.length * annotation.fontSize * 1.2 + 20;

  return {
    x: annotation.x - 14,
    y: annotation.y - annotation.fontSize * 0.9,
    width,
    height
  };
}

function Field({
  label,
  children
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
    </label>
  );
}

function NumberField({
  label,
  value,
  min = 0,
  max,
  step = 1,
  disabled = false,
  onChange
}: {
  label: string;
  value: number;
  min?: number;
  max?: number;
  step?: number;
  disabled?: boolean;
  onChange: (value: number) => void;
}) {
  return (
    <Field label={label}>
      <input
        type="number"
        min={min}
        max={max}
        step={step}
        value={Number.isFinite(value) ? value : 0}
        disabled={disabled}
        onChange={(event) => onChange(Number(event.target.value))}
      />
    </Field>
  );
}

function PrecisionNumberField({
  label,
  value,
  min = 0,
  max,
  disabled = false,
  onCommit
}: {
  label: string;
  value: number;
  min?: number;
  max?: number;
  disabled?: boolean;
  onCommit: (value: number) => void;
}) {
  const [draft, setDraft] = useState(() => String(Math.round(value)));

  useEffect(() => {
    setDraft(String(Math.round(value)));
  }, [disabled, value]);

  const commitDraft = () => {
    const next = Number(draft);
    if (!Number.isFinite(next)) {
      setDraft(String(Math.round(value)));
      return;
    }
    onCommit(next);
  };

  return (
    <Field label={label}>
      <input
        type="number"
        min={min}
        max={max}
        step={1}
        value={draft}
        disabled={disabled}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commitDraft}
        onKeyDown={(event) => {
          if (event.key !== "Enter") return;
          commitDraft();
          event.currentTarget.blur();
        }}
      />
    </Field>
  );
}

function getSvgPoint(svg: SVGSVGElement, event: React.PointerEvent | PointerEvent): Point {
  const point = svg.createSVGPoint();
  point.x = event.clientX;
  point.y = event.clientY;
  const matrix = svg.getScreenCTM();
  if (!matrix) return { x: 0, y: 0 };
  const transformed = point.matrixTransform(matrix.inverse());
  return { x: transformed.x, y: transformed.y };
}

function dividerKey(axis: DividerAxis, sourceIds: [string, string]) {
  return `${axis}:${sourceIds[0]}:${sourceIds[1]}`;
}

function sourceEdgeKey(axis: DividerAxis, sourceId: string, edge: DividerEdge) {
  return `${axis}:${sourceId}:${edge}`;
}

function edgeAxis(edge: DividerEdge): DividerAxis {
  return edge === "left" || edge === "right" ? "x" : "y";
}

function edgePosition(source: SourceTile, edge: DividerEdge) {
  if (edge === "left") return source.x;
  if (edge === "right") return source.x + source.width;
  if (edge === "top") return source.y;
  return source.y + source.height;
}

function edgeBasePosition(source: SourceTile, edge: DividerEdge) {
  if (edge === "left") return source.baseRect.x;
  if (edge === "right") return source.baseRect.x + source.baseRect.width;
  if (edge === "top") return source.baseRect.y;
  return source.baseRect.y + source.baseRect.height;
}

function buildLocalDividerHandles(
  surface: Surface,
  baseSources: SourceTile[],
  sources: SourceTile[],
  dividers: ManualDivider[],
  grout: number
): DividerHandle[] {
  const currentById = new Map(sources.map((source) => [source.id, source]));
  const coveredEdges = new Set<string>();
  const dividerByKey = new Map(
    dividers
      .filter((divider): divider is ManualDivider & { sourceIds: [string, string] } => Boolean(divider.sourceIds))
      .map((divider) => [dividerKey(divider.axis, divider.sourceIds), divider])
  );
  const dividerBySourceEdge = new Map(
    dividers
      .filter((divider): divider is ManualDivider & { sourceId: string; edge: DividerEdge } => Boolean(divider.sourceId && divider.edge))
      .map((divider) => [sourceEdgeKey(divider.axis, divider.sourceId, divider.edge), divider])
  );
  const maxGap = Math.max(8, grout + 4);
  const handles: DividerHandle[] = [];

  baseSources.forEach((before) => {
    baseSources.forEach((after) => {
      if (before.id === after.id) return;

      const beforeRight = before.baseRect.x + before.baseRect.width;
      const afterLeft = after.baseRect.x;
      const horizontalOverlap = Math.min(before.baseRect.y + before.baseRect.height, after.baseRect.y + after.baseRect.height) - Math.max(before.baseRect.y, after.baseRect.y);
      const xGap = afterLeft - beforeRight;

      if (xGap >= -0.01 && xGap <= maxGap && horizontalOverlap > 20) {
        const sourceIds: [string, string] = [before.id, after.id];
        const currentBefore = currentById.get(before.id) ?? before;
        const currentAfter = currentById.get(after.id) ?? after;
        const gap = Math.max(0, xGap);
        const manual = dividerByKey.get(dividerKey("x", sourceIds));
        const basePosition = (beforeRight + afterLeft) / 2;
        const start = Math.max(currentBefore.y, currentAfter.y);
        const end = Math.min(currentBefore.y + currentBefore.height, currentAfter.y + currentAfter.height);
        const minPosition = currentBefore.x + 20 + gap / 2;
        const maxPosition = currentAfter.x + currentAfter.width - 20 - gap / 2;

        if (end - start > 20 && maxPosition - minPosition > 20) {
          coveredEdges.add(sourceEdgeKey("x", before.id, "right"));
          coveredEdges.add(sourceEdgeKey("x", after.id, "left"));
          handles.push({
            id: dividerKey("x", sourceIds),
            kind: "pair",
            axis: "x",
            beforeId: before.id,
            afterId: after.id,
            basePosition,
            position: manual?.position ?? basePosition,
            gap,
            start,
            end,
            minPosition,
            maxPosition
          });
        }
      }

      const beforeBottom = before.baseRect.y + before.baseRect.height;
      const afterTop = after.baseRect.y;
      const verticalOverlap = Math.min(before.baseRect.x + before.baseRect.width, after.baseRect.x + after.baseRect.width) - Math.max(before.baseRect.x, after.baseRect.x);
      const yGap = afterTop - beforeBottom;

      if (yGap >= -0.01 && yGap <= maxGap && verticalOverlap > 20) {
        const sourceIds: [string, string] = [before.id, after.id];
        const currentBefore = currentById.get(before.id) ?? before;
        const currentAfter = currentById.get(after.id) ?? after;
        const gap = Math.max(0, yGap);
        const manual = dividerByKey.get(dividerKey("y", sourceIds));
        const basePosition = (beforeBottom + afterTop) / 2;
        const start = Math.max(currentBefore.x, currentAfter.x);
        const end = Math.min(currentBefore.x + currentBefore.width, currentAfter.x + currentAfter.width);
        const minPosition = currentBefore.y + 20 + gap / 2;
        const maxPosition = currentAfter.y + currentAfter.height - 20 - gap / 2;

        if (end - start > 20 && maxPosition - minPosition > 20) {
          coveredEdges.add(sourceEdgeKey("y", before.id, "bottom"));
          coveredEdges.add(sourceEdgeKey("y", after.id, "top"));
          handles.push({
            id: dividerKey("y", sourceIds),
            kind: "pair",
            axis: "y",
            beforeId: before.id,
            afterId: after.id,
            basePosition,
            position: manual?.position ?? basePosition,
            gap,
            start,
            end,
            minPosition,
            maxPosition
          });
        }
      }
    });
  });

  sources.forEach((source) => {
    (["left", "right", "top", "bottom"] as DividerEdge[]).forEach((edge) => {
      const axis = edgeAxis(edge);
      const key = sourceEdgeKey(axis, source.id, edge);
      if (coveredEdges.has(key)) return;

      const position = edgePosition(source, edge);
      const limit = axis === "x" ? surface.width : surface.height;
      if (position < -0.01 || position > limit + 0.01) return;

      const start = axis === "x" ? Math.max(0, source.y) : Math.max(0, source.x);
      const end = axis === "x"
        ? Math.min(surface.height, source.y + source.height)
        : Math.min(surface.width, source.x + source.width);
      if (end - start <= 20) return;

      const manual = dividerBySourceEdge.get(key);
      const minPosition = edge === "left" || edge === "top" ? 0 : (axis === "x" ? source.x : source.y) + 20;
      const maxPosition = edge === "left" || edge === "top"
        ? (axis === "x" ? source.x + source.width : source.y + source.height) - 20
        : limit;
      if (maxPosition - minPosition <= 20) return;

      handles.push({
        id: key,
        kind: "single",
        axis,
        sourceId: source.id,
        edge,
        basePosition: edgeBasePosition(source, edge),
        position: manual?.position ?? position,
        gap: 0,
        start,
        end,
        minPosition,
        maxPosition
      });
    });
  });

  return handles;
}

function findSizeHandle(handles: DividerHandle[], axis: DividerAxis, sourceId: string) {
  const preferredEdge = axis === "x" ? "right" : "bottom";
  const fallbackEdge = axis === "x" ? "left" : "top";
  return (
    handles.find((handle) => handle.kind === "pair" && handle.axis === axis && handle.beforeId === sourceId) ??
    handles.find((handle) => handle.kind === "single" && handle.axis === axis && handle.sourceId === sourceId && handle.edge === preferredEdge) ??
    handles.find((handle) => handle.kind === "pair" && handle.axis === axis && handle.afterId === sourceId) ??
    handles.find((handle) => handle.kind === "single" && handle.axis === axis && handle.sourceId === sourceId && handle.edge === fallbackEdge) ??
    null
  );
}

function sizeBoundsFromHandle(handle: DividerHandle | null, piece: TilePiece | null, sourceId: string | null) {
  if (!handle || !piece || !sourceId) return null;

  if (handle.kind === "single") {
    const start = handle.axis === "x" ? piece.x : piece.y;
    const end = handle.axis === "x" ? piece.x + piece.width : piece.y + piece.height;

    if (handle.edge === "right" || handle.edge === "bottom") {
      return {
        min: 20,
        max: Math.max(20, Math.floor(handle.maxPosition - start))
      };
    }

    return {
      min: 20,
      max: Math.max(20, Math.floor(end - handle.minPosition))
    };
  }

  const halfGap = handle.gap / 2;
  const start = handle.axis === "x" ? piece.x : piece.y;
  const end = handle.axis === "x" ? piece.x + piece.width : piece.y + piece.height;

  if (handle.beforeId === sourceId) {
    return {
      min: Math.max(20, Math.ceil(handle.minPosition - start - halfGap)),
      max: Math.max(20, Math.floor(handle.maxPosition - start - halfGap))
    };
  }

  return {
    min: Math.max(20, Math.ceil(end - halfGap - handle.maxPosition)),
    max: Math.max(20, Math.floor(end - halfGap - handle.minPosition))
  };
}

function dividerPositionForSize(handle: DividerHandle, piece: TilePiece, sourceId: string, size: number) {
  if (handle.kind === "single") {
    if (handle.edge === "right" || handle.edge === "bottom") {
      const start = handle.axis === "x" ? piece.x : piece.y;
      return start + size;
    }

    const end = handle.axis === "x" ? piece.x + piece.width : piece.y + piece.height;
    return end - size;
  }

  const halfGap = handle.gap / 2;

  if (handle.beforeId === sourceId) {
    const start = handle.axis === "x" ? piece.x : piece.y;
    return start + size + halfGap;
  }

  const end = handle.axis === "x" ? piece.x + piece.width : piece.y + piece.height;
  return end - size - halfGap;
}

function buildSplitDividerHandles(segments: SplitSegment[]): SplitDividerHandle[] {
  return segments.map((segment) => {
    const axis: DividerAxis = segment.axis === "vertical" ? "x" : "y";
    const position = axis === "x" ? segment.start.x : segment.start.y;
    const parentStart = axis === "x" ? segment.parentRect.x : segment.parentRect.y;
    const parentSize = axis === "x" ? segment.parentRect.width : segment.parentRect.height;

    return {
      id: `split-divider:${segment.id}`,
      axis,
      splitId: segment.id,
      position,
      start: axis === "x" ? segment.start.y : segment.start.x,
      end: axis === "x" ? segment.end.y : segment.end.x,
      minPosition: parentStart + MIN_SPLIT_CHILD_SIZE,
      maxPosition: parentStart + parentSize - MIN_SPLIT_CHILD_SIZE,
      parentStart,
      parentSize
    };
  });
}

function App() {
  const [savedWorkspace] = useState<SavedWorkspace>(() => loadSavedWorkspace());
  const initialTab = savedWorkspace.tabs.find((tab) => tab.id === savedWorkspace.activeTabId) ?? savedWorkspace.tabs[0];
  const initialDraft = initialTab?.draft ?? createDefaultLayoutDraft();
  const [layoutTabs, setLayoutTabs] = useState<LayoutTab[]>(() => cloneValue(savedWorkspace.tabs));
  const [activeTabId, setActiveTabId] = useState(() => initialTab?.id ?? savedWorkspace.activeTabId);
  const [tabHistories, setTabHistories] = useState<Record<string, TabHistoryState>>({});
  const [surface, setSurface] = useState<Surface>(() => cloneValue(initialDraft.surface));
  const [tileSpec, setTileSpec] = useState<TileSpec>(() => cloneValue(initialDraft.tileSpec));
  const [origin, setOrigin] = useState(() => cloneValue(initialDraft.origin));
  const [obstacles, setObstacles] = useState<Obstacle[]>(() => cloneValue(initialDraft.obstacles));
  const [defaultVisual, setDefaultVisual] = useState<TileVisual>(() => cloneValue(initialDraft.defaultVisual));
  const [tileVisuals, setTileVisuals] = useState<Record<string, TileVisual>>(() => cloneValue(initialDraft.tileVisuals));
  const [manualDividers, setManualDividers] = useState<ManualDivider[]>(() => cloneValue(initialDraft.manualDividers));
  const [tileMerges, setTileMerges] = useState<TileMerge[]>(() => cloneValue(initialDraft.tileMerges));
  const [splits, setSplits] = useState(() => cloneValue(initialDraft.splits));
  const [textAnnotations, setTextAnnotations] = useState<TextAnnotation[]>(() => cloneValue(initialDraft.textAnnotations));
  const [selectedPieceIds, setSelectedPieceIds] = useState<string[]>([]);
  const [selectedObstacleId, setSelectedObstacleId] = useState<string | null>(null);
  const [selectedTextAnnotationId, setSelectedTextAnnotationId] = useState<string | null>(null);
  const [undoStack, setUndoStack] = useState<LayoutHistorySnapshot[]>([]);
  const [redoStack, setRedoStack] = useState<LayoutHistorySnapshot[]>([]);
  const [paperSize, setPaperSize] = useState<PaperSize>(() => initialDraft.paperSize);
  const [zoom, setZoom] = useState(() => initialDraft.zoom);
  const [snapPreview, setSnapPreview] = useState<(SnapResult & { axis: DividerAxis }) | null>(null);
  const [interaction, setInteraction] = useState<
    | { type: "none" }
    | { type: "divider"; handle: DividerHandle }
    | { type: "split-divider"; handle: SplitDividerHandle }
    | { type: "obstacle"; id: string; offsetX: number; offsetY: number }
    | { type: "text"; id: string; offsetX: number; offsetY: number }
  >({ type: "none" });
  const svgRef = useRef<SVGSVGElement>(null);

  const activeDraft = useMemo<LayoutDraft>(
    () => ({
      surface,
      tileSpec,
      origin,
      obstacles,
      defaultVisual,
      tileVisuals,
      manualDividers,
      tileMerges,
      splits,
      textAnnotations,
      paperSize,
      zoom
    }),
    [
      surface,
      tileSpec,
      origin,
      obstacles,
      defaultVisual,
      tileVisuals,
      manualDividers,
      tileMerges,
      splits,
      textAnnotations,
      paperSize,
      zoom
    ]
  );

  const displayTabs = useMemo(
    () => syncActiveTab(layoutTabs, activeTabId, activeDraft),
    [activeDraft, activeTabId, layoutTabs]
  );

  useEffect(() => {
    try {
      window.localStorage.setItem(
        WORKSPACE_STORAGE_KEY,
        JSON.stringify({
          version: WORKSPACE_STORAGE_VERSION,
          tabs: displayTabs,
          activeTabId,
          updatedAt: new Date().toISOString()
        })
      );
    } catch (error) {
      console.warn("保存本地排版工作区失败", error);
    }
  }, [activeTabId, displayTabs]);

  const createSnapshot = useCallback(
    (): LayoutHistorySnapshot =>
      cloneValue({
        surface,
        tileSpec,
        origin,
        obstacles,
        defaultVisual,
        tileVisuals,
        manualDividers,
        tileMerges,
        splits,
        textAnnotations
      }),
    [
      surface,
      tileSpec,
      origin,
      obstacles,
      defaultVisual,
      tileVisuals,
      manualDividers,
      tileMerges,
      splits,
      textAnnotations
    ]
  );

  const restoreSnapshot = useCallback((snapshot: LayoutHistorySnapshot) => {
    setSurface(cloneValue(snapshot.surface));
    setTileSpec(cloneValue(snapshot.tileSpec));
    setOrigin(cloneValue(snapshot.origin));
    setObstacles(cloneValue(snapshot.obstacles));
    setDefaultVisual(cloneValue(snapshot.defaultVisual));
    setTileVisuals(cloneValue(snapshot.tileVisuals));
    setManualDividers(cloneValue(snapshot.manualDividers));
    setTileMerges(cloneValue(snapshot.tileMerges));
    setSplits(cloneValue(snapshot.splits));
    setTextAnnotations(cloneValue(snapshot.textAnnotations));
    setSelectedPieceIds([]);
    setSelectedObstacleId(null);
    setSelectedTextAnnotationId(null);
    setSnapPreview(null);
    setInteraction({ type: "none" });
  }, []);

  const restoreDraft = useCallback((draft: LayoutDraft) => {
    setSurface(cloneValue(draft.surface));
    setTileSpec(cloneValue(draft.tileSpec));
    setOrigin(cloneValue(draft.origin));
    setObstacles(cloneValue(draft.obstacles));
    setDefaultVisual(cloneValue(draft.defaultVisual));
    setTileVisuals(cloneValue(draft.tileVisuals));
    setManualDividers(cloneValue(draft.manualDividers));
    setTileMerges(cloneValue(draft.tileMerges));
    setSplits(cloneValue(draft.splits));
    setTextAnnotations(cloneValue(draft.textAnnotations));
    setPaperSize(draft.paperSize);
    setZoom(draft.zoom);
    setSelectedPieceIds([]);
    setSelectedObstacleId(null);
    setSelectedTextAnnotationId(null);
    setSnapPreview(null);
    setInteraction({ type: "none" });
  }, []);

  const pushHistory = useCallback(() => {
    const snapshot = createSnapshot();
    const snapshotKey = JSON.stringify(snapshot);

    setUndoStack((current) => {
      if (current.length && JSON.stringify(current[current.length - 1]) === snapshotKey) return current;
      return [...current.slice(-49), snapshot];
    });
    setRedoStack([]);
  }, [createSnapshot]);

  const undo = useCallback(() => {
    const previous = undoStack[undoStack.length - 1];
    if (!previous) return;

    setUndoStack((current) => current.slice(0, -1));
    setRedoStack((current) => [createSnapshot(), ...current].slice(0, 50));
    restoreSnapshot(previous);
  }, [createSnapshot, restoreSnapshot, undoStack]);

  const redo = useCallback(() => {
    const next = redoStack[0];
    if (!next) return;

    setUndoStack((current) => [...current.slice(-49), createSnapshot()]);
    setRedoStack((current) => current.slice(1));
    restoreSnapshot(next);
  }, [createSnapshot, redoStack, restoreSnapshot]);

  const saveCurrentHistory = useCallback(
    (current: Record<string, TabHistoryState>) => ({
      ...current,
      [activeTabId]: {
        undoStack: cloneValue(undoStack),
        redoStack: cloneValue(redoStack)
      }
    }),
    [activeTabId, redoStack, undoStack]
  );

  const applyHistory = useCallback((history: TabHistoryState | undefined) => {
    const nextHistory = history ?? createEmptyTabHistory();
    setUndoStack(cloneValue(nextHistory.undoStack));
    setRedoStack(cloneValue(nextHistory.redoStack));
  }, []);

  const switchLayoutTab = useCallback(
    (tabId: string) => {
      if (tabId === activeTabId) return;

      const targetTab = displayTabs.find((tab) => tab.id === tabId);
      if (!targetTab) return;

      setLayoutTabs(displayTabs);
      setTabHistories((current) => saveCurrentHistory(current));
      restoreDraft(targetTab.draft);
      applyHistory(tabHistories[tabId]);
      setActiveTabId(tabId);
    },
    [activeTabId, applyHistory, displayTabs, restoreDraft, saveCurrentHistory, tabHistories]
  );

  const createNewLayoutTab = useCallback(() => {
    const draft = createDefaultLayoutDraft();
    const tab = createLayoutTab(uid("layout-tab"), draft);

    setLayoutTabs([...displayTabs, tab]);
    setTabHistories((current) => saveCurrentHistory(current));
    restoreDraft(draft);
    applyHistory(undefined);
    setActiveTabId(tab.id);
  }, [applyHistory, displayTabs, restoreDraft, saveCurrentHistory]);

  const closeLayoutTabById = useCallback(
    (tabId: string, event?: MouseEvent<HTMLButtonElement>) => {
      event?.stopPropagation();
      if (displayTabs.length <= 1) return;

      const closingTab = displayTabs.find((tab) => tab.id === tabId);
      if (!closingTab) return;

      const confirmed = window.confirm(`关闭「${draftTitle(closingTab.draft)}」排版？关闭后会删除该排版。`);
      if (!confirmed) return;

      const result = closeWorkspaceLayoutTab(displayTabs, activeTabId, tabId);
      const nextHistory = result.activeTabId === activeTabId ? undefined : tabHistories[result.activeTabId];

      setLayoutTabs(result.tabs);
      setTabHistories((current) => {
        const next = saveCurrentHistory(current);
        delete next[tabId];
        return next;
      });

      if (result.activeTabId !== activeTabId) {
        const nextActiveTab = result.tabs.find((tab) => tab.id === result.activeTabId);
        if (nextActiveTab) restoreDraft(nextActiveTab.draft);
        applyHistory(nextHistory);
        setActiveTabId(result.activeTabId);
      }
    },
    [activeTabId, applyHistory, displayTabs, restoreDraft, saveCurrentHistory, tabHistories]
  );

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const isTyping = target ? ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName) : false;
      if (isTyping || (!event.metaKey && !event.ctrlKey)) return;

      const key = event.key.toLowerCase();
      if (key === "z") {
        event.preventDefault();
        if (event.shiftKey) {
          redo();
        } else {
          undo();
        }
      }
      if (key === "y") {
        event.preventDefault();
        redo();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [redo, undo]);

  const layout = useMemo(
    () => computeLayout(surface, tileSpec, origin, obstacles, manualDividers, tileMerges, splits),
    [surface, tileSpec, origin, obstacles, manualDividers, tileMerges, splits]
  );

  const splitMeasurements = useMemo(() => measureSplits(layout.materialPieces, splits), [layout.materialPieces, splits]);

  const selectedPieces = selectedPieceIds
    .map((pieceId) => layout.pieces.find((piece) => piece.id === pieceId))
    .filter((piece): piece is TilePiece => Boolean(piece));
  const isSinglePieceSelection = selectedPieces.length === 1;
  const selectedPiece = selectedPieces[selectedPieces.length - 1] ?? null;
  const selectedSourceId = selectedPiece?.sourceId ?? null;
  const selectedSourceIds = Array.from(new Set(selectedPieces.map((piece) => piece.sourceId)));
  const selectedSources = selectedSourceIds
    .map((sourceId) => layout.baseSources.find((source) => source.id === sourceId))
    .filter((source): source is SourceTile => Boolean(source));
  const mergeCandidate = useMemo(
    () => getMergeCandidate(layout.baseSources, selectedSourceIds),
    [layout.baseSources, selectedSourceIds]
  );
  const canMergeSelection = Boolean(mergeCandidate) && selectedSources.every((source) => !source.mergedSourceIds?.length);
  const selectedMergedSourceIds = selectedSources
    .filter((source) => source.mergedSourceIds?.length)
    .map((source) => source.id);
  const selectedVisual = selectedSourceId ? tileVisuals[selectedSourceId] ?? defaultVisual : defaultVisual;
  const selectedTextAnnotation = textAnnotations.find((annotation) => annotation.id === selectedTextAnnotationId) ?? null;
  const selectedArea = selectedPieces.reduce((total, piece) => total + piece.area, 0);
  const canSplitHorizontally = isSinglePieceSelection && Boolean(selectedPiece && selectedPiece.height >= MIN_SPLIT_CHILD_SIZE * 2);
  const canSplitVertically = isSinglePieceSelection && Boolean(selectedPiece && selectedPiece.width >= MIN_SPLIT_CHILD_SIZE * 2);

  const clearManualEditsWithoutHistory = useCallback(() => {
    setManualDividers([]);
    setTileMerges([]);
    setSplits([]);
    setSelectedPieceIds([]);
  }, []);

  const clearManualEdits = useCallback(() => {
    pushHistory();
    clearManualEditsWithoutHistory();
  }, [clearManualEditsWithoutHistory, pushHistory]);

  const updateSurface = <K extends keyof Surface>(key: K, value: Surface[K]) => {
    pushHistory();
    setSurface((current) => ({ ...current, [key]: value }));
    clearManualEditsWithoutHistory();
  };

  const updateTileSpec = <K extends keyof TileSpec>(key: K, value: TileSpec[K]) => {
    pushHistory();
    setTileSpec((current) => ({ ...current, [key]: value }));
    clearManualEditsWithoutHistory();
  };

  const updateOrigin = <K extends keyof typeof origin>(key: K, value: (typeof origin)[K]) => {
    pushHistory();
    setOrigin((current) => ({ ...current, [key]: value }));
    clearManualEditsWithoutHistory();
  };

  const dividerHandles = useMemo(
    () => buildLocalDividerHandles(surface, layout.baseSources, layout.sources, manualDividers, tileSpec.grout),
    [layout.baseSources, layout.sources, manualDividers, surface, tileSpec.grout]
  );
  const splitDividerHandles = useMemo(
    () => buildSplitDividerHandles(layout.splitSegments),
    [layout.splitSegments]
  );
  const selectedWidthHandle = selectedSourceId ? findSizeHandle(dividerHandles, "x", selectedSourceId) : null;
  const selectedHeightHandle = selectedSourceId ? findSizeHandle(dividerHandles, "y", selectedSourceId) : null;
  const selectedWidthBounds = sizeBoundsFromHandle(selectedWidthHandle, selectedPiece, selectedSourceId);
  const selectedHeightBounds = sizeBoundsFromHandle(selectedHeightHandle, selectedPiece, selectedSourceId);

  const dividerSnapTargets = useMemo(
    () => ({
      x: buildDividerSnapTargets("x", surface, layout.baseSources, obstacles, manualDividers),
      y: buildDividerSnapTargets("y", surface, layout.baseSources, obstacles, manualDividers)
    }),
    [layout.baseSources, manualDividers, obstacles, surface]
  );

  const upsertDivider = (handle: DividerHandle, position: number) => {
    setManualDividers((current) => {
      const existing = current.find((divider) => {
        if (handle.kind === "single") {
          return Boolean(
            divider.sourceId &&
              divider.edge &&
              divider.axis === handle.axis &&
              divider.sourceId === handle.sourceId &&
              divider.edge === handle.edge
          );
        }

        return divider.sourceIds
          ? dividerKey(divider.axis, divider.sourceIds) === handle.id
          : divider.axis === handle.axis && Math.abs(divider.basePosition - handle.basePosition) < 0.01;
      });
      if (existing) {
        return current.map((divider) =>
          divider.id === existing.id ? { ...divider, position: roundTo(position) } : divider
        );
      }

      if (handle.kind === "single" && handle.sourceId && handle.edge) {
        return [
          ...current,
          {
            id: uid("divider"),
            axis: handle.axis,
            basePosition: handle.basePosition,
            position: roundTo(position),
            sourceId: handle.sourceId,
            edge: handle.edge,
            gap: 0
          }
        ];
      }

      if (!handle.beforeId || !handle.afterId) return current;
      const sourceIds: [string, string] = [handle.beforeId, handle.afterId];
      return [
        ...current,
        {
          id: uid("divider"),
          axis: handle.axis,
          basePosition: handle.basePosition,
          position: roundTo(position),
          sourceIds,
          gap: handle.gap
        }
      ];
    });
  };

  const updateSplitDivider = (handle: SplitDividerHandle, position: number) => {
    const ratio = clamp((position - handle.parentStart) / handle.parentSize, 0.05, 0.95);
    setSplits((current) =>
      current.map((split) =>
        split.id === handle.splitId
          ? {
              ...split,
              ratio: roundTo(ratio, 4)
            }
          : split
      )
    );
  };

  const updateSelectedTileSize = (axis: DividerAxis, value: number) => {
    if (!selectedPiece || !selectedSourceId || !Number.isFinite(value)) return;
    const handle = axis === "x" ? selectedWidthHandle : selectedHeightHandle;
    const bounds = axis === "x" ? selectedWidthBounds : selectedHeightBounds;
    if (!handle || !bounds) return;

    pushHistory();
    const clampedSize = clamp(value, bounds.min, bounds.max);
    const position = clamp(
      dividerPositionForSize(handle, selectedPiece, selectedSourceId, clampedSize),
      handle.minPosition,
      handle.maxPosition
    );
    upsertDivider(handle, position);
  };

  const splitSelectedTile = (axis: SplitAxis) => {
    if (!selectedPiece || !isSinglePieceSelection) return;
    if (axis === "horizontal" && !canSplitHorizontally) return;
    if (axis === "vertical" && !canSplitVertically) return;

    const splitId = uid("split");
    const parentPieceId = selectedPiece.id;

    pushHistory();
    setSplits((current) => [
      ...current.filter((split) => (split.parentPieceId ?? split.pieceId) !== parentPieceId),
      {
        id: splitId,
        parentPieceId,
        pieceId: parentPieceId,
        sourceId: selectedPiece.sourceId,
        axis,
        ratio: 0.5
      }
    ]);
    setSelectedPieceIds([splitChildId(parentPieceId, splitId, "a")]);
  };

  const handleSvgPointerMove = (event: React.PointerEvent<SVGSVGElement>) => {
    const svg = svgRef.current;
    if (!svg || interaction.type === "none") return;
    const point = getSvgPoint(svg, event);

    if (interaction.type === "divider") {
      const { handle } = interaction;
      const limit = handle.axis === "x" ? surface.width : surface.height;
      const rawPosition = handle.axis === "x" ? point.x : point.y;
      const targets = dividerSnapTargets[handle.axis].filter(
        (target) => target.position >= handle.minPosition && target.position <= handle.maxPosition
      );
      const next = snapDividerPosition(clamp(rawPosition, handle.minPosition, handle.maxPosition), limit, targets);
      setSnapPreview(next.snapped ? { ...next, axis: handle.axis } : null);
      upsertDivider(handle, next.position);
      return;
    }

    if (interaction.type === "split-divider") {
      const { handle } = interaction;
      const limit = handle.axis === "x" ? surface.width : surface.height;
      const rawPosition = handle.axis === "x" ? point.x : point.y;
      const targets = dividerSnapTargets[handle.axis].filter(
        (target) => target.position >= handle.minPosition && target.position <= handle.maxPosition
      );
      const next = snapDividerPosition(clamp(rawPosition, handle.minPosition, handle.maxPosition), limit, targets);
      setSnapPreview(next.snapped ? { ...next, axis: handle.axis } : null);
      updateSplitDivider(handle, next.position);
      return;
    }

    if (interaction.type === "text") {
      setTextAnnotations((current) =>
        current.map((annotation) =>
          annotation.id === interaction.id
            ? {
                ...annotation,
                x: roundTo(clamp(point.x - interaction.offsetX, 0, surface.width)),
                y: roundTo(clamp(point.y - interaction.offsetY, 0, surface.height))
              }
            : annotation
        )
      );
      return;
    }

    setObstacles((current) =>
      current.map((obstacle) => {
        if (obstacle.id !== interaction.id) return obstacle;
        return clampRectToSurface(
          {
            ...obstacle,
            x: point.x - interaction.offsetX,
            y: point.y - interaction.offsetY
          },
          surface
        ) as Obstacle;
      })
    );
  };

  const handlePiecePointerDown = (piece: TilePiece, event: React.PointerEvent<SVGRectElement>) => {
    event.stopPropagation();
    setSelectedObstacleId(null);
    setSelectedTextAnnotationId(null);
    const shouldToggle = event.shiftKey || event.metaKey || event.ctrlKey;

    setSelectedPieceIds((current) => {
      if (!shouldToggle) return [piece.id];
      if (current.includes(piece.id)) return current.filter((pieceId) => pieceId !== piece.id);
      return [...current, piece.id];
    });
  };

  const handleObstaclePointerDown = (obstacle: Obstacle, event: React.PointerEvent<SVGGElement>) => {
    event.stopPropagation();
    const svg = svgRef.current;
    if (!svg) return;
    const point = getSvgPoint(svg, event);
    pushHistory();
    setSelectedObstacleId(obstacle.id);
    setSelectedPieceIds([]);
    setSelectedTextAnnotationId(null);
    setInteraction({ type: "obstacle", id: obstacle.id, offsetX: point.x - obstacle.x, offsetY: point.y - obstacle.y });
  };

  const addObstacle = () => {
    pushHistory();
    const rect = clampRectToSurface(
      {
        x: surface.width * 0.35,
        y: surface.height * 0.35,
        width: Math.min(800, surface.width * 0.28),
        height: Math.min(300, surface.height * 0.18)
      },
      surface
    );
    setObstacles((current) => [...current, { ...rect, id: uid("obstacle"), label: `障碍 ${current.length + 1}` }]);
  };

  const updateObstacle = (id: string, patch: Partial<Obstacle>) => {
    pushHistory();
    setObstacles((current) =>
      current.map((obstacle) =>
        obstacle.id === id ? ({ ...clampRectToSurface({ ...obstacle, ...patch }, surface), id, label: patch.label ?? obstacle.label } as Obstacle) : obstacle
      )
    );
  };

  const removeObstacle = (id: string) => {
    pushHistory();
    setObstacles((current) => current.filter((obstacle) => obstacle.id !== id));
    if (selectedObstacleId === id) setSelectedObstacleId(null);
  };

  const applySelectedColor = (color: string) => {
    pushHistory();
    if (!selectedSourceIds.length) {
      setDefaultVisual((current) => ({ ...current, mode: "color", color }));
      return;
    }

    setTileVisuals((current) => ({
      ...current,
      ...Object.fromEntries(
        selectedSourceIds.map((sourceId) => [
          sourceId,
          { ...(current[sourceId] ?? defaultVisual), mode: "color", color }
        ])
      )
    }));
  };

  const readImage = (file: File, target: "global" | "selected") => {
    pushHistory();
    const reader = new FileReader();
    reader.onload = () => {
      const imageDataUrl = String(reader.result);
      if (target === "selected" && selectedSourceIds.length) {
        setTileVisuals((current) => ({
          ...current,
          ...Object.fromEntries(
            selectedSourceIds.map((sourceId) => [
              sourceId,
              {
                ...(current[sourceId] ?? defaultVisual),
                mode: "image",
                imageDataUrl
              }
            ])
          )
        }));
      } else {
        setDefaultVisual((current) => ({ ...current, mode: "image", imageDataUrl }));
      }
    };
    reader.readAsDataURL(file);
  };

  const addTextAnnotation = () => {
    const id = uid("text");
    pushHistory();
    setTextAnnotations((current) => [
      ...current,
      {
        id,
        text: "文字标注",
        x: Math.round(surface.width / 2),
        y: Math.round(surface.height / 2),
        fontSize: 90,
        color: "#101820"
      }
    ]);
    setSelectedTextAnnotationId(id);
    setSelectedObstacleId(null);
    setSelectedPieceIds([]);
  };

  const updateTextAnnotation = (id: string, patch: Partial<TextAnnotation>) => {
    pushHistory();
    setTextAnnotations((current) =>
      current.map((annotation) => (annotation.id === id ? { ...annotation, ...patch } : annotation))
    );
  };

  const removeTextAnnotation = (id: string) => {
    pushHistory();
    setTextAnnotations((current) => current.filter((annotation) => annotation.id !== id));
    if (selectedTextAnnotationId === id) setSelectedTextAnnotationId(null);
  };

  const handleTextPointerDown = (annotation: TextAnnotation, event: React.PointerEvent<SVGGElement>) => {
    event.stopPropagation();
    const svg = svgRef.current;
    if (!svg) return;
    const point = getSvgPoint(svg, event);
    pushHistory();
    setSelectedTextAnnotationId(annotation.id);
    setSelectedObstacleId(null);
    setSelectedPieceIds([]);
    setInteraction({
      type: "text",
      id: annotation.id,
      offsetX: point.x - annotation.x,
      offsetY: point.y - annotation.y
    });
  };

  const mergeSelectedTiles = () => {
    if (!mergeCandidate) return;
    pushHistory();
    const mergeId = uid("merge");
    const selectedIdSet = new Set(mergeCandidate.sourceIds);
    const firstCustomVisual = selectedSourceIds
      .map((sourceId) => tileVisuals[sourceId])
      .find((visual): visual is TileVisual => Boolean(visual));

    setTileMerges((current) => [...current, { id: mergeId, sourceIds: mergeCandidate.sourceIds }]);
    setManualDividers((current) =>
      current.filter((divider) => !divider.sourceIds?.some((sourceId) => selectedIdSet.has(sourceId)))
    );
    setSplits((current) => current.filter((split) => !selectedIdSet.has(split.sourceId)));
    if (firstCustomVisual) {
      setTileVisuals((current) => ({ ...current, [mergeId]: firstCustomVisual }));
    }
    setSelectedObstacleId(null);
    setSelectedPieceIds([`${mergeId}-f0`]);
  };

  const unmergeSelectedTiles = () => {
    if (!selectedMergedSourceIds.length) return;
    pushHistory();
    const selectedMergedSet = new Set(selectedMergedSourceIds);
    setTileMerges((current) => current.filter((merge) => !selectedMergedSet.has(merge.id)));
    setManualDividers((current) =>
      current.filter((divider) => !divider.sourceIds?.some((sourceId) => selectedMergedSet.has(sourceId)))
    );
    setSplits((current) => current.filter((split) => !selectedMergedSet.has(split.sourceId)));
    setSelectedPieceIds([]);
  };

  const selectedSplitMeasurements = splitMeasurements.filter((measurement) =>
    splits.some((split) => split.id === measurement.id && split.pieceId === selectedPiece?.id)
  );

  const viewMargin = 160;
  const viewBox = `${-viewMargin} ${-viewMargin} ${surface.width + viewMargin * 2} ${surface.height + viewMargin * 2}`;

  return (
    <div className="app-shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">瓷砖排版工作台</p>
          <h1>瓷砖排版施工图编辑器</h1>
        </div>
        <div className="topbar-actions">
          <select value={paperSize} onChange={(event) => setPaperSize(event.target.value as PaperSize)} aria-label="纸张">
            <option value="a3">A3</option>
            <option value="a4">A4</option>
          </select>
          <button
            className="export-action"
            onClick={() =>
              void exportLayoutPng({
                surface,
                layout,
                obstacles,
                splits,
                textAnnotations,
                defaultVisual,
                tileVisuals,
                paperSize
              })
            }
          >
            <ImageIcon size={18} />
            导出透明 PNG
          </button>
          <button
            className="primary-action"
            onClick={() =>
              void exportLayoutPdf({
                surface,
                layout,
                obstacles,
                splits,
                textAnnotations,
                defaultVisual,
                tileVisuals,
                paperSize
              })
            }
          >
            <FileDown size={18} />
            导出 PDF
          </button>
        </div>
      </header>

      <nav className="layout-tabbar" aria-label="排版标签">
        <div className="layout-tabs">
          {displayTabs.map((tab) => {
            const title = draftTitle(tab.draft);
            const active = tab.id === activeTabId;

            return (
              <div className={active ? "layout-tab active" : "layout-tab"} key={tab.id}>
                <button
                  type="button"
                  className="layout-tab-main"
                  onClick={() => switchLayoutTab(tab.id)}
                  aria-current={active ? "page" : undefined}
                  title={title}
                >
                  <span className="layout-tab-title">{title}</span>
                </button>
                {displayTabs.length > 1 ? (
                  <button
                    type="button"
                    className="layout-tab-close"
                    onClick={(event) => closeLayoutTabById(tab.id, event)}
                    title={`关闭${title}`}
                    aria-label={`关闭${title}`}
                  >
                    <X size={14} />
                  </button>
                ) : null}
              </div>
            );
          })}
        </div>
        <button type="button" className="layout-tab-new" onClick={createNewLayoutTab}>
          <FilePlus2 size={16} />
          新建排版
        </button>
      </nav>

      <main className="workspace">
        <aside className="side-panel left-panel">
          <section className="panel-section">
            <div className="section-title">
              <Ruler size={17} />
              <h2>铺贴区域</h2>
            </div>
            <Field label="名称">
              <input value={surface.label} onChange={(event) => updateSurface("label", event.target.value)} />
            </Field>
            <div className="field-grid">
              <NumberField label="宽度" min={200} value={surface.width} onChange={(value) => updateSurface("width", value)} />
              <NumberField label="高度" min={200} value={surface.height} onChange={(value) => updateSurface("height", value)} />
            </div>
          </section>

          <section className="panel-section">
            <div className="section-title">
              <Grid2X2 size={17} />
              <h2>瓷砖规格</h2>
            </div>
            <div className="field-grid">
              <NumberField label="砖宽" min={50} value={tileSpec.width} onChange={(value) => updateTileSpec("width", value)} />
              <NumberField label="砖高" min={50} value={tileSpec.height} onChange={(value) => updateTileSpec("height", value)} />
              <NumberField label="缝宽" min={0} max={50} value={tileSpec.grout} onChange={(value) => updateTileSpec("grout", value)} />
              <Field label="铺法">
                <select
                  value={tileSpec.pattern}
                  onChange={(event) => updateTileSpec("pattern", event.target.value as LayoutPattern)}
                >
                  <option value="straight">正铺</option>
                  <option value="rotated">旋转</option>
                  <option value="brick">工字铺</option>
                </select>
              </Field>
            </div>
          </section>

          <section className="panel-section">
            <div className="section-title">
              <Move size={17} />
              <h2>起铺点</h2>
            </div>
            <div className="anchor-grid" aria-label="起铺锚点">
              {anchorOptions.map((yOption) =>
                anchorOptions.map((xOption) => (
                  <button
                    key={`${xOption.value}-${yOption.value}`}
                    className={
                      origin.anchorX === xOption.value && origin.anchorY === yOption.value ? "anchor selected" : "anchor"
                    }
                    onClick={() => {
                      updateOrigin("anchorX", xOption.value);
                      updateOrigin("anchorY", yOption.value);
                    }}
                    title={`${xOption.label}${yOption.label}`}
                    aria-label={`${xOption.label}${yOption.label}`}
                  />
                ))
              )}
            </div>
            <div className="field-grid">
              <NumberField label="X 偏移" value={origin.offsetX} onChange={(value) => updateOrigin("offsetX", value)} />
              <NumberField label="Y 偏移" value={origin.offsetY} onChange={(value) => updateOrigin("offsetY", value)} />
            </div>
          </section>

          <section className="panel-section">
            <div className="section-title">
              <Layers size={17} />
              <h2>门窗/障碍</h2>
              <button className="icon-button" onClick={addObstacle} title="添加障碍" aria-label="添加障碍">
                <Plus size={16} />
              </button>
            </div>
            <div className="obstacle-list">
              {obstacles.map((obstacle) => (
                <div className={selectedObstacleId === obstacle.id ? "obstacle-row selected" : "obstacle-row"} key={obstacle.id}>
                  <input
                    className="obstacle-name"
                    value={obstacle.label}
                    onChange={(event) => updateObstacle(obstacle.id, { label: event.target.value })}
                    aria-label="障碍名称"
                  />
                  <div className="mini-grid">
                    <NumberField label="X" value={Math.round(obstacle.x)} onChange={(value) => updateObstacle(obstacle.id, { x: value })} />
                    <NumberField label="Y" value={Math.round(obstacle.y)} onChange={(value) => updateObstacle(obstacle.id, { y: value })} />
                    <NumberField
                      label="宽"
                      min={20}
                      value={Math.round(obstacle.width)}
                      onChange={(value) => updateObstacle(obstacle.id, { width: value })}
                    />
                    <NumberField
                      label="高"
                      min={20}
                      value={Math.round(obstacle.height)}
                      onChange={(value) => updateObstacle(obstacle.id, { height: value })}
                    />
                  </div>
                  <button className="text-danger" onClick={() => removeObstacle(obstacle.id)}>
                    <Trash2 size={15} />
                    删除
                  </button>
                </div>
              ))}
            </div>
          </section>
        </aside>

        <section className="canvas-stage">
          <div className="canvas-toolbar">
            <div className="tool-group">
              <button className="tool icon-tool" disabled={!undoStack.length} onClick={undo} title="撤销" aria-label="撤销">
                <Undo2 size={16} />
              </button>
              <button className="tool icon-tool" disabled={!redoStack.length} onClick={redo} title="重做" aria-label="重做">
                <Redo2 size={16} />
              </button>
              <button className="tool" onClick={addTextAnnotation}>
                <Type size={16} />
                添加文字
              </button>
              <button className="tool" disabled={!canMergeSelection} onClick={mergeSelectedTiles}>
                <Merge size={16} />
                合并
              </button>
              <button className="tool" disabled={!selectedMergedSourceIds.length} onClick={unmergeSelectedTiles}>
                <Ungroup size={16} />
                取消合并
              </button>
              <button className="tool" onClick={clearManualEdits}>
                <RotateCw size={16} />
                重新排版
              </button>
            </div>
            <label className="zoom-control">
              <span>缩放</span>
              <input type="range" min="0.65" max="1.6" step="0.05" value={zoom} onChange={(event) => setZoom(Number(event.target.value))} />
            </label>
            <div className={snapPreview ? "snap-status active" : "snap-status"}>
              {snapPreview ? `${snapPreview.target?.label} ${mm(snapPreview.position)}` : "自动吸附"}
            </div>
          </div>

          <div className="canvas-wrap">
            <svg
              ref={svgRef}
              className="layout-canvas"
              viewBox={viewBox}
              style={{ "--canvas-zoom": String(zoom) } as CSSProperties}
              onPointerMove={handleSvgPointerMove}
              onPointerUp={() => {
                setInteraction({ type: "none" });
                setSnapPreview(null);
              }}
              onPointerLeave={() => {
                setInteraction({ type: "none" });
                setSnapPreview(null);
              }}
              onPointerDown={() => {
                setSelectedPieceIds([]);
                setSelectedObstacleId(null);
                setSelectedTextAnnotationId(null);
              }}
              role="img"
              aria-label="瓷砖排版画布"
            >
              <defs>
                <pattern id="draft-grid" width="200" height="200" patternUnits="userSpaceOnUse">
                  <path d="M 200 0 L 0 0 0 200" fill="none" stroke="#d9d2c6" strokeWidth="1" />
                </pattern>
              </defs>

              <rect x={-viewMargin} y={-viewMargin} width={surface.width + viewMargin * 2} height={surface.height + viewMargin * 2} fill="url(#draft-grid)" />
              <rect x={0} y={0} width={surface.width} height={surface.height} className="surface-bg" />

              {layout.pieces.map((piece) => {
                const visual = tileVisuals[piece.sourceId] ?? defaultVisual;
                const selected = selectedPieceIds.includes(piece.id);
                return (
                  <g key={piece.id}>
                    {visual.mode === "image" && visual.imageDataUrl ? (
                      <image href={visual.imageDataUrl} x={piece.x} y={piece.y} width={piece.width} height={piece.height} preserveAspectRatio="xMidYMid slice" />
                    ) : (
                      <rect x={piece.x} y={piece.y} width={piece.width} height={piece.height} fill={visual.color} />
                    )}
                    <rect
                      x={piece.x}
                      y={piece.y}
                      width={piece.width}
                      height={piece.height}
                      className={selected ? "tile selected" : piece.isWhole || piece.isSplitChild ? "tile" : "tile cut"}
                      onPointerDown={(event) => handlePiecePointerDown(piece, event)}
                    />
                  </g>
                );
              })}

              {dividerHandles.map((divider) => (
                <g key={divider.id}>
                  {divider.axis === "x" ? (
                    <>
                      <line
                        x1={divider.position}
                        y1={divider.start}
                        x2={divider.position}
                        y2={divider.end}
                        className="divider-hit vertical"
                        onPointerDown={(event) => {
                          event.stopPropagation();
                          pushHistory();
                          setInteraction({ type: "divider", handle: divider });
                        }}
                      />
                      <line x1={divider.position} y1={divider.start} x2={divider.position} y2={divider.end} className="divider-line" />
                    </>
                  ) : (
                    <>
                      <line
                        x1={divider.start}
                        y1={divider.position}
                        x2={divider.end}
                        y2={divider.position}
                        className="divider-hit horizontal"
                        onPointerDown={(event) => {
                          event.stopPropagation();
                          pushHistory();
                          setInteraction({ type: "divider", handle: divider });
                        }}
                      />
                      <line x1={divider.start} y1={divider.position} x2={divider.end} y2={divider.position} className="divider-line" />
                    </>
                  )}
                </g>
              ))}

              {splitDividerHandles.map((divider) => (
                <g key={divider.id}>
                  {divider.axis === "x" ? (
                    <line
                      x1={divider.position}
                      y1={divider.start}
                      x2={divider.position}
                      y2={divider.end}
                      className="divider-hit vertical"
                      onPointerDown={(event) => {
                        event.stopPropagation();
                        pushHistory();
                        setInteraction({ type: "split-divider", handle: divider });
                      }}
                    />
                  ) : (
                    <line
                      x1={divider.start}
                      y1={divider.position}
                      x2={divider.end}
                      y2={divider.position}
                      className="divider-hit horizontal"
                      onPointerDown={(event) => {
                        event.stopPropagation();
                        pushHistory();
                        setInteraction({ type: "split-divider", handle: divider });
                      }}
                    />
                  )}
                </g>
              ))}

              {snapPreview ? (
                <g className="snap-guide">
                  {snapPreview.axis === "x" ? (
                    <>
                      <line x1={snapPreview.position} y1={-70} x2={snapPreview.position} y2={surface.height + 70} />
                      <text x={snapPreview.position + 18} y={-34}>
                        {snapPreview.target?.label} {mm(snapPreview.position)}
                      </text>
                    </>
                  ) : (
                    <>
                      <line x1={-70} y1={snapPreview.position} x2={surface.width + 70} y2={snapPreview.position} />
                      <text x={18} y={snapPreview.position - 18}>
                        {snapPreview.target?.label} {mm(snapPreview.position)}
                      </text>
                    </>
                  )}
                </g>
              ) : null}

              {obstacles.map((obstacle) => (
                <g
                  key={obstacle.id}
                  className={selectedObstacleId === obstacle.id ? "obstacle selected" : "obstacle"}
                  onPointerDown={(event) => handleObstaclePointerDown(obstacle, event)}
                >
                  <rect x={obstacle.x} y={obstacle.y} width={obstacle.width} height={obstacle.height} />
                  <text x={obstacle.x + 18} y={obstacle.y + 34}>
                    {obstacle.label}
                  </text>
                </g>
              ))}

              {splitMeasurements.map((measurement) => (
                <g key={measurement.id} className="split-measurement">
                  <path d={pointsToPath(measurement.polygons[0])} />
                  <path d={pointsToPath(measurement.polygons[1])} />
                </g>
              ))}
              {splits.filter((split) => split.start && split.end).map((split) => (
                <line
                  key={`${split.id}-legacy`}
                  x1={split.start!.x}
                  y1={split.start!.y}
                  x2={split.end!.x}
                  y2={split.end!.y}
                  className="split-line"
                />
              ))}

              <g className="tile-label-layer">
                {layout.pieces.map((piece) => {
                  const label = buildTileLabelLayout(piece, surface, viewMargin, buildTileLabelMetrics(piece.width, piece.height));
                  return (
                    <g key={`${piece.id}-label`}>
                      {label.leader ? (
                        <line
                          x1={label.leader.x1}
                          y1={label.leader.y1}
                          x2={label.leader.x2}
                          y2={label.leader.y2}
                          className="tile-label-leader"
                        />
                      ) : null}
                      {label.compact ? (
                        <rect
                          x={label.boxX}
                          y={label.boxY}
                          width={label.boxWidth}
                          height={label.boxHeight}
                          rx={10}
                          className="tile-label-backing"
                        />
                      ) : null}
                      <text
                        x={label.textX}
                        y={label.textY}
                        className={label.compact ? "tile-label compact" : "tile-label"}
                        style={{ fontSize: label.fontSize }}
                      >
                        {label.label}
                      </text>
                    </g>
                  );
                })}
              </g>

              <g className="annotation-layer">
                {textAnnotations.map((annotation) => {
                  const box = textAnnotationBox(annotation);
                  const selected = selectedTextAnnotationId === annotation.id;
                  return (
                    <g
                      key={annotation.id}
                      className={selected ? "text-annotation selected" : "text-annotation"}
                      onPointerDown={(event) => handleTextPointerDown(annotation, event)}
                    >
                      <rect
                        x={box.x}
                        y={box.y}
                        width={box.width}
                        height={box.height}
                        className="text-annotation-hit"
                      />
                      {selected ? (
                        <rect
                          x={box.x}
                          y={box.y}
                          width={box.width}
                          height={box.height}
                          className="text-annotation-selection"
                        />
                      ) : null}
                      <text
                        x={annotation.x}
                        y={annotation.y}
                        style={{ fontSize: annotation.fontSize, fill: annotation.color }}
                      >
                        {annotationLines(annotation.text || "文字标注").map((line, index) => (
                          <tspan key={`${annotation.id}-${index}`} x={annotation.x} dy={index === 0 ? 0 : annotation.fontSize * 1.2}>
                            {line || " "}
                          </tspan>
                        ))}
                      </text>
                    </g>
                  );
                })}
              </g>

              <g className="canvas-dimensions">
                <line x1={0} y1={surface.height} x2={0} y2={surface.height + 98} className="dimension-extension" />
                <line x1={surface.width} y1={surface.height} x2={surface.width} y2={surface.height + 98} className="dimension-extension" />
                <line x1={0} y1={surface.height + 70} x2={surface.width} y2={surface.height + 70} className="dimension-line" />
                <polygon className="dimension-arrow" points={dimensionArrowPoints(0, surface.height + 70, "right", 48)} />
                <polygon className="dimension-arrow" points={dimensionArrowPoints(surface.width, surface.height + 70, "left", 48)} />
                <text x={surface.width / 2} y={surface.height + 116} className="dimension-label">
                  {mm(surface.width)}
                </text>

                <line x1={surface.width} y1={0} x2={surface.width + 98} y2={0} className="dimension-extension" />
                <line x1={surface.width} y1={surface.height} x2={surface.width + 98} y2={surface.height} className="dimension-extension" />
                <line x1={surface.width + 70} y1={0} x2={surface.width + 70} y2={surface.height} className="dimension-line" />
                <polygon className="dimension-arrow" points={dimensionArrowPoints(surface.width + 70, 0, "down", 48)} />
                <polygon className="dimension-arrow" points={dimensionArrowPoints(surface.width + 70, surface.height, "up", 48)} />
                <text x={surface.width + 116} y={surface.height / 2} className="dimension-label vertical">
                  {mm(surface.height)}
                </text>
              </g>
            </svg>
          </div>
        </section>

        <aside className="side-panel right-panel">
          <section className="panel-section">
            <div className="section-title">
              <Download size={17} />
              <h2>用量统计</h2>
            </div>
            <div className="stats-grid">
              <div className="stat"><span>整砖</span><strong>{layout.stats.wholeTiles}</strong></div>
              <div className="stat"><span>切砖</span><strong>{layout.stats.cutTiles}</strong></div>
              <div className="stat"><span>合计</span><strong>{layout.stats.totalTiles}</strong></div>
              <div className="stat"><span>净面积</span><strong>{squareMeters(layout.stats.netArea)}</strong></div>
              <div className="stat"><span>损耗</span><strong>{(layout.stats.wasteRate * 100).toFixed(1)}%</strong></div>
              <div className="stat"><span>分割</span><strong>{splits.length}</strong></div>
            </div>
          </section>

          <section className="panel-section">
            <div className="section-title">
              <Palette size={17} />
              <h2>瓷砖填充</h2>
            </div>
            <div className="style-controls">
              <Field label="全局颜色">
                <input
                  type="color"
                  value={defaultVisual.color}
                  onChange={(event) => {
                    pushHistory();
                    setDefaultVisual((current) => ({ ...current, mode: "color", color: event.target.value }));
                  }}
                />
              </Field>
              <label className="upload-button">
                <ImageIcon size={16} />
                全局图片
                <input type="file" accept="image/*" onChange={(event) => event.target.files?.[0] && readImage(event.target.files[0], "global")} />
              </label>
              <Field label="选中颜色">
                <input type="color" value={selectedVisual.color} disabled={!selectedSourceIds.length} onChange={(event) => applySelectedColor(event.target.value)} />
              </Field>
              <label className={selectedSourceIds.length ? "upload-button" : "upload-button disabled"}>
                <ImageIcon size={16} />
                单砖图片
                <input
                  type="file"
                  accept="image/*"
                  disabled={!selectedSourceIds.length}
                  onChange={(event) => event.target.files?.[0] && readImage(event.target.files[0], "selected")}
                />
              </label>
              <button
                className="secondary-action"
                disabled={!selectedSourceIds.some((sourceId) => tileVisuals[sourceId])}
                onClick={() => {
                  pushHistory();
                  setTileVisuals((current) => {
                    const next = { ...current };
                    selectedSourceIds.forEach((sourceId) => delete next[sourceId]);
                    return next;
                  });
                }}
              >
                清除单砖样式
              </button>
            </div>
          </section>

          <section className="panel-section">
            <div className="section-title">
              <Type size={17} />
              <h2>文字标注</h2>
              <button className="icon-button" onClick={addTextAnnotation} title="添加文字" aria-label="添加文字">
                <Plus size={16} />
              </button>
            </div>
            <div className="text-controls">
              {textAnnotations.length ? (
                <div className="annotation-list">
                  {textAnnotations.map((annotation) => (
                    <button
                      key={annotation.id}
                      className={selectedTextAnnotationId === annotation.id ? "annotation-row selected" : "annotation-row"}
                      onClick={() => {
                        setSelectedTextAnnotationId(annotation.id);
                        setSelectedPieceIds([]);
                        setSelectedObstacleId(null);
                      }}
                    >
                      {annotation.text || "文字标注"}
                    </button>
                  ))}
                </div>
              ) : null}
              {selectedTextAnnotation ? (
                <>
                  <Field label="内容">
                    <textarea
                      value={selectedTextAnnotation.text}
                      rows={3}
                      onChange={(event) => updateTextAnnotation(selectedTextAnnotation.id, { text: event.target.value })}
                    />
                  </Field>
                  <div className="field-grid">
                    <NumberField
                      label="X"
                      value={Math.round(selectedTextAnnotation.x)}
                      onChange={(value) => updateTextAnnotation(selectedTextAnnotation.id, { x: clamp(value, 0, surface.width) })}
                    />
                    <NumberField
                      label="Y"
                      value={Math.round(selectedTextAnnotation.y)}
                      onChange={(value) => updateTextAnnotation(selectedTextAnnotation.id, { y: clamp(value, 0, surface.height) })}
                    />
                    <NumberField
                      label="字号"
                      min={20}
                      max={180}
                      value={selectedTextAnnotation.fontSize}
                      onChange={(value) => updateTextAnnotation(selectedTextAnnotation.id, { fontSize: clamp(value, 20, 180) })}
                    />
                    <Field label="颜色">
                      <input
                        type="color"
                        value={selectedTextAnnotation.color}
                        onChange={(event) => updateTextAnnotation(selectedTextAnnotation.id, { color: event.target.value })}
                      />
                    </Field>
                  </div>
                  <button className="text-danger" onClick={() => removeTextAnnotation(selectedTextAnnotation.id)}>
                    <Trash2 size={15} />
                    删除文字
                  </button>
                </>
              ) : (
                <div className="empty-state">未选中文字</div>
              )}
            </div>
          </section>

          <section className="panel-section">
            <div className="section-title">
              <Move size={17} />
              <h2>选中区域</h2>
            </div>
            {selectedPiece ? (
              <div className="selection-panel">
                <div className="selection-title">
                  {!isSinglePieceSelection ? `已选择 ${selectedPieces.length} 块瓷砖` : selectedPiece.sourceId}
                </div>
                <dl>
                  {isSinglePieceSelection ? (
                    <>
                      <div><dt>尺寸</dt><dd>{mm(selectedPiece.width)} × {mm(selectedPiece.height)}</dd></div>
                      <div><dt>面积</dt><dd>{squareMeters(selectedPiece.area)}</dd></div>
                      <div><dt>类型</dt><dd>{selectedPiece.isWhole ? "整砖" : "切砖"}</dd></div>
                      <div><dt>合并</dt><dd>{selectedSources[0]?.mergedSourceIds?.length ? `${selectedSources[0].mergedSourceIds.length} 块` : "未合并"}</dd></div>
                    </>
                  ) : (
                    <>
                      <div><dt>数量</dt><dd>{selectedPieces.length} 块</dd></div>
                      <div><dt>合计面积</dt><dd>{squareMeters(selectedArea)}</dd></div>
                      <div><dt>可合并</dt><dd>{canMergeSelection ? `${mergeCandidate?.rowSpan} 行 × ${mergeCandidate?.colSpan} 列` : "需选择完整矩形"}</dd></div>
                    </>
                  )}
                </dl>
                {!isSinglePieceSelection ? (
                  <button className="secondary-action" disabled={!canMergeSelection} onClick={mergeSelectedTiles}>
                    <Merge size={16} />
                    合并选中瓷砖
                  </button>
                ) : (
                  <>
                    <div className="precision-grid">
                      <PrecisionNumberField
                        label="精确宽度"
                        min={selectedWidthBounds?.min ?? 20}
                        max={selectedWidthBounds?.max}
                        value={Math.round(selectedPiece.width)}
                        disabled={!selectedWidthHandle}
                        onCommit={(value) => updateSelectedTileSize("x", value)}
                      />
                      <PrecisionNumberField
                        label="精确高度"
                        min={selectedHeightBounds?.min ?? 20}
                        max={selectedHeightBounds?.max}
                        value={Math.round(selectedPiece.height)}
                        disabled={!selectedHeightHandle}
                        onCommit={(value) => updateSelectedTileSize("y", value)}
                      />
                    </div>
                    <div className="split-action-grid">
                      <button
                        className="secondary-action"
                        disabled={!canSplitHorizontally}
                        onClick={() => splitSelectedTile("horizontal")}
                        title={canSplitHorizontally ? "沿水平中线分成上下两块" : "当前瓷砖高度不足，无法横向分割"}
                      >
                        <SplitSquareHorizontal size={16} />
                        横向分割
                      </button>
                      <button
                        className="secondary-action"
                        disabled={!canSplitVertically}
                        onClick={() => splitSelectedTile("vertical")}
                        title={canSplitVertically ? "沿垂直中线分成左右两块" : "当前瓷砖宽度不足，无法竖向分割"}
                      >
                        <SplitSquareVertical size={16} />
                        竖向分割
                      </button>
                    </div>
                    <button className="secondary-action" disabled={!selectedMergedSourceIds.length} onClick={unmergeSelectedTiles}>
                      <Ungroup size={16} />
                      取消合并
                    </button>
                    {selectedSplitMeasurements.map((measurement, index) => (
                      <div className="split-card" key={measurement.id}>
                        <span>分割 {index + 1}</span>
                        <strong>{squareMeters(measurement.areas[0])} / {squareMeters(measurement.areas[1])}</strong>
                      </div>
                    ))}
                  </>
                )}
              </div>
            ) : (
              <div className="empty-state">未选中瓷砖</div>
            )}
          </section>
        </aside>
      </main>
    </div>
  );
}

export default App;
