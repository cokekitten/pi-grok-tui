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
 *
 * All theme.fg access is fail-soft so a missing color token never throws
 * during resume rebuild (which used to fall back to native red error UI).
 */

export interface ChromeTheme {
  fg(color: string, text: string): string;
  bold?(text: string): string;
}

/** True green — not theme "success" (often olive/yellow). */
const STATUS_GREEN = "#4ade80";
/** Clear red for failures. */
const STATUS_RED = "#f87171";
/**
 * Expanded body text — quieter than theme `dim` (#666) and `muted` (#808).
 * Titles stay on muted; body uses this so content sits further back.
 */
const BODY_FG = "#4a4a4a";

function parseHexRgb(hex: string): { r: number; g: number; b: number } | null {
  const h = hex.replace("#", "");
  if (h.length !== 6) return null;
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  if ([r, g, b].some((n) => Number.isNaN(n))) return null;
  return { r, g, b };
}

/** Truecolor foreground. */
export function ansiFgHex(hex: string, text: string): string {
  const rgb = parseHexRgb(hex);
  if (!rgb) return text;
  return `\x1b[38;2;${rgb.r};${rgb.g};${rgb.b}m${text}\x1b[39m`;
}

/**
 * Truecolor background applied per character (keeps existing fg ANSI).
 * Used for user-message blocks where we override theme.bg tokens.
 */
export function ansiBgHex(hex: string, text: string): string {
  const rgb = parseHexRgb(hex);
  if (!rgb) return text;
  // Reset bg at end; leave fg as-is for nested styles inside the line.
  return `\x1b[48;2;${rgb.r};${rgb.g};${rgb.b}m${text}\x1b[49m`;
}

/** Safe theme.fg — never throws. */
export function safeFg(
  theme: ChromeTheme | null | undefined,
  color: string,
  text: string,
): string {
  if (!theme || typeof theme.fg !== "function") return text;
  try {
    return theme.fg(color, text);
  } catch {
    return text;
  }
}

/** Dimmer-than-title body/expanded content color. */
export function bodyFg(text: string): string {
  return ansiFgHex(BODY_FG, text);
}

/**
 * Left indent for assistant / tool / thinking rows so they line up with the
 * user-message ❯ column (user bubble uses outputPad + "❯ ").
 * 2 cells ≈ arrow + space; keeps response chrome off the terminal gutter.
 */
export const RESPONSE_LEFT_PAD = 2;

/** Prefix every line with RESPONSE_LEFT_PAD spaces (ANSI-safe: spaces first). */
export function indentResponseLines(lines: string[], pad = RESPONSE_LEFT_PAD): string[] {
  if (pad <= 0 || lines.length === 0) return lines;
  const sp = " ".repeat(pad);
  return lines.map((line) => sp + line);
}

export function responsePadString(pad = RESPONSE_LEFT_PAD): string {
  return pad > 0 ? " ".repeat(pad) : "";
}

export type ChromeKind =
  | "thinking"
  | "tool_run"
  | "tool_ok"
  | "tool_err"
  | "group"
  | "group_err";

/** Leading glyph matching Grok diamonds. */
export function chromeGlyph(kind: ChromeKind): string {
  switch (kind) {
    case "thinking":
    case "tool_run":
    case "tool_ok":
    case "tool_err":
      return "◆";
    case "group":
    case "group_err":
      return "◇";
  }
}

export function colorGlyph(
  kind: ChromeKind,
  glyph: string,
  theme: ChromeTheme,
): string {
  switch (kind) {
    case "thinking":
    case "tool_run":
    case "group":
    case "group_err":
      return safeFg(theme, "muted", glyph);
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
  try {
    const glyph = colorGlyph(opts.kind, chromeGlyph(opts.kind), theme);
    const label = safeFg(theme, "muted", opts.label);
    const hint = opts.hint ? safeFg(theme, "dim", opts.hint) : "";
    const failed = opts.failedSuffix
      ? safeFg(theme, "error", opts.failedSuffix)
      : "";
    return `${glyph} ${label}${failed}${hint}`;
  } catch {
    // Absolute last resort — plain text, never throw into resume rebuild.
    return `◆ ${opts.label}${opts.failedSuffix ?? ""}${opts.hint ?? ""}`;
  }
}
