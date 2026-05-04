import { describe, expect, it } from "vitest";
import type { ManualSplit, Obstacle, OriginSettings, Surface, TileSpec } from "../types";
import { splitRectByLine } from "./geometry";
import { computeLayout, getMergeCandidate, measureSplits, splitChildId } from "./layout";
import { buildDividerSnapTargets, snapDividerPosition } from "./snapping";

const origin: OriginSettings = {
  anchorX: "start",
  anchorY: "start",
  offsetX: 0,
  offsetY: 0
};

function makeSurface(width: number, height: number): Surface {
  return { label: "test", width, height };
}

function makeSpec(pattern: TileSpec["pattern"] = "straight"): TileSpec {
  return { width: 600, height: 600, grout: 0, pattern };
}

describe("computeLayout", () => {
  it("counts whole tiles for a simple straight layout", () => {
    const result = computeLayout(makeSurface(1200, 600), makeSpec(), origin, []);

    expect(result.stats.wholeTiles).toBe(2);
    expect(result.stats.cutTiles).toBe(0);
    expect(result.stats.totalTiles).toBe(2);
    expect(result.stats.netArea).toBe(720000);
  });

  it("uses rotated tile dimensions", () => {
    const spec: TileSpec = { width: 300, height: 600, grout: 0, pattern: "rotated" };
    const result = computeLayout(makeSurface(1200, 300), spec, origin, []);

    expect(result.stats.wholeTiles).toBe(2);
    expect(result.sources[0].width).toBe(600);
    expect(result.sources[0].height).toBe(300);
  });

  it("creates cut tiles when brick rows offset across the boundary", () => {
    const result = computeLayout(makeSurface(1200, 1200), makeSpec("brick"), origin, []);

    expect(result.stats.wholeTiles).toBeGreaterThan(0);
    expect(result.stats.cutTiles).toBeGreaterThan(0);
    expect(result.pieces.some((piece) => piece.width < 600)).toBe(true);
  });

  it("subtracts rectangular obstacles from visible tile area", () => {
    const obstacles: Obstacle[] = [{ id: "o1", label: "door", x: 300, y: 0, width: 300, height: 600 }];
    const result = computeLayout(makeSurface(1200, 600), makeSpec(), origin, obstacles);

    expect(result.stats.wholeTiles).toBe(1);
    expect(result.stats.cutTiles).toBe(1);
    expect(result.stats.netArea).toBe(540000);
  });

  it("moves only the two tiles sharing a local vertical divider", () => {
    const result = computeLayout(makeSurface(1200, 1200), makeSpec(), origin, [], [
      { id: "d1", axis: "x", basePosition: 600, position: 520, sourceIds: ["r0-c0", "r0-c1"], gap: 0 }
    ]);
    const topLeft = result.sources.find((source) => source.id === "r0-c0");
    const topRight = result.sources.find((source) => source.id === "r0-c1");
    const bottomLeft = result.sources.find((source) => source.id === "r1-c0");
    const bottomRight = result.sources.find((source) => source.id === "r1-c1");

    expect(topLeft?.width).toBe(520);
    expect(topRight?.x).toBe(520);
    expect(topRight?.width).toBe(680);
    expect(bottomLeft?.width).toBe(600);
    expect(bottomRight?.x).toBe(600);
    expect(result.stats.netArea).toBe(1440000);
  });

  it("preserves grout while moving a local divider", () => {
    const spec: TileSpec = { width: 600, height: 600, grout: 4, pattern: "straight" };
    const result = computeLayout(makeSurface(1204, 600), spec, origin, [], [
      { id: "d1", axis: "x", basePosition: 602, position: 560, sourceIds: ["r0-c0", "r0-c1"], gap: 4 }
    ]);
    const left = result.sources.find((source) => source.id === "r0-c0");
    const right = result.sources.find((source) => source.id === "r0-c1");

    expect(left?.width).toBe(558);
    expect(right?.x).toBe(562);
    expect(right?.width).toBe(642);
  });

  it("moves a single outside tile edge without changing neighboring tiles", () => {
    const result = computeLayout(makeSurface(1200, 600), makeSpec(), origin, [], [
      { id: "d1", axis: "x", basePosition: 1200, position: 1120, sourceId: "r0-c1", edge: "right", gap: 0 }
    ]);
    const left = result.sources.find((source) => source.id === "r0-c0");
    const right = result.sources.find((source) => source.id === "r0-c1");

    expect(left?.width).toBe(600);
    expect(right?.x).toBe(600);
    expect(right?.width).toBe(520);
  });

  it("centers the start point when origin anchor is centered", () => {
    const centeredOrigin: OriginSettings = { anchorX: "center", anchorY: "start", offsetX: 0, offsetY: 0 };
    const result = computeLayout(makeSurface(1000, 600), makeSpec(), centeredOrigin, []);

    expect(result.stats.wholeTiles).toBe(1);
    expect(result.stats.cutTiles).toBe(2);
    expect(result.pieces.map((piece) => piece.width).sort((a, b) => a - b)).toEqual([200, 200, 600]);
  });

  it("merges a rectangular tile selection into one editable source", () => {
    const result = computeLayout(makeSurface(1200, 600), makeSpec(), origin, [], [], [
      { id: "merge-1", sourceIds: ["r0-c0", "r0-c1"] }
    ]);

    expect(result.sources).toHaveLength(1);
    expect(result.sources[0]).toMatchObject({
      id: "merge-1",
      x: 0,
      y: 0,
      width: 1200,
      height: 600,
      mergedSourceIds: ["r0-c0", "r0-c1"]
    });
    expect(result.pieces).toHaveLength(1);
    expect(result.stats.wholeTiles).toBe(1);
    expect(result.stats.totalTiles).toBe(1);
    expect(result.stats.netArea).toBe(720000);
  });

  it("keeps merged tiles adjustable from their outer boundary", () => {
    const result = computeLayout(
      makeSurface(1800, 600),
      makeSpec(),
      origin,
      [],
      [{ id: "d1", axis: "x", basePosition: 1200, position: 1000, sourceIds: ["merge-1", "r0-c2"], gap: 0 }],
      [{ id: "merge-1", sourceIds: ["r0-c0", "r0-c1"] }]
    );
    const merged = result.sources.find((source) => source.id === "merge-1");
    const right = result.sources.find((source) => source.id === "r0-c2");

    expect(merged?.width).toBe(1000);
    expect(right?.x).toBe(1000);
    expect(right?.width).toBe(800);
    expect(result.stats.netArea).toBe(1080000);
  });

  it("rejects non-rectangular merge selections", () => {
    const result = computeLayout(makeSurface(1200, 1200), makeSpec(), origin, []);

    expect(getMergeCandidate(result.baseSources, ["r0-c0", "r1-c1"])).toBeNull();
  });
});

