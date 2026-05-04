import { describe, expect, it } from "vitest";
import type { OriginSettings, Surface, TileSpec, TileVisual } from "../types";
import { computeLayout } from "./layout";
import { buildCadSvg } from "./pdf";

const surface: Surface = { label: "测试区域", width: 1200, height: 600 };
const spec: TileSpec = { width: 600, height: 600, grout: 0, pattern: "straight" };
const origin: OriginSettings = { anchorX: "start", anchorY: "start", offsetX: 0, offsetY: 0 };
const visual: TileVisual = { mode: "color", color: "#ffffff" };

describe("buildCadSvg", () => {
  it("generates Chinese CAD drawing copy and labels every tile with dimensions", () => {
    const result = buildCadSvg({
      surface,
      layout: computeLayout(surface, spec, origin, [], []),
      obstacles: [],
      splits: [],
      textAnnotations: [],
      defaultVisual: visual,
      tileVisuals: {},
      paperSize: "a3"
    });

    expect(result.svg).toContain("瓷砖排版施工图");
    expect(result.svg).toContain("项目：测试区域");
    expect(result.svg).toContain("1200毫米");
    expect(result.svg.match(/600×600/g)).toHaveLength(2);
    expect(result.svg).toContain('<text class="" text-anchor="middle" x="480" y="480" font-size="42">600×600</text>');
    expect(result.svg).toContain("background: transparent");
    expect(result.svg).not.toContain('class="sheet-border"');
    expect(result.svg).toContain('class="surface-border"');
    expect(result.svg).toContain('class="title-border"');
    expect(result.svg.match(/class="dimension-arrow"/g)).toHaveLength(4);
    expect(result.svg).toContain('points="180,850 120,826 120,874"');
    expect(result.svg).toContain('points="1380,850 1440,826 1440,874"');
    expect(result.svg).toContain('points="1450,180 1426,120 1474,120"');
    expect(result.svg).toContain('points="1450,780 1426,840 1474,840"');
    expect(result.svg).not.toContain("marker-start");
    expect(result.svg).not.toContain("marker-end");
    expect(result.svg).not.toMatch(/<text[^>]*>\d+<\/text>/);
    expect(result.svg).not.toContain("Tile Layout");
    expect(result.svg).not.toContain("Quantity");
  });

  it("exports default tile color fills", () => {
    const result = buildCadSvg({
      surface,
      layout: computeLayout(surface, spec, origin, [], []),
      obstacles: [],
      splits: [],
      textAnnotations: [],
      defaultVisual: { mode: "color", color: "#d8c8b0" },
      tileVisuals: {},
      paperSize: "a3"
    });

    expect(result.svg.match(/class="tile-fill"/g)).toHaveLength(2);
    expect(result.svg.match(/fill="#d8c8b0"/g)).toHaveLength(2);
    expect(result.svg).toContain("class=\"tile-outline\"");
  });

  it("keeps narrow tile dimension labels readable in exported drawings", () => {
    const narrowSurface: Surface = { label: "窄砖区域", width: 620, height: 600 };
    const result = buildCadSvg({
      surface: narrowSurface,
      layout: computeLayout(narrowSurface, spec, origin, [], []),
      obstacles: [],
      splits: [],
      textAnnotations: [],
      defaultVisual: { mode: "color", color: "#d8c8b0" },
      tileVisuals: {},
      paperSize: "a3"
    });

    expect(result.svg).toContain("20×600");
    expect(result.svg).toContain("class=\"tile-label-backing\"");
    expect(result.svg).toContain("class=\"compact-label\"");
    expect(result.svg).toContain('text-anchor="middle"');
    expect(result.svg).toContain("class=\"tile-label-leader\"");
    expect(result.svg.indexOf("class=\"tile-label-layer\"")).toBeGreaterThan(
      result.svg.lastIndexOf("class=\"tile-piece\"")
    );
  });

  it("positions exported tile and overall dimension labels like the editor canvas", () => {
    const narrowSurface: Surface = { label: "窄砖区域", width: 1240, height: 800 };
    const result = buildCadSvg({
      surface: narrowSurface,
      layout: computeLayout(
        narrowSurface,
        { ...spec, width: 400, height: 800 },
        { ...origin, anchorX: "end" },
        [],
        []
      ),
      obstacles: [],
      splits: [],
      textAnnotations: [],
      defaultVisual: { mode: "color", color: "#ffffff" },
      tileVisuals: {},
      paperSize: "a3"
    });

    expect(result.svg).toContain('class="tile-label-backing" x="24" y="552"');
    expect(result.svg).toContain('class="dimension-text" x="800" y="1096"');
    expect(result.svg).toContain('class="dimension-text vertical-text" x="1536" y="580"');
    expect(result.svg).not.toContain("40×800毫米");
  });

  it("exports per-tile color and image fills", () => {
    const imageDataUrl = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB";
    const result = buildCadSvg({
      surface,
      layout: computeLayout(surface, spec, origin, [], []),
      obstacles: [],
      splits: [],
      textAnnotations: [],
      defaultVisual: { mode: "color", color: "#ffffff" },
      tileVisuals: {
        "r0-c0": { mode: "color", color: "#336699" },
        "r0-c1": { mode: "image", color: "#ffffff", imageDataUrl }
      },
      paperSize: "a3"
    });

    expect(result.svg).toContain("fill=\"#336699\"");
    expect(result.svg).not.toContain("tile-image-fill");
    expect(result.svg).toContain("class=\"tile-image\"");
    expect(result.svg).toContain(imageDataUrl);
    expect(result.svg).toContain("preserveAspectRatio=\"xMidYMid slice\"");
  });

  it("exports merged image tiles with the same placement as the editor canvas", () => {
    const imageDataUrl = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB";
    const mergedLayout = computeLayout(
      surface,
      spec,
      origin,
      [],
      [],
      [{ id: "merge-1", sourceIds: ["r0-c0", "r0-c1"] }]
    );
    const result = buildCadSvg({
      surface,
      layout: mergedLayout,
      obstacles: [],
      splits: [],
      textAnnotations: [],
      defaultVisual: { mode: "color", color: "#ffffff" },
      tileVisuals: {
        "merge-1": { mode: "image", color: "#ffffff", imageDataUrl }
      },
      paperSize: "a3"
    });

    expect(result.svg).toContain(
      `class="tile-image" href="${imageDataUrl}" x="180" y="180" width="1200" height="600"`
    );
    expect(result.svg).not.toContain("<pattern id=\"tile-image-fill");
  });

  it("exports manual text annotations above the tile drawing", () => {
    const result = buildCadSvg({
      surface,
      layout: computeLayout(surface, spec, origin, [], []),
      obstacles: [],
      splits: [],
      textAnnotations: [{ id: "text-1", text: "墙面备注", x: 120, y: 160, fontSize: 72, color: "#a74332" }],
      defaultVisual: visual,
      tileVisuals: {},
      paperSize: "a3"
    });

    expect(result.svg).toContain("墙面备注");
    expect(result.svg).toContain("class=\"text-annotation-layer\"");
    expect(result.svg).toContain("fill=\"#a74332\"");
    expect(result.svg.indexOf("class=\"text-annotation-layer\"")).toBeGreaterThan(
      result.svg.indexOf("class=\"tile-label-layer\"")
    );
  });

  it("exports split child tiles with centered child dimensions", () => {
    const splitLayout = computeLayout(surface, spec, origin, [], [], [], [
      { id: "split-1", parentPieceId: "r0-c0-f0", pieceId: "r0-c0-f0", sourceId: "r0-c0", axis: "vertical", ratio: 0.5 }
    ]);
    const result = buildCadSvg({
      surface,
      layout: splitLayout,
      obstacles: [],
      splits: [
        { id: "split-1", parentPieceId: "r0-c0-f0", pieceId: "r0-c0-f0", sourceId: "r0-c0", axis: "vertical", ratio: 0.5 }
      ],
      textAnnotations: [],
      defaultVisual: { mode: "color", color: "#ffffff" },
      tileVisuals: {},
      paperSize: "a3"
    });

    expect(result.svg.match(/300×600/g)).toHaveLength(2);
    expect(result.svg).not.toContain('class="split-export"');
    expect(result.svg).toContain('class="tile-outline" x="180" y="180" width="300" height="600"');
    expect(result.svg).toContain('class="tile-outline" x="480" y="180" width="300" height="600"');
    expect(result.svg).toContain("分割：1处");
  });
});
