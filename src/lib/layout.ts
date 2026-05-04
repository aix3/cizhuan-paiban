import type {
  LayoutResult,
  ManualDivider,
  ManualSplit,
  Obstacle,
  OriginSettings,
  Rect,
  SourceTile,
  SplitAxis,
  SplitSegment,
  Surface,
  TilePiece,
  TileMerge,
  TileSpec,
  SplitMeasurement
} from "../types";
import { nearlyEqual, rectArea, rectIntersection, splitRectByLine, subtractRects } from "./geometry";

const MIN_TILE_SIZE = 20;
export const MIN_SPLIT_CHILD_SIZE = 20;

function tileDimensions(spec: TileSpec) {
  if (spec.pattern === "rotated") {
    return { width: spec.height, height: spec.width };
  }

  return { width: spec.width, height: spec.height };
}

function anchorPosition(size: number, tileSize: number, anchor: OriginSettings["anchorX"]) {
  if (anchor === "center") return size / 2 - tileSize / 2;
  if (anchor === "end") return size - tileSize;
  return 0;
}

function startBeforeZero(start: number, step: number) {
  let value = start;
  while (value > 0) value -= step;
  return value;
}

function generateSources(surface: Surface, spec: TileSpec, origin: OriginSettings): SourceTile[] {
  const tile = tileDimensions(spec);
  const stepX = Math.max(1, tile.width + spec.grout);
  const stepY = Math.max(1, tile.height + spec.grout);
  const startX = startBeforeZero(
    anchorPosition(surface.width, tile.width, origin.anchorX) + origin.offsetX,
    stepX
  );
  const startY = startBeforeZero(
    anchorPosition(surface.height, tile.height, origin.anchorY) + origin.offsetY,
    stepY
  );
  const sources: SourceTile[] = [];

  let row = 0;
  for (let y = startY; y < surface.height; y += stepY) {
    const rowOffset = spec.pattern === "brick" && row % 2 === 1 ? stepX / 2 : 0;
    let col = 0;

    for (let x = startX - rowOffset; x < surface.width; x += stepX) {
      const rect = { x, y, width: tile.width, height: tile.height };

      if (rectIntersection(rect, { x: 0, y: 0, width: surface.width, height: surface.height })) {
        const id = `r${row}-c${col}`;
        sources.push({
          ...rect,
          id,
          row,
          col,
          baseRect: rect
        });
      }

      col += 1;
    }

    row += 1;
  }

  return sources;
}

export interface MergeCandidate {
  sourceIds: string[];
  rect: Rect;
  rowSpan: number;
  colSpan: number;
}

function uniqueValues(values: number[]) {
  return Array.from(new Set(values)).sort((a, b) => a - b);
}

export function getMergeCandidate(sources: SourceTile[], sourceIds: string[]): MergeCandidate | null {
  const uniqueSourceIds = Array.from(new Set(sourceIds));
  if (uniqueSourceIds.length < 2) return null;

  const sourceById = new Map(sources.map((source) => [source.id, source]));
  const selected = uniqueSourceIds.map((id) => sourceById.get(id));
  if (selected.some((source) => !source)) return null;

  const selectedSources = selected as SourceTile[];
  if (selectedSources.some((source) => source.mergedSourceIds?.length)) return null;

  const rows = uniqueValues(selectedSources.map((source) => source.row));
  const cols = uniqueValues(selectedSources.map((source) => source.col));
  if (rows.length * cols.length !== selectedSources.length) return null;

  const selectedSet = new Set(uniqueSourceIds);
  const blockSources = sources.filter((source) => rows.includes(source.row) && cols.includes(source.col));
  if (blockSources.length !== selectedSources.length) return null;
  if (blockSources.some((source) => !selectedSet.has(source.id))) return null;

  const minX = Math.min(...selectedSources.map((source) => source.baseRect.x));
  const minY = Math.min(...selectedSources.map((source) => source.baseRect.y));
  const maxX = Math.max(...selectedSources.map((source) => source.baseRect.x + source.baseRect.width));
  const maxY = Math.max(...selectedSources.map((source) => source.baseRect.y + source.baseRect.height));

  const rowBounds = rows.map((row) => {
    const rowSources = selectedSources.filter((source) => source.row === row);
    return {
      left: Math.min(...rowSources.map((source) => source.baseRect.x)),
      right: Math.max(...rowSources.map((source) => source.baseRect.x + source.baseRect.width))
    };
  });
  if (rowBounds.some((bounds) => !nearlyEqual(bounds.left, minX) || !nearlyEqual(bounds.right, maxX))) return null;

  return {
    sourceIds: blockSources.map((source) => source.id),
    rect: { x: minX, y: minY, width: maxX - minX, height: maxY - minY },
    rowSpan: rows.length,
    colSpan: cols.length
  };
}