describe("splitRectByLine", () => {
  it("keeps area conserved when a tile is split diagonally", () => {
    const result = splitRectByLine(
      { x: 0, y: 0, width: 600, height: 600 },
      { x: 0, y: 0 },
      { x: 600, y: 600 }
    );

    expect(result.areas[0]).toBeCloseTo(180000, 5);
    expect(result.areas[1]).toBeCloseTo(180000, 5);
    expect(result.totalArea).toBeCloseTo(360000, 5);
  });

  it("measures a split on a merged tile piece", () => {
    const layout = computeLayout(makeSurface(1200, 600), makeSpec(), origin, [], [], [
      { id: "merge-1", sourceIds: ["r0-c0", "r0-c1"] }
    ]);
    const piece = layout.pieces[0];
    const [measurement] = measureSplits(layout.pieces, [
      {
        id: "split-1",
        pieceId: piece.id,
        sourceId: piece.sourceId,
        start: { x: piece.x, y: piece.y },
        end: { x: piece.x + piece.width, y: piece.y + piece.height }
      }
    ]);

    expect(measurement.totalArea).toBeCloseTo(piece.area, 5);
    expect(measurement.areas[0]).toBeCloseTo(piece.area / 2, 5);
    expect(measurement.areas[1]).toBeCloseTo(piece.area / 2, 5);
  });
});

