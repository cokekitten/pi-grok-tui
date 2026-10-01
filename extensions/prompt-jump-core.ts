/** User-only transcript anchors and one-line previews (display-only). */
import { stripTerminalSequences, truncateToWidth } from "@earendil-works/pi-tui";

// OSC 133 is not a role marker: pi also emits it for assistant messages, and
// puts it on the empty top padding. Keep it intact for native prompt navigation
// and add our own bounded user-only anchor to the rendered component rows.
const USER_START = "\x1b]9999;pi-grok-tui/v1/user-start\x07";
const USER_END = "\x1b]9999;pi-grok-tui/v1/user-end\x07";

/** Copy rather than mutate pi's render cache. Row counts/widths stay unchanged. */
export function markUserMessageRows(lines: readonly string[]): string[] {
  if (lines.length === 0) return [];
  const marked = [...lines];
  if (!marked[0].includes(USER_START)) marked[0] += USER_START;
  const last = marked.length - 1;
  if (!marked[last].includes(USER_END)) marked[last] += USER_END;
  return marked;
}

export type UserMessageTarget = { row: number; preview: string };

/**
 * Nearest user block strictly above the viewport. Jump to its top padding;
 * the new strip replaces that empty row, leaving the message text below it.
 * Read the preview inside this block only, never from a later assistant/tool.
 */
export function findUserMessageTarget(
  lines: readonly string[],
  scrollTop: number,
): UserMessageTarget | undefined {
  if (!Number.isFinite(scrollTop) || scrollTop <= 0) return undefined;
  for (let row = Math.min(lines.length - 1, Math.ceil(scrollTop) - 1); row >= 0; row--) {
    if (!lines[row].includes(USER_START)) continue;
    for (let bodyRow = row; bodyRow < lines.length; bodyRow++) {
      const raw = lines[bodyRow];
      if (bodyRow > row && raw.includes(USER_START)) break;
      const preview = stripTerminalSequences(raw).trim();
      if (preview) return { row, preview };
      if (raw.includes(USER_END)) break;
    }
    // An empty user message still belongs to this block; don't borrow another
    // message's text or pretend the previous user was the nearest one.
    return undefined;
  }
  return undefined;
}

/** Terminal-column-aware preview; never leak ANSI/OSC from the source row. */
export function formatStrip(rawRow: string, width: number): string {
  if (typeof rawRow !== "string" || !Number.isFinite(width) || width <= 0) return "";
  const text = stripTerminalSequences(rawRow).trim();
  if (!text) return "";
  // truncateToWidth injects reset codes around the ellipsis, even for plain text.
  return stripTerminalSequences(truncateToWidth(text, Math.floor(width), "…"));
}