export function applyTileMergesToSources(sources: SourceTile[], merges: TileMerge[]): SourceTile[] {
  if (!merges.length) return sources;

  const mergedSourceIds = new Set<string>();
  const mergedSources: SourceTile[] = [];

  merges.forEach((merge) => {
    if (merge.sourceIds.some((sourceId) => mergedSourceIds.has(sourceId))) return;
    const candidate = getMergeCandidate(sources, merge.sourceIds);
    if (!candidate) return;
    const selectedSources = candidate.sourceIds
      .map((sourceId) => sources.find((source) => source.id === sourceId))
      .filter((source): source is SourceTile => Boolean(source));
    const first = selectedSources[0];
    if (!first) return;

    candidate.sourceIds.forEach((sourceId) => mergedSourceIds.add(sourceId));
    mergedSources.push({
      id: merge.id,
      row: first.row,
      col: first.col,
      x: candidate.rect.x,
      y: candidate.rect.y,
      width: candidate.rect.width,
      height: candidate.rect.height,
      baseRect: candidate.rect,
      mergedSourceIds: candidate.sourceIds
    });
  });

  return [
    ...sources.filter((source) => !mergedSourceIds.has(source.id)),
    ...mergedSources
  ].sort((a, b) => a.y - b.y || a.x - b.x || a.id.localeCompare(b.id));
}

export function applyManualDividersToSources(sources: SourceTile[], dividers: ManualDivider[]): SourceTile[] {
  if (!dividers.length) return sources;

  return sources.map((source) => {
    let left = source.x;
    let right = source.x + source.width;
    let top = source.y;
    let bottom = source.y + source.height;

    dividers.forEach((divider) => {
      if (divider.sourceIds) {
        const [beforeId, afterId] = divider.sourceIds;
        const halfGap = (divider.gap ?? 0) / 2;

        if (divider.axis === "x") {
          if (source.id === beforeId) {
            right = divider.position - halfGap;
          }
          if (source.id === afterId) {
            left = divider.position + halfGap;
          }
        } else {
          if (source.id === beforeId) {
            bottom = divider.position - halfGap;
          }
          if (source.id === afterId) {
            top = divider.position + halfGap;
          }
        }

        return;
      }

      if (divider.sourceId && divider.edge && source.id === divider.sourceId) {
        if (divider.edge === "left") left = divider.position;
        if (divider.edge === "right") right = divider.position;
        if (divider.edge === "top") top = divider.position;
        if (divider.edge === "bottom") bottom = divider.position;

        return;
      }

      if (divider.axis === "x") {
        if (nearlyEqual(source.baseRect.x, divider.basePosition)) {
          left = divider.position;
        }
        if (nearlyEqual(source.baseRect.x + source.baseRect.width, divider.basePosition)) {
          right = divider.position;
        }
      } else {
        if (nearlyEqual(source.baseRect.y, divider.basePosition)) {
          top = divider.position;
        }
        if (nearlyEqual(source.baseRect.y + source.baseRect.height, divider.basePosition)) {
          bottom = divider.position;
        }
      }
    });

    if (right < left + MIN_TILE_SIZE) right = left + MIN_TILE_SIZE;
    if (bottom < top + MIN_TILE_SIZE) bottom = top + MIN_TILE_SIZE;

    return {
      ...source,
      x: left,
      y: top,
      width: right - left,
      height: bottom - top
    };
  });
}

