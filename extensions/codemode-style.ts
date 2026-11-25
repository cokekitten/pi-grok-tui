/**
 * Pure formatting, lenient partial-JSON parsing, and 3-level display state
 * resolution for Pi 1.5+ `codemode` tool calls.
 *
 * Kept free of TUI widget imports so node:test can run unit tests directly.
 */
import { homedir } from "node:os";
import { ansiFgHex, safeFg, type ChromeKind, type ChromeTheme } from "./chrome.js";
import type { ToolViewMode } from "./state.js";
import { flattenOneLine, formatToolTitle, verbKindForTool } from "./tool-titles.js";

export const CODEMODE_TOOL_NAME = "codemode";
export const COMPACT_CALL_PREVIEW_COUNT = 8;

const STATUS_GREEN = "#4ade80";
const STATUS_RED = "#f87171";

const CODE_PREVIEW_MAX_CHARS = 56;
const EXTRA_PREVIEW_MAX_CHARS = 48;
const COMPACT_ERROR_MAX_CHARS = 56;
const SCRIPT_ERROR_MAX_CHARS = 72;

const SCRIPT_HEADER_RE = /^Script (?:completed|failed)\nWall time [\d.]+ seconds\nOutput:\n$/;
const CALL_SUMMARY_FOOTER_RE =
  /\n\n(?:Tool calls made before the failure \(they are not undone\):[\s\S]*|No tool calls were made\.|The script did not start\.)$/;

export type CodemodeCallStatus = "running" | "ok" | "error" | "cancelled";
export type CodemodeDisplayLevel = "collapsed" | "calls" | "full";

export interface CodemodeNestedCallLike {
  id?: string;
  name: string;
  args?: string;
  status: CodemodeCallStatus;
  durationMs?: number;
  error?: string;
  cost?: number;
}

export interface CodemodeChromeSummary {
  kind: ChromeKind;
  label: string;
  failedSuffix?: string;
  calls: CodemodeNestedCallLike[];
  autoTree: boolean;
  scriptError?: string;
}

type CodemodeVerbKind =
  | "read"
  | "write"
  | "edit"
  | "search"
  | "dir"
  | "web_fetch"
  | "web_search"
  | "command"
  | "todo"
  | "classify"
  | "image"
  | "mcp"
  | "other";

export function isCodemodeTool(toolName: string): boolean {
  return toolName === CODEMODE_TOOL_NAME;
}

function normalizeStatus(status: unknown): CodemodeCallStatus {
  if (
    status === "running" ||
    status === "ok" ||
    status === "error" ||
    status === "cancelled"
  ) {
    return status;
  }
  return "ok";
}

export function extractCodemodeCalls(details: unknown): CodemodeNestedCallLike[] {
  if (!details || typeof details !== "object") return [];
  const raw = (details as { calls?: unknown }).calls;
  if (!Array.isArray(raw)) return [];
  const out: CodemodeNestedCallLike[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const rec = item as Record<string, unknown>;
    if (typeof rec.name !== "string" || rec.name.length === 0) continue;
    out.push({
      id: typeof rec.id === "string" ? rec.id : undefined,
      name: rec.name,
      args: typeof rec.args === "string" ? rec.args : "",
      status: normalizeStatus(rec.status),
      durationMs:
        typeof rec.durationMs === "number" && Number.isFinite(rec.durationMs)
          ? rec.durationMs
          : undefined,
      error: typeof rec.error === "string" && rec.error.length > 0 ? rec.error : undefined,
      cost:
        typeof rec.cost === "number" && Number.isFinite(rec.cost)
          ? rec.cost
          : undefined,
    });
  }
  return out;
}

function truncateCodePoints(s: string, max: number): string {
  const flat = flattenOneLine(s);
  const cps = [...flat];
  if (cps.length <= max) return flat;
  return cps.slice(0, Math.max(1, max - 1)).join("") + "…";
}

