/**
 * Grok-style rule templates for collapsed tool titles (display-only).
 * Pure helpers — no TUI imports so they can be unit-tested with node:test.
 */

/** Tools that never collapse to grok title-only chrome (native body stays). */
const ALWAYS_EXPANDED_TOOLS = new Set(["edit", "write"]);

/** Max code-point length for a single-line title body. */
const MAX_COMMAND_DISPLAY_CHARS = 72;

export type VerbKind =
  | "file"
  | "search"
  | "dir"
  | "web_fetch"
  | "web_search"
  | "command"
  | "todo"
  | "mcp"
  | "other";

export function isCollapsibleTool(toolName: string): boolean {
  return !ALWAYS_EXPANDED_TOOLS.has(toolName);
}

function asRecord(args: unknown): Record<string, unknown> {
  if (args && typeof args === "object" && !Array.isArray(args)) {
    return args as Record<string, unknown>;
  }
  return {};
}

function str(value: unknown): string | undefined {
  if (typeof value === "string" && value.length > 0) return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return undefined;
}

/** Collapse all whitespace (incl. newlines) to single spaces — keeps titles one line. */
export function flattenOneLine(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

function truncateChars(s: string, max: number): string {
  const flat = flattenOneLine(s);
  if ([...flat].length <= max) return flat;
  return [...flat].slice(0, Math.max(1, max - 1)).join("") + "…";
}

/**
 * Peel a leading `cd <cwd> &&` / `;` when the path matches session cwd (lexical).
 * Fail-closed on relative paths, mismatch, or ambiguous forms.
 */
export function stripRedundantSessionCd(command: string, cwd?: string): string {
  if (!cwd || !cwd.trim()) return command;
  const trimmed = command.trimStart();
  const m = trimmed.match(
    /^cd\s+(?:\/d\s+)?("([^"]+)"|'([^']+)'|(\S+))\s*(?:&&|;)\s*([\s\S]+)$/i,
  );
  if (!m) return command;
  const pathToken = (m[2] ?? m[3] ?? m[4] ?? "").replace(/\/+$/, "");
  const remainder = (m[5] ?? "").trim();
  if (!remainder) return command;
  const absolute =
    pathToken.startsWith("/") ||
    /^[A-Za-z]:[\\/]/.test(pathToken) ||
    pathToken.startsWith("\\\\");
  if (!absolute) return command;
  const cwdNorm = cwd.replace(/\/+$/, "").replace(/\\+$/, "");
  const pathNorm = pathToken.replace(/\\/g, "/");
  const cwdCmp = cwdNorm.replace(/\\/g, "/");
  if (pathNorm !== cwdCmp && pathNorm.toLowerCase() !== cwdCmp.toLowerCase()) {
    return command;
  }
  return remainder;
}

function titleCaseToolName(name: string): string {
  if (!name) return "Tool";
  const base = name.includes("__") ? name.split("__").pop()! : name;
  return base
    .split(/[-_]/)
    .filter(Boolean)
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
    .join(" ");
}

/** Map pi tool name → Grok-like verb bucket. */
export function verbKindForTool(toolName: string): VerbKind {
  const n = toolName.toLowerCase();
  switch (n) {
    case "read":
      return "file";
    case "grep":
    case "find":
      return "search";
    case "ls":
      return "dir";
    case "bash":
      return "command";
    case "todo":
    case "todowrite":
    case "todo_write":
    case "update_todo":
    case "updatetodo":
      return "todo";
    case "web_search":
    case "websearch":
      return "web_search";
    case "web_fetch":
    case "webfetch":
      return "web_fetch";
    default:
      if (n.includes("todo")) return "todo";
      if (toolName.includes("__") || n.startsWith("mcp")) return "mcp";
      // use_tool / integration names often look like ServerTool
      if (/^[A-Z]/.test(toolName) || toolName.includes(" ")) return "mcp";
      return "other";
  }
}

function verbPast(kind: VerbKind): string {
  switch (kind) {
    case "file":
      return "Read";
    case "search":
      return "Searched";
    case "dir":
      return "Listed";
    case "web_fetch":
      return "Fetched";
    case "web_search":
      return "Searched";
    case "command":
      return "Ran";
    case "todo":
      return "Updated";
    case "mcp":
      return "Called";
    case "other":
      return "Ran";
  }
}

