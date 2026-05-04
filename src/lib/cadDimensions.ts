export type DimensionArrowDirection = "up" | "down" | "left" | "right";

export function dimensionArrowPoints(
  x: number,
  y: number,
  direction: DimensionArrowDirection,
  size = 60
) {
  const half = size * 0.4;
  const points: Record<DimensionArrowDirection, string> = {
    right: `${x},${y} ${x - size},${y - half} ${x - size},${y + half}`,
    left: `${x},${y} ${x + size},${y - half} ${x + size},${y + half}`,
    down: `${x},${y} ${x - half},${y - size} ${x + half},${y - size}`,
    up: `${x},${y} ${x - half},${y + size} ${x + half},${y + size}`
  };

  return points[direction];
}