function readJsonString(
  s: string,
  startQuote: number,
): { value: string; next: number; closed: boolean } {
  let out = "";
  let i = startQuote + 1;
  while (i < s.length) {
    const ch = s[i]!;
    if (ch === '"') {
      return { value: out, next: i + 1, closed: true };
    }
    if (ch === "\\") {
      if (i + 1 >= s.length) break;
      const esc = s[i + 1]!;
      switch (esc) {
        case '"':
        case "\\":
        case "/":
          out += esc;
          i += 2;
          break;
        case "n":
          out += "\n";
          i += 2;
          break;
        case "r":
          out += "\r";
          i += 2;
          break;
        case "t":
          out += "\t";
          i += 2;
          break;
        case "b":
          out += "\b";
          i += 2;
          break;
        case "f":
          out += "\f";
          i += 2;
          break;
        case "u": {
          const hex = s.slice(i + 2, i + 6);
          if (/^[0-9a-fA-F]{4}$/.test(hex)) {
            out += String.fromCharCode(Number.parseInt(hex, 16));
            i += 6;
          } else {
            return { value: out, next: s.length, closed: false };
          }
          break;
        }
        default:
          out += esc;
          i += 2;
          break;
      }
      continue;
    }
    out += ch;
    i += 1;
  }
  return { value: out, next: s.length, closed: false };
}

function skipBalancedContainer(s: string, start: number): number {
  let depth = 0;
  let i = start;
  while (i < s.length) {
    const ch = s[i]!;
    if (ch === '"') {
      const strRes = readJsonString(s, i);
      i = strRes.next;
      if (!strRes.closed) return s.length;
      continue;
    }
    if (ch === "{" || ch === "[") {
      depth += 1;
    } else if (ch === "}" || ch === "]") {
      depth -= 1;
      if (depth <= 0) return i + 1;
    }
    i += 1;
  }
  return s.length;
}

/**
 * Parse `CodemodeNestedCall.args`, which Pi truncates to 200 chars (`...`).
 * Returns `undefined` for non-object inputs (such as `models.*` `"provider/id"`).
 */
export function parseLenientJsonRecord(
  raw: string | undefined,
): Record<string, unknown> | undefined {
  if (raw === undefined) return {};
  const trimmed = raw.trim();
  if (!trimmed) return {};

  try {
    const parsed = JSON.parse(trimmed);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    return undefined;
  } catch {
    /* fall through to truncated-object scanner */
  }

  if (!trimmed.startsWith("{")) return undefined;

  const hadEllipsis = trimmed.endsWith("...");
  const s = hadEllipsis ? trimmed.slice(0, -3) : trimmed;
  const record: Record<string, unknown> = {};
  let i = 1;

  const skipWs = () => {
    while (i < s.length && /\s/.test(s[i]!)) i += 1;
  };

  while (i < s.length) {
    skipWs();
    while (i < s.length && s[i] === ",") {
      i += 1;
      skipWs();
    }
    if (i >= s.length || s[i] === "}") break;
    if (s[i] !== '"') break;

    const keyRes = readJsonString(s, i);
    i = keyRes.next;
    if (!keyRes.closed) break;

    skipWs();
    if (i >= s.length || s[i] !== ":") break;
    i += 1;
    skipWs();
    if (i >= s.length) break;

    const ch = s[i]!;
    if (ch === '"') {
      const valRes = readJsonString(s, i);
      i = valRes.next;
      let val = valRes.value;
      if (!valRes.closed && val.length > 0 && !val.endsWith("…")) {
        val += "…";
      }
      record[keyRes.value] = val;
      if (!valRes.closed) break;
    } else if (ch === "{" || ch === "[") {
      i = skipBalancedContainer(s, i);
    } else if (s.startsWith("true", i)) {
      record[keyRes.value] = true;
      i += 4;
    } else if (s.startsWith("false", i)) {
      record[keyRes.value] = false;
      i += 5;
    } else if (s.startsWith("null", i)) {
      record[keyRes.value] = null;
      i += 4;
    } else if (ch === "-" || (ch >= "0" && ch <= "9")) {
      const m = /^-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/.exec(s.slice(i));
      if (!m) break;
      const n = Number(m[0]);
      if (Number.isFinite(n)) record[keyRes.value] = n;
      i += m[0].length;
    } else {
      break;
    }
  }

  return record;
}