describe("manual tile splits", () => {
  it("splits one tile horizontally while keeping material usage unchanged", () => {
    const splits: ManualSplit[] = [
      { id: "split-1", parentPieceId: "r0-c0-f0", pieceId: "r0-c0-f0", sourceId: "r0-c0", axis: "horizontal", ratio: 0.5 }
    ];
    const layout = computeLayout(makeSurface(600, 600), makeSpec(), origin, [], [], [], splits);

    expect(layout.materialPieces).toHaveLength(1);
    expect(layout.pieces).toHaveLength(2);
    expect(layout.stats.totalTiles).toBe(1);
    expect(layout.pieces.map((piece) => piece.height)).toEqual([300, 300]);
    expect(layout.pieces.reduce((total, piece) => total + piece.area, 0)).toBeCloseTo(360000, 5);
    expect(layout.splitSegments[0]).toMatchObject({
      start: { x: 0, y: 300 },
      end: { x: 600, y: 300 },
      axis: "horizontal"
    });
  });

  it("splits one tile vertically while keeping area conserved", () => {
    const splits: ManualSplit[] = [
      { id: "split-1", parentPieceId: "r0-c0-f0", pieceId: "r0-c0-f0", sourceId: "r0-c0", axis: "vertical", ratio: 0.5 }
    ];
    const layout = computeLayout(makeSurface(600, 600), makeSpec(), origin, [], [], [], splits);

    expect(layout.pieces.map((piece) => piece.width)).toEqual([300, 300]);
    expect(layout.pieces.reduce((total, piece) => total + piece.area, 0)).toBeCloseTo(360000, 5);
    expect(layout.splitSegments[0]).toMatchObject({
      start: { x: 300, y: 0 },
      end: { x: 300, y: 600 },
      axis: "vertical"
    });
  });

  it("supports recursive splits with stable child ids", () => {
    const firstChildId = splitChildId("r0-c0-f0", "split-1", "a");
    const splits: ManualSplit[] = [
      { id: "split-1", parentPieceId: "r0-c0-f0", pieceId: "r0-c0-f0", sourceId: "r0-c0", axis: "horizontal", ratio: 0.5 },
      { id: "split-2", parentPieceId: firstChildId, pieceId: firstChildId, sourceId: "r0-c0", axis: "vertical", ratio: 0.5 }
    ];
    const layout = computeLayout(makeSurface(600, 600), makeSpec(), origin, [], [], [], splits);

    expect(layout.pieces.map((piece) => piece.id)).toEqual([
      splitChildId(firstChildId, "split-2", "a"),
      splitChildId(firstChildId, "split-2", "b"),
      splitChildId("r0-c0-f0", "split-1", "b")
    ]);
    expect(layout.pieces.map((piece) => `${Math.round(piece.width)}x${Math.round(piece.height)}`)).toEqual([
      "300x300",
      "300x300",
      "600x300"
    ]);
  });

  it("splits a merged tile piece", () => {
    const splits: ManualSplit[] = [
      { id: "split-1", parentPieceId: "merge-1-f0", pieceId: "merge-1-f0", sourceId: "merge-1", axis: "vertical", ratio: 0.5 }
    ];
    const layout = computeLayout(
      makeSurface(1200, 600),
      makeSpec(),
      origin,
      [],
      [],
      [{ id: "merge-1", sourceIds: ["r0-c0", "r0-c1"] }],
      splits
    );

    expect(layout.materialPieces).toHaveLength(1);
    expect(layout.pieces).toHaveLength(2);
    expect(layout.pieces.map((piece) => piece.width)).toEqual([600, 600]);
    expect(layout.stats.totalTiles).toBe(1);
  });

  it("splits visible pieces after obstacle subtraction", () => {
    const obstacles: Obstacle[] = [{ id: "o1", label: "column", x: 300, y: 0, width: 300, height: 300 }];
    const splits: ManualSplit[] = [
      { id: "split-1", parentPieceId: "r0-c0-f0", pieceId: "r0-c0-f0", sourceId: "r0-c0", axis: "vertical", ratio: 0.5 }
    ];
    const layout = computeLayout(makeSurface(600, 600), makeSpec(), origin, obstacles, [], [], splits);

    expect(layout.materialPieces).toHaveLength(2);
    expect(layout.pieces).toHaveLength(3);
    expect(layout.pieces.reduce((total, piece) => total + piece.area, 0)).toBeCloseTo(layout.stats.netArea, 5);
  });
});

describe("divider snapping", () => {
  it("snaps a dragged divider to the nearest tile boundary", () => {
    const layout = computeLayout(makeSurface(1200, 600), makeSpec(), origin, []);
    const targets = buildDividerSnapTargets("x", makeSurface(1200, 600), layout.baseSources, [], []);
    const result = snapDividerPosition(584, 1200, targets);

    expect(result.snapped).toBe(true);
    expect(result.position).toBe(600);
    expect(result.target?.label).toBe("瓷砖边界");
  });

  it("snaps a dragged divider to obstacle edges", () => {
    const surface = makeSurface(1200, 600);
    const obstacle: Obstacle = { id: "o1", label: "column", x: 455, y: 100, width: 120, height: 200 };
    const layout = computeLayout(surface, makeSpec(), origin, [obstacle]);
    const targets = buildDividerSnapTargets("x", surface, layout.baseSources, [obstacle], []);
    const result = snapDividerPosition(448, surface.width, targets);

    expect(result.snapped).toBe(true);
    expect(result.position).toBe(455);
    expect(result.target?.label).toBe("障碍边缘");
  });

  it("does not snap when outside the threshold", () => {
    const layout = computeLayout(makeSurface(1200, 600), makeSpec(), origin, []);
    const targets = buildDividerSnapTargets("x", makeSurface(1200, 600), layout.baseSources, [], []);
    const result = snapDividerPosition(536, 1200, targets);

    expect(result.snapped).toBe(false);
    expect(result.position).toBe(536);
  });

  it("uses a tighter threshold for construction grid snapping", () => {
    const layout = computeLayout(makeSurface(1200, 600), makeSpec(), origin, []);
    const targets = buildDividerSnapTargets("x", makeSurface(1200, 600), layout.baseSources, [], []);
    const result = snapDividerPosition(547, 1200, targets);

    expect(result.snapped).toBe(true);
    expect(result.position).toBe(550);
    expect(result.target?.label).toBe("50mm 网格");
  });
});
