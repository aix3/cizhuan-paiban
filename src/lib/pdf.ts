import { jsPDF } from "jspdf";
import type {
  LayoutResult,
  ManualSplit,
  Obstacle,
  PaperSize,
  Surface,
  TextAnnotation,
  TileVisual
} from "../types";
import { dimensionArrowPoints, type DimensionArrowDirection } from "./cadDimensions";
import { measureSplits } from "./layout";
import { buildTileLabelLayout, buildTileLabelMetrics } from "./tileLabels";

interface ExportDrawingOptions {
  surface: Surface;
  layout: LayoutResult;
  obstacles: Obstacle[];
  splits: ManualSplit[];
  textAnnotations: TextAnnotation[];
  defaultVisual: TileVisual;
  tileVisuals: Record<string, TileVisual>;
  paperSize: PaperSize;
}

interface CadSvgResult {
  svg: string;
  width: number;
  height: number;
}

function escapeXml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function mm(value: number) {
  return `${Math.round(value)}毫米`;
}

function area(value: number) {
  return `${(value / 1_000_000).toFixed(2)}平方米`;
}

function annotationTspans(annotation: TextAnnotation, x: number) {
  return annotation.text
    .split(/\r?\n/)
    .map((line, index) => {
      const dy = index === 0 ? 0 : annotation.fontSize * 1.2;
      return `<tspan x="${x}" dy="${dy}">${escapeXml(line || " ")}</tspan>`;
    })
    .join("");
}

function visualForSource(sourceId: string, defaultVisual: TileVisual, tileVisuals: Record<string, TileVisual>) {
  return tileVisuals[sourceId] ?? defaultVisual;
}

function arrowPolygon(x: number, y: number, direction: DimensionArrowDirection) {
  return `<polygon class="dimension-arrow" points="${dimensionArrowPoints(x, y, direction)}" />`;
}

