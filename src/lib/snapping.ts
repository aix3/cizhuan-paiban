import type { DividerAxis, ManualDivider, Obstacle, SourceTile, Surface } from "../types";
import { clamp, roundTo } from "./geometry";

export type SnapTargetKind = "tile" | "obstacle" | "center" | "grid";

export interface SnapTarget {
  position: number;
  kind: SnapTargetKind;
  label: string;
}

export interface SnapResult {
  position: number;
  snapped: boolean;
  target?: SnapTarget;
}

export const SNAP_THRESHOLD_MM = 30;
const GRID_SNAP_THRESHOLD_MM = 8;
const SNAP_GRID_MM = 50;
const EDGE_PADDING_MM = 20;
const TARGET_PRIORITY: Record<SnapTargetKind, number> = {
  obstacle: 0,
  tile: 1,
  center: 2,
  grid: 3
};

function addTarget(targets: Map<number, SnapTarget>, position: number, kind: SnapTargetKind, label: string, limit: number) {
  const rounded = roundTo(position);
  if (rounded <= EDGE_PADDING_MM || rounded >= limit - EDGE_PADDING_MM) return;

  if (!targets.has(rounded)) {
    targets.set(rounded, { position: rounded, kind, label });
  }
}

export function buildDividerSnapTargets(
  axis: DividerAxis,
  surface: Surface,
  baseSources: SourceTile[],
  obstacles: Obstacle[],
  manualDividers: ManualDivider[]
): SnapTarget[] {
  const limit = axis === "x" ? surface.width : surface.height;
  const targets = new Map<number, SnapTarget>();

  baseSources.forEach((source) => {
    const positions =
      axis === "x"
        ? [source.baseRect.x, source.baseRect.x + source.baseRect.width]
        : [source.baseRect.y, source.baseRect.y + source.baseRect.height];
    positions.forEach((position) => addTarget(targets, position, "tile", "瓷砖边界", limit));
  });

  obstacles.forEach((obstacle) => {
    const positions = axis === "x" ? [obstacle.x, obstacle.x + obstacle.width] : [obstacle.y, obstacle.y + obstacle.height];
    positions.forEach((position) => addTarget(targets, position, "obstacle", "障碍边缘", limit));
  });

  manualDividers
    .filter((divider) => divider.axis === axis)
    .forEach((divider) => addTarget(targets, divider.position, "tile", "已调整边界", limit));

  addTarget(targets, limit / 2, "center", "区域中心", limit);

  for (let position = SNAP_GRID_MM; position < limit; position += SNAP_GRID_MM) {
    addTarget(targets, position, "grid", "50mm 网格", limit);
  }

  return Array.from(targets.values()).sort((a, b) => a.position - b.position);
}

export function snapDividerPosition(rawPosition: number, limit: number, targets: SnapTarget[], threshold = SNAP_THRESHOLD_MM): SnapResult {
  const clamped = clamp(rawPosition, EDGE_PADDING_MM, limit - EDGE_PADDING_MM);
  const nearest = targets
    .map((target) => ({
      target,
      distance: Math.abs(target.position - clamped),
      threshold: target.kind === "grid" ? GRID_SNAP_THRESHOLD_MM : threshold
    }))
    .filter((candidate) => candidate.distance <= candidate.threshold)
    .sort((a, b) => {
      const priorityDiff = TARGET_PRIORITY[a.target.kind] - TARGET_PRIORITY[b.target.kind];
      return priorityDiff || a.distance - b.distance;
    })[0];

  if (nearest) {
    return {
      position: nearest.target.position,
      snapped: true,
      target: nearest.target
    };
  }

  return {
    position: clamped,
    snapped: false
  };
}