export function shortenPathForDisplay(
  p: string,
  cwd?: string,
  home?: string,
): string {
  if (!p || !p.startsWith("/")) return p;
  if (cwd) {
    const cleanCwd = cwd.length > 1 ? cwd.replace(/\/+$/, "") : cwd;
    if (p === cleanCwd) return ".";
    if (cleanCwd !== "/" && p.startsWith(cleanCwd + "/")) {
      return p.slice(cleanCwd.length + 1);
    }
  }
  const resolvedHome = home ?? safeHomedir();
  if (resolvedHome && resolvedHome.length > 1) {
    const cleanHome = resolvedHome.replace(/\/+$/, "");
    if (p === cleanHome) return "~";
    if (p.startsWith(cleanHome + "/")) {
      return "~/" + p.slice(cleanHome.length + 1);
    }
  }
  return p;
}

function safeHomedir(): string | undefined {
  try {
    return homedir();
  } catch {
    return undefined;
  }
}

function titleCaseName(name: string): string {
  if (!name) return "Tool";
  const base = name.includes("__") ? name.split("__").pop()! : name;
  return base
    .split(/[-_.]/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function strVal(v: unknown): string | undefined {
  if (typeof v === "string" && v.length > 0) return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  return undefined;
}

export function formatCodemodeCallTitle(
  call: CodemodeNestedCallLike,
  opts?: { cwd?: string; home?: string },
): string {
  const name = call.name || "tool";
  const rawArgs = (call.args ?? "").trim();

  if (name === "models.classify") {
    return rawArgs
      ? `Classify \`${truncateCodePoints(rawArgs, EXTRA_PREVIEW_MAX_CHARS)}\``
      : "Classify";
  }
  if (name === "models.generateImages") {
    return rawArgs
      ? `Generate Image \`${truncateCodePoints(rawArgs, EXTRA_PREVIEW_MAX_CHARS)}\``
      : "Generate Image";
  }
  if (name.startsWith("models.")) {
    const sub = titleCaseName(name.slice("models.".length));
    return rawArgs
      ? `${sub} \`${truncateCodePoints(rawArgs, EXTRA_PREVIEW_MAX_CHARS)}\``
      : sub;
  }

  const parsed = parseLenientJsonRecord(rawArgs) ?? {};
  const normalized: Record<string, unknown> = { ...parsed };
  for (const key of ["path", "file_path", "target_file"]) {
    if (typeof normalized[key] === "string") {
      normalized[key] = shortenPathForDisplay(
        normalized[key] as string,
        opts?.cwd,
        opts?.home,
      );
    }
  }

  const base = formatToolTitle(name, normalized, { cwd: opts?.cwd });
  // If formatToolTitle fell back to bare titleCase because the tool uses a
  // domain-specific key (target/claim/match/agent/id/action), attach that preview.
  if (!base.includes("`")) {
    const extra =
      strVal(normalized.target) ??
      strVal(normalized.claim) ??
      strVal(normalized.match) ??
      strVal(normalized.agent) ??
      strVal(normalized.id) ??
      strVal(normalized.action);
    if (extra) {
      return `${base} \`${truncateCodePoints(extra.replace(/`/g, "'"), EXTRA_PREVIEW_MAX_CHARS)}\``;
    }
  }
  return base;
}

function codemodeVerbKind(toolName: string): CodemodeVerbKind {
  const lower = toolName.toLowerCase();
  if (lower === "read") return "read";
  if (lower === "write") return "write";
  if (lower === "edit") return "edit";
  if (lower === "models.classify") return "classify";
  if (lower === "models.generateimages") return "image";
  const mapped = verbKindForTool(toolName);
  switch (mapped) {
    case "file":
      return "read";
    case "search":
      return "search";
    case "dir":
      return "dir";
    case "web_fetch":
      return "web_fetch";
    case "web_search":
      return "web_search";
    case "command":
      return "command";
    case "todo":
      return "todo";
    case "mcp":
      return "mcp";
    case "other":
      return "other";
  }
}