function visiblePieces(source: SourceTile, surface: Surface, obstacles: Obstacle[]): TilePiece[] {
  const clipped = rectIntersection(source, { x: 0, y: 0, width: surface.width, height: surface.height });
  if (!clipped) return [];

  const pieces = subtractRects(clipped, obstacles);
  const sourceArea = rectArea(source);
  const visibleArea = pieces.reduce((total, piece) => total + rectArea(piece), 0);
  const isWholeSource = Math.abs(visibleArea - sourceArea) <= 0.01 && pieces.length === 1;

  return pieces.map((piece, index) => ({
    ...piece,
    id: `${source.id}-f${index}`,
    sourceId: source.id,
    row: source.row,
    col: source.col,
    fragmentIndex: index,
    area: rectArea(piece),
    isWhole: isWholeSource
  }));
}

function buildStats(sources: SourceTile[], pieces: TilePiece[]) {
  const visibleBySource = new Map<string, { area: number; whole: boolean }>();

  pieces.forEach((piece) => {
    const entry = visibleBySource.get(piece.sourceId) ?? { area: 0, whole: true };
    entry.area += piece.area;
    entry.whole = entry.whole && piece.isWhole;
    visibleBySource.set(piece.sourceId, entry);
  });

  const wholeTiles = Array.from(visibleBySource.values()).filter((entry) => entry.whole).length;
  const cutTiles = Array.from(visibleBySource.values()).filter((entry) => !entry.whole).length;
  const totalTiles = wholeTiles + cutTiles;
  const netArea = pieces.reduce((total, piece) => total + piece.area, 0);
  const sourceById = new Map(sources.map((source) => [source.id, source]));
  const tileArea = Array.from(visibleBySource.keys()).reduce((total, sourceId) => {
    const source = sourceById.get(sourceId);
    return total + (source ? rectArea(source) : 0);
  }, 0);
  const wasteArea = Math.max(0, tileArea - netArea);

  return {
    wholeTiles,
    cutTiles,
    totalTiles,
    netArea,
    tileArea,
    wasteArea,
    wasteRate: tileArea > 0 ? wasteArea / tileArea : 0
  };
}

export function splitChildId(parentPieceId: string, splitId: string, side: "a" | "b") {
  return `${parentPieceId}-${splitId}-${side}`;
}

function splitTargetId(split: ManualSplit) {
  return split.parentPieceId ?? split.pieceId ?? "";
}

function splitPieceByAxis(piece: TilePiece, split: ManualSplit): { pieces: [TilePiece, TilePiece]; segment: SplitSegment } | null {
  if (!split.axis) return null;

  const ratio = Math.min(0.95, Math.max(0.05, split.ratio ?? 0.5));
  const parentPieceId = splitTargetId(split);

  if (split.axis === "vertical") {
    const firstWidth = piece.width * ratio;
    const secondWidth = piece.width - firstWidth;
    if (firstWidth < MIN_SPLIT_CHILD_SIZE || secondWidth < MIN_SPLIT_CHILD_SIZE) return null;

    const splitX = piece.x + firstWidth;
    const first: TilePiece = {
      ...piece,
      id: splitChildId(piece.id, split.id, "a"),
      width: firstWidth,
      area: firstWidth * piece.height,
      isWhole: false,
      isSplitChild: true
    };
    const second: TilePiece = {
      ...piece,
      id: splitChildId(piece.id, split.id, "b"),
      x: splitX,
      width: secondWidth,
      area: secondWidth * piece.height,
      isWhole: false,
      isSplitChild: true
    };

    return {
      pieces: [first, second],
      segment: {
        id: split.id,
        sourceId: split.sourceId,
        parentPieceId,
        axis: split.axis,
        parentRect: { x: piece.x, y: piece.y, width: piece.width, height: piece.height },
        start: { x: splitX, y: piece.y },
        end: { x: splitX, y: piece.y + piece.height }
      }
    };
  }

  const firstHeight = piece.height * ratio;
  const secondHeight = piece.height - firstHeight;
  if (firstHeight < MIN_SPLIT_CHILD_SIZE || secondHeight < MIN_SPLIT_CHILD_SIZE) return null;

  const splitY = piece.y + firstHeight;
  const first: TilePiece = {
    ...piece,
    id: splitChildId(piece.id, split.id, "a"),
    height: firstHeight,
    area: piece.width * firstHeight,
    isWhole: false,
    isSplitChild: true
  };
  const second: TilePiece = {
    ...piece,
    id: splitChildId(piece.id, split.id, "b"),
    y: splitY,
    height: secondHeight,
    area: piece.width * secondHeight,
    isWhole: false,
    isSplitChild: true
  };

  return {
    pieces: [first, second],
    segment: {
      id: split.id,
      sourceId: split.sourceId,
      parentPieceId,
      axis: split.axis,
      parentRect: { x: piece.x, y: piece.y, width: piece.width, height: piece.height },
      start: { x: piece.x, y: splitY },
      end: { x: piece.x + piece.width, y: splitY }
    }
  };
}

