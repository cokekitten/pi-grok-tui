/**
 * Prompt-jump float — pure helpers.
 *
 * The float strip shows the most recent user message whose first row is
 * above the fullscreen transcript viewport top. User-message rows are the
 * OSC 133 prompt-start rows (`^\x1b\]133;A`), the same marker pi's own
 * `tui.altScreen.previousPrompt` (scrollToPrompt) scans.
 */
import { stripTerminalSequences, truncateToWidth } from "@earendil-works/pi-tui";

/** Prompt start at line start only (BEL or ST terminated). */
export const PROMPT_ROW_RE = /^\x1b\]133;A(?:\x07|\x1b\\)/;

/** Leading OSC 133 zone marks (A/B/C in any combination). */
const ZONE_PREFIX_RE = /^(?:\x1b\]133;[ABC](?:\x07|\x1b\\))+/;

/** Row indices of user-message (prompt-start) rows, ascending. */
export function findPromptRows(lines: readonly string[]): number[] {
  const rows: number[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (PROMPT_ROW_RE.test(lines[i] ?? "")) rows.push(i);
  }
  return rows;
}

/**
 * The float target: the largest prompt row strictly above `scrollTop`.
 * After a jump to row R, scrollTop === R, so this yields the message
 * before R — the strip keeps stepping upward.
 */
export function pickFloatTarget(
  promptRows: readonly number[],
  scrollTop: number,
): number | undefined {
  if (!Number.isFinite(scrollTop) || scrollTop <= 0) return undefined;
  let target: number | undefined;
  for (const row of promptRows) {
    if (row < scrollTop && (target === undefined || row > target)) target = row;
  }
  return target;
}

/** One-line plain-text preview of a rendered prompt row (keeps the `❯`). */
export function formatStrip(rawRow: string, width: number): string {
  if (typeof rawRow !== "string" || !Number.isFinite(width) || width <= 0) {
    return "";
  }
  const text = stripTerminalSequences(rawRow.replace(ZONE_PREFIX_RE, "")).trim();
  if (!text) return "";
  // truncateToWidth may inject reset codes around the ellipsis; the input is
  // plain text, so strip again for a clean preview.
  return stripTerminalSequences(
    truncateToWidth(text, Math.max(1, width), "\u2026"),
  );
}