function formatVerbBucket(kind: CodemodeVerbKind, count: number): string {
  const table: Record<CodemodeVerbKind, [string, string, string]> = {
    read: ["Read", "file", "files"],
    write: ["Wrote", "file", "files"],
    edit: ["Edited", "file", "files"],
    search: ["Searched", "pattern", "patterns"],
    dir: ["Listed", "dir", "dirs"],
    web_fetch: ["Fetched", "website", "websites"],
    web_search: ["Searched", "website", "websites"],
    command: ["Ran", "command", "commands"],
    todo: ["Updated", "todo", "todos"],
    classify: ["Classified", "item", "items"],
    image: ["Generated", "image", "images"],
    mcp: ["Called", "MCP tool", "MCP tools"],
    other: ["Ran", "tool", "tools"],
  };
  const [verb, one, many] = table[kind];
  return `${verb} ${count} ${count === 1 ? one : many}`;
}

export function formatCodemodeGroupSummary(
  calls: readonly CodemodeNestedCallLike[],
  opts?: { running?: boolean },
): string {
  if (calls.length === 0) return "Codemode";
  const buckets: { kind: CodemodeVerbKind; count: number }[] = [];
  let done = 0;
  for (const call of calls) {
    const kind = codemodeVerbKind(call.name);
    const existing = buckets.find((b) => b.kind === kind);
    if (existing) existing.count += 1;
    else buckets.push({ kind, count: 1 });
    if (call.status !== "running") done += 1;
  }
  const base = buckets.map((b) => formatVerbBucket(b.kind, b.count)).join(", ");
  if (opts?.running && calls.length >= 1) {
    return `${base} (${done}/${calls.length})`;
  }
  return base;
}