export function applyManualSplitsToPieces(pieces: TilePiece[], splits: ManualSplit[]) {
  const splitByParent = new Map<string, ManualSplit>();
  splits.forEach((split) => {
    const parentId = splitTargetId(split);
    if (!parentId || !split.axis || splitByParent.has(parentId)) return;
    splitByParent.set(parentId, split);
  });

  const splitSegments: SplitSegment[] = [];
  const applySplit = (piece: TilePiece): TilePiece[] => {
    const split = splitByParent.get(piece.id);
    if (!split) return [piece];

    const result = splitPieceByAxis(piece, split);
    if (!result) return [piece];

    splitSegments.push(result.segment);
    return result.pieces.flatMap((child) => applySplit(child));
  };

  return {
    pieces: pieces.flatMap((piece) => applySplit(piece)),
    splitSegments
  };
}

export function computeLayout(
  surface: Surface,
  spec: TileSpec,
  origin: OriginSettings,
  obstacles: Obstacle[],
  dividers: ManualDivider[] = [],
  merges: TileMerge[] = [],
  splits: ManualSplit[] = []
): LayoutResult {
  const baseSources = applyTileMergesToSources(generateSources(surface, spec, origin), merges);
  const sources = applyManualDividersToSources(baseSources, dividers);
  const materialPieces = sources.flatMap((source) => visiblePieces(source, surface, obstacles));
  const splitLayout = applyManualSplitsToPieces(materialPieces, splits);

  return {
    baseSources,
    sources,
    materialPieces,
    pieces: splitLayout.pieces,
    splitSegments: splitLayout.splitSegments,
    stats: buildStats(sources, materialPieces)
  };
}

export function measureSplits(pieces: TilePiece[], splits: ManualSplit[]): SplitMeasurement[] {
  return splits.flatMap((split) => {
    if (!split.start || !split.end) return [];

    const pieceId = splitTargetId(split);
    const piece = pieces.find((candidate) => candidate.id === pieceId);
    if (!piece) return [];

    const result = splitRectByLine(piece, split.start, split.end);
    return [
      {
        id: split.id,
        areas: result.areas,
        polygons: result.polygons,
        totalArea: result.totalArea
      }
    ];
  });
}

export function findPieceAt(pieces: TilePiece[], point: { x: number; y: number }) {
  return pieces.find((piece) => {
    return (
      point.x >= piece.x &&
      point.x <= piece.x + piece.width &&
      point.y >= piece.y &&
      point.y <= piece.y + piece.height
    );
  });
}

export function clampRectToSurface(rect: Rect, surface: Surface): Rect {
  const width = Math.max(MIN_TILE_SIZE, Math.min(rect.width, surface.width));
  const height = Math.max(MIN_TILE_SIZE, Math.min(rect.height, surface.height));
  return {
    x: Math.min(Math.max(0, rect.x), Math.max(0, surface.width - width)),
    y: Math.min(Math.max(0, rect.y), Math.max(0, surface.height - height)),
    width,
    height
  };
}
