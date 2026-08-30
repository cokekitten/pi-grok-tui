/**
 * Pure jump-to-bottom pill helpers (placement + bounded hit spans).
 * No TUI imports besides visibleWidth so node:test can load this without a session.
 */
import { visibleWidth } from "@earendil-works/pi-tui";

export const JUMP_BOTTOM_ID = "jump-bottom";
export const JUMP_BOTTOM_TEXT = " Jump to bottom (click) ↓ ";

const HIT_MARKER_RE =
  /\x1b\]9999;pi-grok-tui\/v1\/hit\/([A-Za-z0-9:_-]+)\/(\d+)\x07/;

export type JumpBottomPlacement = {
  startCol: number;
  width: number;
};

export type HitSpan = {
  id: string;
  startCol: number;
  width: number;
};

export function jumpBottomPlacement(
  viewportX: number,
  viewportWidth: number,
): JumpBottomPlacement | undefined {
  if (!Number.isFinite(viewportX) || !Number.isFinite(viewportWidth)) {
    return undefined;
  }
  const x = Math.floor(viewportX);
  const vw = Math.floor(viewportWidth);
  const width = visibleWidth(JUMP_BOTTOM_TEXT);
  if (vw < width || width <= 0) return undefined;
  return {
    startCol: x + Math.floor((vw - width) / 2),
    width,
  };
}

export function hitSpanMarker(id: string, width: number): string {
  return `\x1b]9999;pi-grok-tui/v1/hit/${id}/${width}\x07`;
}

export function parseHitSpan(line: string): HitSpan | undefined {
  if (typeof line !== "string") return undefined;
  const m = HIT_MARKER_RE.exec(line);
  if (!m || m.index == null) return undefined;
  const id = m[1];
  const width = Number.parseInt(m[2] ?? "", 10);
  if (!id || !Number.isFinite(width) || width <= 0) return undefined;
  const startCol = visibleWidth(line.slice(0, m.index));
  return { id, startCol, width };
}

export function isHitAt(span: HitSpan | undefined, x: number): boolean {
  if (!span || !Number.isFinite(x)) return false;
  return x >= span.startCol && x < span.startCol + span.width;
}
