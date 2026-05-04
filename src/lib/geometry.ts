import type { Point, Rect } from "../types";

const EPSILON = 0.001;

export function clamp(value: number, min: number, max: number) {
  if (Number.isNaN(value)) return min;
  return Math.min(max, Math.max(min, value));
}

export function rectArea(rect: Rect) {
  return Math.max(0, rect.width) * Math.max(0, rect.height);
}

export function rectIntersection(a: Rect, b: Rect): Rect | null {
  const x1 = Math.max(a.x, b.x);
  const y1 = Math.max(a.y, b.y);
  const x2 = Math.min(a.x + a.width, b.x + b.width);
  const y2 = Math.min(a.y + a.height, b.y + b.height);

  if (x2 <= x1 + EPSILON || y2 <= y1 + EPSILON) {
    return null;
  }

  return { x: x1, y: y1, width: x2 - x1, height: y2 - y1 };
}

export function subtractRect(base: Rect, cutter: Rect): Rect[] {
  const hit = rectIntersection(base, cutter);

  if (!hit) {
    return [base];
  }

  const right = base.x + base.width;
  const bottom = base.y + base.height;
  const hitRight = hit.x + hit.width;
  const hitBottom = hit.y + hit.height;
  const pieces: Rect[] = [];

  if (hit.y > base.y + EPSILON) {
    pieces.push({ x: base.x, y: base.y, width: base.width, height: hit.y - base.y });
  }

  if (hitBottom < bottom - EPSILON) {
    pieces.push({ x: base.x, y: hitBottom, width: base.width, height: bottom - hitBottom });
  }

  if (hit.x > base.x + EPSILON) {
    pieces.push({ x: base.x, y: hit.y, width: hit.x - base.x, height: hit.height });
  }

  if (hitRight < right - EPSILON) {
    pieces.push({ x: hitRight, y: hit.y, width: right - hitRight, height: hit.height });
  }

  return pieces.filter((piece) => rectArea(piece) > EPSILON);
}

export function subtractRects(base: Rect, cutters: Rect[]) {
  return cutters.reduce<Rect[]>((pieces, cutter) => {
    return pieces.flatMap((piece) => subtractRect(piece, cutter));
  }, [base]);
}

export function polygonArea(points: Point[]) {
  if (points.length < 3) return 0;

  const sum = points.reduce((total, point, index) => {
    const next = points[(index + 1) % points.length];
    return total + point.x * next.y - next.x * point.y;
  }, 0);

  return Math.abs(sum) / 2;
}

function signedDistance(point: Point, start: Point, end: Point) {
  return (end.x - start.x) * (point.y - start.y) - (end.y - start.y) * (point.x - start.x);
}

function lineIntersection(a: Point, b: Point, start: Point, end: Point): Point {
  const da = signedDistance(a, start, end);
  const db = signedDistance(b, start, end);
  const t = da / (da - db);
  return {
    x: a.x + (b.x - a.x) * t,
    y: a.y + (b.y - a.y) * t
  };
}

function clipPolygon(points: Point[], start: Point, end: Point, keepPositive: boolean) {
  if (!points.length) return [];

  const output: Point[] = [];

  points.forEach((current, index) => {
    const previous = points[(index + points.length - 1) % points.length];
    const currentDistance = signedDistance(current, start, end);
    const previousDistance = signedDistance(previous, start, end);
    const currentInside = keepPositive ? currentDistance >= -EPSILON : currentDistance <= EPSILON;
    const previousInside = keepPositive ? previousDistance >= -EPSILON : previousDistance <= EPSILON;

    if (currentInside !== previousInside) {
      output.push(lineIntersection(previous, current, start, end));
    }

    if (currentInside) {
      output.push(current);
    }
  });

  return output;
}

export function splitRectByLine(rect: Rect, start: Point, end: Point) {
  const polygon: Point[] = [
    { x: rect.x, y: rect.y },
    { x: rect.x + rect.width, y: rect.y },
    { x: rect.x + rect.width, y: rect.y + rect.height },
    { x: rect.x, y: rect.y + rect.height }
  ];
  const first = clipPolygon(polygon, start, end, true);
  const second = clipPolygon(polygon, start, end, false);

  return {
    polygons: [first, second] as [Point[], Point[]],
    areas: [polygonArea(first), polygonArea(second)] as [number, number],
    totalArea: polygonArea(first) + polygonArea(second)
  };
}

export function pointsToPath(points: Point[]) {
  if (!points.length) return "";
  return points.map((point, index) => `${index === 0 ? "M" : "L"} ${point.x} ${point.y}`).join(" ") + " Z";
}

export function roundTo(value: number, precision = 0.1) {
  return Math.round(value / precision) * precision;
}

export function nearlyEqual(a: number, b: number, tolerance = 0.01) {
  return Math.abs(a - b) <= tolerance;
}
