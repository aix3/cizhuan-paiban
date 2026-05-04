export type LayoutPattern = "straight" | "rotated" | "brick";
export type AnchorSide = "start" | "center" | "end";
export type FillMode = "color" | "image";
export type DividerAxis = "x" | "y";
export type DividerEdge = "left" | "right" | "top" | "bottom";
export type PaperSize = "a4" | "a3";
export type SplitAxis = "horizontal" | "vertical";

export interface Point {
  x: number;
  y: number;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Surface {
  width: number;
  height: number;
  label: string;
}

export interface TileSpec {
  width: number;
  height: number;
  grout: number;
  pattern: LayoutPattern;
}

export interface OriginSettings {
  anchorX: AnchorSide;
  anchorY: AnchorSide;
  offsetX: number;
  offsetY: number;
}

export interface Obstacle extends Rect {
  id: string;
  label: string;
}

export interface TileVisual {
  mode: FillMode;
  color: string;
  imageDataUrl?: string;
}

export interface ManualDivider {
  id: string;
  axis: DividerAxis;
  basePosition: number;
  position: number;
  sourceIds?: [string, string];
  sourceId?: string;
  edge?: DividerEdge;
  gap?: number;
}

export interface ManualSplit {
  id: string;
  pieceId?: string;
  parentPieceId?: string;
  sourceId: string;
  axis?: SplitAxis;
  ratio?: number;
  start?: Point;
  end?: Point;
}

export interface TextAnnotation {
  id: string;
  text: string;
  x: number;
  y: number;
  fontSize: number;
  color: string;
}

export interface TileMerge {
  id: string;
  sourceIds: string[];
}

export interface SourceTile extends Rect {
  id: string;
  row: number;
  col: number;
  baseRect: Rect;
  mergedSourceIds?: string[];
}

export interface TilePiece extends Rect {
  id: string;
  sourceId: string;
  row: number;
  col: number;
  fragmentIndex: number;
  area: number;
  isWhole: boolean;
  isSplitChild?: boolean;
}

export interface LayoutStats {
  wholeTiles: number;
  cutTiles: number;
  totalTiles: number;
  netArea: number;
  tileArea: number;
  wasteArea: number;
  wasteRate: number;
}

export interface LayoutResult {
  baseSources: SourceTile[];
  sources: SourceTile[];
  materialPieces: TilePiece[];
  pieces: TilePiece[];
  splitSegments: SplitSegment[];
  stats: LayoutStats;
}

export interface SplitSegment {
  id: string;
  sourceId: string;
  parentPieceId: string;
  axis: SplitAxis;
  parentRect: Rect;
  start: Point;
  end: Point;
}

export interface SplitMeasurement {
  id: string;
  areas: [number, number];
  totalArea: number;
  polygons: [Point[], Point[]];
}
