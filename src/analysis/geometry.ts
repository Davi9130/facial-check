import type { FaceImageSize, FacePoint } from "../types/face.types";

/** 2D point in pixels. Analysis works in pixels so non-square frames don't distort distances. */
export interface Vec2 {
  readonly x: number;
  readonly y: number;
}

export function toPixels(point: FacePoint, size: FaceImageSize): Vec2 {
  return { x: point.x * size.width, y: point.y * size.height };
}

export function pointsToPixels(points: readonly FacePoint[], size: FaceImageSize): Vec2[] {
  return points.map((p) => toPixels(p, size));
}

export function distance(a: Vec2, b: Vec2): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export function midpoint(a: Vec2, b: Vec2): Vec2 {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

export function centroid(points: readonly Vec2[]): Vec2 {
  let x = 0;
  let y = 0;
  for (const p of points) {
    x += p.x;
    y += p.y;
  }
  return { x: x / points.length, y: y / points.length };
}

export function subtract(a: Vec2, b: Vec2): Vec2 {
  return { x: a.x - b.x, y: a.y - b.y };
}

export function dot(a: Vec2, b: Vec2): number {
  return a.x * b.x + a.y * b.y;
}

export function clamp(value: number, min = 0, max = 1): number {
  return Math.min(max, Math.max(min, value));
}

export function radToDeg(rad: number): number {
  return (rad * 180) / Math.PI;
}

/** Reads a blendshape, returning `undefined` when it is missing or not a finite number. */
export function blendshape(shapes: Readonly<Record<string, number>> | undefined, key: string): number | undefined {
  const value = shapes?.[key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}