export function buildCadSvg({
  surface,
  layout,
  obstacles,
  splits,
  textAnnotations,
  defaultVisual,
  tileVisuals
}: ExportDrawingOptions): CadSvgResult {
  const margin = 180;
  const titleBlockWidth = 760;
  const viewWidth = surface.width + margin * 3 + titleBlockWidth;
  const viewHeight = Math.max(surface.height + margin * 2, 1900);
  const scale = Math.min(2400 / viewWidth, 1800 / viewHeight, 1);
  const width = Math.round(viewWidth * scale);
  const height = Math.round(viewHeight * scale);
  const drawingX = margin;
  const drawingY = margin;
  const tileLabelMargin = 160;
  const titleX = drawingX + surface.width + margin;
  const titleY = drawingY;
  const dimensionOffset = 70;
  const dimensionTextOffset = 46;
  const horizontalDimensionY = drawingY + surface.height + dimensionOffset;
  const verticalDimensionX = drawingX + surface.width + dimensionOffset;
  const mergedCount = layout.sources.filter((source) => source.mergedSourceIds?.length).length;
  const splitMeasurements = measureSplits(layout.materialPieces, splits);
  const tileRects = layout.pieces
    .map((piece) => {
      const x = drawingX + piece.x;
      const y = drawingY + piece.y;
      const visual = visualForSource(piece.sourceId, defaultVisual, tileVisuals);
      const fill =
        visual.mode === "image" && visual.imageDataUrl
          ? `<image class="tile-image" href="${escapeXml(visual.imageDataUrl)}" x="${x}" y="${y}" width="${piece.width}" height="${piece.height}" preserveAspectRatio="xMidYMid slice" />`
          : `<rect class="tile-fill" x="${x}" y="${y}" width="${piece.width}" height="${piece.height}" fill="${escapeXml(visual.color)}" />`;
      return `
        <g class="tile-piece">
          ${fill}
          <rect class="tile-outline" x="${x}" y="${y}" width="${piece.width}" height="${piece.height}" />
        </g>
      `;
    })
    .join("");

  const tileLabels = layout.pieces
    .map((piece) => {
      const label = buildTileLabelLayout(piece, surface, tileLabelMargin, buildTileLabelMetrics(piece.width, piece.height));
      return `
        <g class="tile-label-item">
          ${label.leader ? `<line class="tile-label-leader" x1="${drawingX + label.leader.x1}" y1="${drawingY + label.leader.y1}" x2="${drawingX + label.leader.x2}" y2="${drawingY + label.leader.y2}" />` : ""}
          ${label.compact ? `<rect class="tile-label-backing" x="${drawingX + label.boxX}" y="${drawingY + label.boxY}" width="${label.boxWidth}" height="${label.boxHeight}" rx="10" />` : ""}
          <text class="${label.compact ? "compact-label" : ""}" text-anchor="middle" x="${drawingX + label.textX}" y="${drawingY + label.textY}" font-size="${label.fontSize}">${escapeXml(label.label)}</text>
        </g>
      `;
    })
    .join("");

  const obstacleRects = obstacles
    .map((obstacle) => {
      const x = drawingX + obstacle.x;
      const y = drawingY + obstacle.y;
      return `
        <g class="obstacle-export">
          <rect x="${x}" y="${y}" width="${obstacle.width}" height="${obstacle.height}" />
          <text x="${x + 24}" y="${y + 56}">${escapeXml(obstacle.label)}</text>
        </g>
      `;
    })
    .join("");

  const splitLines = splits
      .filter((split) => split.start && split.end)
      .map((split) => {
        return `<line class="split-export" x1="${drawingX + split.start!.x}" y1="${drawingY + split.start!.y}" x2="${drawingX + split.end!.x}" y2="${drawingY + split.end!.y}" />`;
      })
    .join("");

  const textAnnotationNodes = textAnnotations
    .map((annotation) => {
      const x = drawingX + annotation.x;
      const y = drawingY + annotation.y;
      return `
        <text class="text-annotation-export" x="${x}" y="${y}" font-size="${annotation.fontSize}" fill="${escapeXml(annotation.color)}">
          ${annotationTspans(annotation, x)}
        </text>
      `;
    })
    .join("");

  const splitStats = splitMeasurements
    .map((measurement, index) => {
      return `<text x="${titleX + 30}" y="${titleY + 600 + index * 46}">分割${index + 1}：${area(measurement.areas[0])} / ${area(measurement.areas[1])}</text>`;
    })
    .join("");
  const dimensionArrows = [
    arrowPolygon(drawingX, horizontalDimensionY, "right"),
    arrowPolygon(drawingX + surface.width, horizontalDimensionY, "left"),
    arrowPolygon(verticalDimensionX, drawingY, "down"),
    arrowPolygon(verticalDimensionX, drawingY + surface.height, "up")
  ].join("\n  ");

  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${viewWidth} ${viewHeight}">
  <defs>
    <pattern id="hatch" width="70" height="70" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
      <line x1="0" y1="0" x2="0" y2="70" class="hatch-line" />
    </pattern>
  </defs>
  <style>
    svg { background: transparent; }
    text {
      font-family: "PingFang SC", "Microsoft YaHei", "Heiti SC", sans-serif;
      fill: #101820;
      dominant-baseline: middle;
      letter-spacing: 0;
    }
    .surface-border, .title-border {
      fill: none;
      stroke: #101820;
      stroke-width: 4;
      vector-effect: non-scaling-stroke;
    }
    .tile-fill {
      stroke: none;
      fill-opacity: 0.82;
    }
    .tile-image {
      opacity: 1;
    }
    .tile-outline {
      fill: none;
      stroke: #101820;
      stroke-width: 2.2;
      vector-effect: non-scaling-stroke;
    }
    .tile-label-item text {
      text-anchor: middle;
      font-weight: 800;
    }
    .compact-label {
      paint-order: stroke;
      stroke: rgba(255,255,255,0.92);
      stroke-width: 7;
    }
    .tile-label-leader {
      stroke: #005a9c;
      stroke-width: 2.5;
      fill: none;
      vector-effect: non-scaling-stroke;
    }
    .tile-label-backing {
      fill: rgba(255,255,255,0.78);
      stroke: rgba(16,24,32,0.22);
      stroke-width: 1.5;
      vector-effect: non-scaling-stroke;
    }
    .dimension, .leader {
      stroke: #101820;
      stroke-width: 3;
      fill: none;
      vector-effect: non-scaling-stroke;
    }
    .dimension-arrow {
      fill: #101820;
      stroke: none;
    }
    .extension {
      stroke: #101820;
      stroke-width: 2;
      stroke-dasharray: 18 12;
      vector-effect: non-scaling-stroke;
    }
    .dimension-text {
      font-size: 54px;
      font-weight: 800;
      text-anchor: middle;
      paint-order: stroke;
      stroke: rgba(255,255,255,0.9);
      stroke-width: 8;
    }
    .vertical-text {
      writing-mode: vertical-rl;
    }
    .obstacle-export rect {
      fill: url(#hatch);
      stroke: #b1271b;
      stroke-width: 4;
      vector-effect: non-scaling-stroke;
    }
    .obstacle-export text {
      fill: #b1271b;
      font-size: 48px;
      font-weight: 800;
      paint-order: stroke;
      stroke: rgba(255,255,255,0.9);
      stroke-width: 8;
    }
    .split-export {
      stroke: #005a9c;
      stroke-width: 5;
      stroke-dasharray: 24 12;
      vector-effect: non-scaling-stroke;
    }
    .title-border {
      stroke-width: 3;
    }
    .title-main {
      font-size: 64px;
      font-weight: 900;
    }
    .title-label {
      font-size: 38px;
      font-weight: 800;
    }
    .title-value {
      font-size: 36px;
      font-weight: 600;
    }
    .text-annotation-export {
      font-weight: 800;
      paint-order: stroke;
      stroke: rgba(255,255,255,0.92);
      stroke-width: 8;
      text-anchor: start;
      dominant-baseline: middle;
    }
    .thin-row {
      stroke: #101820;
      stroke-width: 2;
      vector-effect: non-scaling-stroke;
    }
    .hatch-line {
      stroke: rgba(177, 39, 27, 0.42);
      stroke-width: 3;
      vector-effect: non-scaling-stroke;
    }
  </style>

  <rect class="surface-border" x="${drawingX}" y="${drawingY}" width="${surface.width}" height="${surface.height}" />
  ${tileRects}
  ${obstacleRects}
  ${splitLines}
  <g class="tile-label-layer">
    ${tileLabels}
  </g>
  <g class="text-annotation-layer">
    ${textAnnotationNodes}
  </g>

  <line class="extension" x1="${drawingX}" y1="${drawingY + surface.height}" x2="${drawingX}" y2="${drawingY + surface.height + dimensionOffset + 28}" />
  <line class="extension" x1="${drawingX + surface.width}" y1="${drawingY + surface.height}" x2="${drawingX + surface.width}" y2="${drawingY + surface.height + dimensionOffset + 28}" />
  <line class="dimension" x1="${drawingX}" y1="${horizontalDimensionY}" x2="${drawingX + surface.width}" y2="${horizontalDimensionY}" />
  <text class="dimension-text" x="${drawingX + surface.width / 2}" y="${horizontalDimensionY + dimensionTextOffset}">${mm(surface.width)}</text>

  <line class="extension" x1="${drawingX + surface.width}" y1="${drawingY}" x2="${drawingX + surface.width + dimensionOffset + 28}" y2="${drawingY}" />
  <line class="extension" x1="${drawingX + surface.width}" y1="${drawingY + surface.height}" x2="${drawingX + surface.width + dimensionOffset + 28}" y2="${drawingY + surface.height}" />
  <line class="dimension" x1="${verticalDimensionX}" y1="${drawingY}" x2="${verticalDimensionX}" y2="${drawingY + surface.height}" />
  <text class="dimension-text vertical-text" x="${verticalDimensionX + dimensionTextOffset}" y="${drawingY + surface.height / 2}">${mm(surface.height)}</text>
  ${dimensionArrows}

  <g class="title-block">
    <rect class="title-border" x="${titleX}" y="${titleY}" width="${titleBlockWidth}" height="760" />
    <line class="thin-row" x1="${titleX}" y1="${titleY + 110}" x2="${titleX + titleBlockWidth}" y2="${titleY + 110}" />
    <line class="thin-row" x1="${titleX}" y1="${titleY + 200}" x2="${titleX + titleBlockWidth}" y2="${titleY + 200}" />
    <line class="thin-row" x1="${titleX}" y1="${titleY + 290}" x2="${titleX + titleBlockWidth}" y2="${titleY + 290}" />
    <line class="thin-row" x1="${titleX}" y1="${titleY + 380}" x2="${titleX + titleBlockWidth}" y2="${titleY + 380}" />
    <line class="thin-row" x1="${titleX}" y1="${titleY + 470}" x2="${titleX + titleBlockWidth}" y2="${titleY + 470}" />
    <text class="title-main" x="${titleX + 30}" y="${titleY + 60}">瓷砖排版施工图</text>
    <text class="title-label" x="${titleX + 30}" y="${titleY + 155}">项目：${escapeXml(surface.label || "未命名")}</text>
    <text class="title-label" x="${titleX + 30}" y="${titleY + 245}">区域：${mm(surface.width)} × ${mm(surface.height)}</text>
    <text class="title-label" x="${titleX + 30}" y="${titleY + 335}">用量：整砖${layout.stats.wholeTiles} / 切砖${layout.stats.cutTiles} / 合计${layout.stats.totalTiles}</text>
    <text class="title-label" x="${titleX + 30}" y="${titleY + 425}">净面积：${area(layout.stats.netArea)}，损耗${(layout.stats.wasteRate * 100).toFixed(1)}%</text>
    <text class="title-label" x="${titleX + 30}" y="${titleY + 515}">障碍：${obstacles.length}处，合并：${mergedCount}处，分割：${splits.length}处，文字：${textAnnotations.length}处</text>
    ${splitStats}
  </g>
</svg>`;

  return { svg, width, height };
}

function svgToPngDataUrl({ svg, width, height }: CadSvgResult): Promise<string> {
  return new Promise((resolve, reject) => {
    const blob = new Blob([svg], { type: "image/svg+xml;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const image = new Image();

    image.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext("2d");

      if (!context) {
        URL.revokeObjectURL(url);
        reject(new Error("无法创建导出画布"));
        return;
      }

      context.clearRect(0, 0, width, height);
      context.drawImage(image, 0, 0, width, height);
      URL.revokeObjectURL(url);
      resolve(canvas.toDataURL("image/png"));
    };

    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("施工图渲染失败"));
    };

    image.src = url;
  });
}

function downloadDataUrl(dataUrl: string, filename: string) {
  const link = document.createElement("a");
  link.href = dataUrl;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
}

export async function exportLayoutPng(options: ExportDrawingOptions) {
  const png = await svgToPngDataUrl(buildCadSvg(options));
  downloadDataUrl(png, `瓷砖排版-${options.surface.label || "施工图"}.png`);
}

export async function exportLayoutPdf(options: ExportDrawingOptions) {
  const cadSvg = buildCadSvg(options);
  const png = await svgToPngDataUrl(cadSvg);
  const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: options.paperSize });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 8;
  const widthRatio = (pageWidth - margin * 2) / cadSvg.width;
  const heightRatio = (pageHeight - margin * 2) / cadSvg.height;
  const scale = Math.min(widthRatio, heightRatio);
  const imageWidth = cadSvg.width * scale;
  const imageHeight = cadSvg.height * scale;
  const x = (pageWidth - imageWidth) / 2;
  const y = (pageHeight - imageHeight) / 2;

  doc.addImage(png, "PNG", x, y, imageWidth, imageHeight);
  doc.save(`瓷砖排版-${options.surface.label || "施工图"}.pdf`);
}
