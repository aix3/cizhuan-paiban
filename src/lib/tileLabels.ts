import type { Rect, Surface } from "../types";
import { clamp } from "./geometry";

export interface TileLabelMetrics {
  label: string;
  compact: boolean;
  fontSize: number;
  boxWidth: number;
  boxHeight: number;
}

export interface TileLabelLayout extends TileLabelMetrics {
  textX: number;
  textY: number;
  boxX: number;
  boxY: number;
  leader?: {
    x1: number;
    y1: number;
    x2: number;
    y2: number;
  };
}

function bounded(value: number, min: number, max: number) {
  return min <= max ? clamp(value, min, max) : value;
}

export function tileDimensionText(width: number, height: number) {
  return `${Math.round(width)}×${Math.round(height)}`;
}

export function buildTileLabelMetrics(width: number, height: number): TileLabelMetrics {
  const label = tileDimensionText(width, height);
  const compact = width < 280 || height < 150;
  const fontSize = compact ? 38 : 42;
  const boxWidth = label.length * fontSize * 0.6 + 32;
  const boxHeight = fontSize + 18;

  return { label, compact, fontSize, boxWidth, boxHeight };
}

export function buildTileLabelLayout(
  rect: Rect,
  surface: Pick<Surface, "width" | "height">,
  margin: number,
  metrics: TileLabelMetrics
): TileLabelLayout {
  const centerX = rect.x + rect.width / 2;
  const centerY = rect.y + rect.height / 2;
  const minTextX = -margin + metrics.boxWidth / 2 + 4;
  const maxTextX = surface.width + margin - metrics.boxWidth / 2 - 4;
  const minTextY = -margin + metrics.boxHeight / 2 + 4;
  const maxTextY = surface.height + margin - metrics.boxHeight / 2 - 4;
  let textX = centerX;
  let textY = centerY;
  let leader: TileLabelLayout["leader"];

  if (metrics.compact && rect.width < 96 && metrics.boxWidth > rect.width + 24) {
    const placeLeft = centerX <= surface.width / 2;
    textX = placeLeft
      ? bounded(rect.x - metrics.boxWidth / 2 - 10, minTextX, maxTextX)
      : bounded(rect.x + rect.width + metrics.boxWidth / 2 + 10, minTextX, maxTextX);
    textY = bounded(centerY, minTextY, maxTextY);
    leader = {
      x1: placeLeft ? rect.x : rect.x + rect.width,
      y1: centerY,
      x2: textX + (placeLeft ? metrics.boxWidth / 2 : -metrics.boxWidth / 2),
      y2: textY
    };
  } else if (metrics.compact && rect.height < 96 && metrics.boxHeight > rect.height + 12) {
    const placeAbove = centerY <= surface.height / 2;
    textX = bounded(centerX, minTextX, maxTextX);
    textY = placeAbove
      ? bounded(rect.y - metrics.boxHeight / 2 - 10, minTextY, maxTextY)
      : bounded(rect.y + rect.height + metrics.boxHeight / 2 + 10, minTextY, maxTextY);
    leader = {
      x1: centerX,
      y1: placeAbove ? rect.y : rect.y + rect.height,
      x2: textX,
      y2: textY + (placeAbove ? metrics.boxHeight / 2 : -metrics.boxHeight / 2)
    };
  }

  return {
    ...metrics,
    textX,
    textY,
    boxX: textX - metrics.boxWidth / 2,
    boxY: textY - metrics.boxHeight / 2,
    leader
  };
}