export function extractCodePreviewStatement(code: unknown): string | undefined {
  if (typeof code !== "string" || !code.trim()) return undefined;
  let rest = code.replace(/\r\n?/g, "\n");

  while (rest.length > 0) {
    rest = rest.trimStart();
    if (rest.startsWith("//")) {
      const nl = rest.indexOf("\n");
      if (nl < 0) return undefined;
      rest = rest.slice(nl + 1);
      continue;
    }
    if (rest.startsWith("/*")) {
      const end = rest.indexOf("*/", 2);
      if (end < 0) return undefined;
      rest = rest.slice(end + 2);
      continue;
    }
    break;
  }

  const firstLine = (rest.split("\n")[0] ?? "").trim();
  if (!firstLine) return undefined;
  const sanitized = firstLine.replace(/`/g, "'");
  return truncateCodePoints(sanitized, CODE_PREVIEW_MAX_CHARS);
}

export function extractCodemodeScriptError(
  result: { content?: unknown; isError?: boolean } | undefined,
): string | undefined {
  if (!result || !result.isError) return undefined;
  const content = result.content;
  if (!Array.isArray(content)) return undefined;

  const textBlocks: string[] = [];
  for (const item of content) {
    if (
      item &&
      typeof item === "object" &&
      (item as { type?: unknown }).type === "text" &&
      typeof (item as { text?: unknown }).text === "string"
    ) {
      textBlocks.push((item as { text: string }).text);
    }
  }
  if (textBlocks.length === 0) return undefined;

  const bodyBlocks =
    textBlocks.length > 0 && SCRIPT_HEADER_RE.test(textBlocks[0]!)
      ? textBlocks.slice(1)
      : textBlocks;
  const combined = bodyBlocks.join("\n").trim();
  if (!combined) return undefined;

  const marker = "Script error:\n";
  const markerIdx = combined.lastIndexOf(marker);
  const rawErr =
    markerIdx >= 0 ? combined.slice(markerIdx + marker.length) : combined;
  const cleaned = rawErr.replace(CALL_SUMMARY_FOOTER_RE, "").trim();
  return cleaned || undefined;
}

export function isCodemodeAutoTree(
  calls: readonly CodemodeNestedCallLike[],
  opts: { running: boolean; inUnclosedTurn?: boolean; isError?: boolean },
): boolean {
  if (opts.running) return true;
  if (opts.inUnclosedTurn) {
    // A failed nested call can occur in an otherwise successful script.
    return opts.isError === true || calls.length >= 2 || calls.some((call) => call.status === "error");
  }
  return false;
}

export function resolveCodemodeDisplay(opts: {
  globalMode: ToolViewMode;
  override: ToolViewMode | undefined;
  autoTree: boolean;
}): { level: CodemodeDisplayLevel; autoCompact: boolean } {
  if (opts.override !== undefined) {
    const level: CodemodeDisplayLevel =
      opts.override === "chrome"
        ? "collapsed"
        : opts.override === "truncated"
          ? "calls"
          : "full";
    return { level, autoCompact: false };
  }
  if (opts.globalMode === "full") return { level: "full", autoCompact: false };
  if (opts.globalMode === "truncated") return { level: "calls", autoCompact: false };
  return opts.autoTree
    ? { level: "calls", autoCompact: true }
    : { level: "collapsed", autoCompact: false };
}

export function summarizeCodemodeChrome(
  args: unknown,
  result: { content?: unknown; details?: unknown; isError?: boolean } | undefined,
  opts: { running: boolean; inUnclosedTurn?: boolean; cwd?: string; home?: string },
): CodemodeChromeSummary {
  const calls = extractCodemodeCalls(result?.details);
  const isError = !opts.running && result?.isError === true;
  const failedCalls = calls.filter((c) => c.status === "error").length;
  const anyError = failedCalls > 0 || isError;
  const autoTree = isCodemodeAutoTree(calls, {
    running: opts.running,
    inUnclosedTurn: opts.inUnclosedTurn,
    isError,
  });
  const scriptError = isError ? extractCodemodeScriptError(result) : undefined;

  if (calls.length >= 2 || (opts.running && calls.length === 1)) {
    const kind: ChromeKind = anyError ? "group_err" : "group";
    const label = formatCodemodeGroupSummary(calls, { running: opts.running });
    const failedSuffix =
      failedCalls > 0
        ? ` · ${failedCalls} failed`
        : isError
          ? " · script failed"
          : undefined;
    return { kind, label, failedSuffix, calls, autoTree, scriptError };
  }

  if (calls.length === 1) {
    const call = calls[0]!;
    const callRunning = opts.running || call.status === "running";
    const kind: ChromeKind =
      failedCalls > 0 || isError
        ? "tool_err"
        : callRunning
          ? "tool_run"
          : "tool_ok";
    const label = formatCodemodeCallTitle(call, {
      cwd: opts.cwd,
      home: opts.home,
    });
    const failedSuffix =
      failedCalls > 0
        ? " · 1 failed"
        : isError
          ? " · script failed"
          : undefined;
    return { kind, label, failedSuffix, calls, autoTree, scriptError };
  }

  const code =
    args && typeof args === "object"
      ? (args as { code?: unknown }).code
      : undefined;
  const stmt = extractCodePreviewStatement(code);
  const label = stmt ? `Script \`${stmt}\`` : "Codemode";
  const kind: ChromeKind = isError
    ? "tool_err"
    : opts.running
      ? "tool_run"
      : "tool_ok";
  const failedSuffix = isError ? " · script failed" : undefined;
  return { kind, label, failedSuffix, calls, autoTree, scriptError };
}

function formatDurationMs(ms: number | undefined): string {
  if (ms === undefined || !Number.isFinite(ms) || ms < 0) return "";
  return ms < 1000 ? `${Math.round(ms)}ms` : `${(ms / 1000).toFixed(1)}s`;
}

function formatModelCost(cost: number | undefined): string {
  if (cost === undefined || !Number.isFinite(cost) || cost <= 0) return "";
  return `$${cost >= 0.01 ? cost.toFixed(2) : cost.toPrecision(2)}`;
}

function callStatusGlyph(status: CodemodeCallStatus, theme: ChromeTheme): string {
  switch (status) {
    case "running":
      return safeFg(theme, "warning", "…");
    case "ok":
      return ansiFgHex(STATUS_GREEN, "✓");
    case "error":
      return ansiFgHex(STATUS_RED, "✗");
    case "cancelled":
      return safeFg(theme, "muted", "⊘");
  }
}

function shouldShowTrailingScriptError(
  calls: readonly CodemodeNestedCallLike[],
  scriptError: string | undefined,
  opts: { isError?: boolean; running?: boolean },
): boolean {
  if (opts.running || !opts.isError || !scriptError) return false;
  const erroredCalls = calls.filter((c) => c.status === "error");
  if (erroredCalls.length === 0) return true;
  const scriptFirst = flattenOneLine(scriptError.split("\n")[0] ?? "");
  if (!scriptFirst) return false;
  return !erroredCalls.some((c) => {
    const callFirst = flattenOneLine((c.error ?? "").split("\n")[0] ?? "");
    return (
      callFirst.length > 0 &&
      (scriptFirst.includes(callFirst) || callFirst.includes(scriptFirst))
    );
  });
}

export function formatCodemodeTreeLines(
  theme: ChromeTheme,
  calls: readonly CodemodeNestedCallLike[],
  opts: {
    autoCompact: boolean;
    cwd?: string;
    home?: string;
    scriptError?: string;
    isError?: boolean;
    running?: boolean;
  },
): string[] {
  const showScriptErr = shouldShowTrailingScriptError(calls, opts.scriptError, opts);
  const shown =
    opts.autoCompact && calls.length > COMPACT_CALL_PREVIEW_COUNT
      ? calls.slice(-COMPACT_CALL_PREVIEW_COUNT)
      : calls;
  const hiddenCount = calls.length - shown.length;

  const lines: string[] = [];
  if (hiddenCount > 0) {
    lines.push(
      `${safeFg(theme, "dim", "├─ ")}${safeFg(theme, "dim", `… +${hiddenCount} earlier calls`)}`,
    );
  }

  for (let idx = 0; idx < shown.length; idx++) {
    const call = shown[idx]!;
    const isLast = idx === shown.length - 1 && !showScriptErr;
    const branch = safeFg(theme, "dim", isLast ? "└─ " : "├─ ");
    const icon = callStatusGlyph(call.status, theme);
    const title = safeFg(
      theme,
      "muted",
      formatCodemodeCallTitle(call, { cwd: opts.cwd, home: opts.home }),
    );
    const dur = formatDurationMs(call.durationMs);
    const cost = formatModelCost(call.cost);
    const metaParts = [dur, cost].filter(Boolean);
    const meta = metaParts.length > 0 ? ` ${safeFg(theme, "dim", metaParts.join(" "))}` : "";

    let inlineErr = "";
    if (opts.autoCompact && call.status === "error" && call.error) {
      const firstErr = (call.error.split("\n")[0] ?? "").trim();
      if (firstErr) {
        inlineErr = safeFg(
          theme,
          "error",
          ` — ${truncateCodePoints(firstErr, COMPACT_ERROR_MAX_CHARS)}`,
        );
      }
    }

    lines.push(`${branch}${icon} ${title}${meta}${inlineErr}`);

    if (!opts.autoCompact && call.status === "error" && call.error) {
      const rail = safeFg(theme, "dim", isLast ? "   " : "│  ");
      for (const errLine of call.error.split("\n")) {
        const trimmedErr = errLine.trimEnd();
        if (!trimmedErr) continue;
        lines.push(`${rail}  ${safeFg(theme, "error", trimmedErr)}`);
      }
    }
  }

  if (showScriptErr && opts.scriptError) {
    const errLines = opts.scriptError
      .split("\n")
      .map((l) => l.trimEnd())
      .filter(Boolean);
    if (errLines.length > 0) {
      const branch = safeFg(theme, "dim", "└─ ");
      const icon = ansiFgHex(STATUS_RED, "✗");
      const headline = opts.autoCompact
        ? truncateCodePoints(errLines[0]!, SCRIPT_ERROR_MAX_CHARS)
        : errLines[0]!;
      lines.push(`${branch}${icon} ${safeFg(theme, "error", headline)}`);
      if (!opts.autoCompact) {
        for (let i = 1; i < errLines.length; i++) {
          lines.push(`     ${safeFg(theme, "error", errLines[i]!)}`);
        }
      }
    }
  }

  if (lines.length === 0) {
    lines.push(
      `${safeFg(theme, "dim", "└─ ")}${safeFg(theme, "dim", "(no nested tool calls)")}`,
    );
  }

  return lines;
}
