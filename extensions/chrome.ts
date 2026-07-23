/**
 * Shared Grok-like chrome styling for thinking + tool title rows.
 *
 * Visual language (from Grok screenshots):
 * - Thinking / group headers: muted diamond + muted label
 * - Success tool: bright green filled diamond
 * - Failed tool: red filled diamond
 * - Labels: muted gray, not bold white
 * - Expand hints: dimmer gray suffix
 *
 * Note: pi dark theme `success` is olive `#b5bd68` (reads yellow).
 * Status dots use a true green via truecolor/256 ANSI instead.
 */

export interface ChromeTheme {
  fg(color: string, text: string): string;
  bold(text: string): string;
}

/** True green — not theme "success" (often olive/yellow). */
const STATUS_GREEN = "#4ade80";
/** Clear red for failures (slightly brighter than theme olive-reds). */
const STATUS_RED = "#f87171";

function ansiFgHex(hex: string, text: string): string {
  const h = hex.replace("#", "");
  if (h.length !== 6) return text;
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  if ([r, g, b].some((n) => Number.isNaN(n))) return text;
  // truecolor; terminals without it usually still degrade acceptably
  return `\x1b[38;2;${r};${g};${b}m${text}\x1b[39m`;
}

export type ChromeKind = "thinking" | "tool_ok" | "tool_err" | "group" | "group_err";

/** Leading glyph matching Grok diamonds. */
export function chromeGlyph(kind: ChromeKind): string {
  switch (kind) {
    case "thinking":
      return "◆";
    case "tool_ok":
      return "◆";
    case "tool_err":
      return "◆";
    case "group":
      return "◇";
    case "group_err":
      return "◇";
  }
}

export function colorGlyph(kind: ChromeKind, glyph: string, theme: ChromeTheme): string {
  switch (kind) {
    case "thinking":
    case "group":
      return theme.fg("muted", glyph);
    case "group_err":
      // hollow diamond stays muted; failure shown in label suffix
      return theme.fg("muted", glyph);
    case "tool_ok":
      return ansiFgHex(STATUS_GREEN, glyph);
    case "tool_err":
      return ansiFgHex(STATUS_RED, glyph);
  }
}

/**
 * One chrome title line:
 *   `{glyph} {label}{hint}`
 * label is muted; hint is dim; optional failedSuffix in error color.
 */
export function formatChromeLine(
  theme: ChromeTheme,
  opts: {
    kind: ChromeKind;
    label: string;
    /** e.g. " (Alt+T)" / " (Ctrl+O)" */
    hint?: string;
    /** e.g. " · 1 failed" rendered in error color */
    failedSuffix?: string;
  },
): string {
  const glyph = colorGlyph(opts.kind, chromeGlyph(opts.kind), theme);
  // Same weight/color family for thinking + tools (no bold white titles)
  const label = theme.fg("muted", opts.label);
  const hint = opts.hint ? theme.fg("dim", opts.hint) : "";
  const failed = opts.failedSuffix
    ? theme.fg("error", opts.failedSuffix)
    : "";
  return `${glyph} ${label}${failed}${hint}`;
}