function noun(kind: VerbKind, count: number): string {
  const oneMany: Record<VerbKind, [string, string]> = {
    file: ["file", "files"],
    search: ["pattern", "patterns"],
    dir: ["dir", "dirs"],
    web_fetch: ["website", "websites"],
    web_search: ["website", "websites"],
    command: ["command", "commands"],
    todo: ["todo", "todos"],
    mcp: ["MCP tool", "MCP tools"],
    other: ["tool", "tools"],
  };
  const [one, many] = oneMany[kind];
  return count === 1 ? one : many;
}

/**
 * Aggregated group label like Grok: "Read 2 files, Ran 1 command · 1 failed"
 */
export function formatVerbGroupLabel(
  members: { toolName: string; isError?: boolean }[],
): string {
  if (members.length === 0) return "Tools";

  // First-appearance order buckets (same kind merges even if non-adjacent)
  const ordered: { kind: VerbKind; count: number }[] = [];
  let failed = 0;
  for (const m of members) {
    const kind = verbKindForTool(m.toolName);
    const b = ordered.find((x) => x.kind === kind);
    if (b) b.count += 1;
    else ordered.push({ kind, count: 1 });
    if (m.isError) failed += 1;
  }

  const parts = ordered.map(
    (b) => `${verbPast(b.kind)} ${b.count} ${noun(b.kind, b.count)}`,
  );
  let text = parts.join(", ");
  if (failed > 0) {
    text += ` · ${failed} failed`;
  }
  return text;
}

/**
 * Human-readable title for a tool call (no expand hint, no status mark).
 * Always a single physical line (newlines flattened).
 */
export function formatToolTitle(
  toolName: string,
  args: unknown,
  options?: { cwd?: string },
): string {
  const a = asRecord(args);
  const name = toolName || "tool";

  switch (name) {
    case "read": {
      const path = str(a.path) ?? str(a.file_path) ?? str(a.target_file);
      return path ? `Read \`${truncateChars(path, 60)}\`` : "Read";
    }
    case "edit": {
      const path = str(a.path) ?? str(a.file_path);
      return path ? `Edit \`${truncateChars(path, 60)}\`` : "Edit";
    }
    case "write": {
      const path = str(a.path) ?? str(a.file_path);
      return path ? `Write \`${truncateChars(path, 60)}\`` : "Write";
    }
    case "bash": {
      const raw = str(a.command) ?? "";
      const peeled = stripRedundantSessionCd(raw, options?.cwd);
      const cmd = truncateChars(peeled || "…", MAX_COMMAND_DISPLAY_CHARS);
      return `Execute \`${cmd}\``;
    }
    case "grep": {
      const pattern = str(a.pattern);
      return pattern ? truncateChars(pattern, 60) : "Search";
    }
    case "find": {
      const pattern = str(a.pattern) ?? str(a.glob);
      return pattern ? `Find \`${truncateChars(pattern, 48)}\`` : "Find";
    }
    case "ls": {
      const path = str(a.path) ?? ".";
      return `List \`${truncateChars(path, 48)}\``;
    }
    case "todo":
    case "todowrite":
    case "todo_write":
    case "TodoWrite": {
      // Prefer a short subject from args when present
      const subject =
        str(a.subject) ??
        str(a.title) ??
        str(a.content) ??
        (Array.isArray(a.todos) ? `${a.todos.length} items` : undefined);
      return subject ? `Todo \`${truncateChars(subject, 48)}\`` : "Todo";
    }
    default: {
      if (name.toLowerCase().includes("todo")) {
        return "Todo";
      }
      const label = titleCaseToolName(name);
      const preview =
        str(a.path) ??
        str(a.file_path) ??
        str(a.query) ??
        str(a.url) ??
        str(a.pattern) ??
        str(a.command) ??
        str(a.tool_name);
      if (preview) {
        return `${label} \`${truncateChars(preview, 48)}\``;
      }
      return label;
    }
  }
}

/**
 * Collapsed one-line label without status glyph (caller adds colored dots).
 */
export function formatCollapsedToolLabel(
  toolName: string,
  args: unknown,
  options?: { cwd?: string; isError?: boolean },
): string {
  // isError kept for API compat; status is shown via colored dots now.
  void options?.isError;
  return formatToolTitle(toolName, args, { cwd: options?.cwd });
}
