/**
 * Grok-style rule templates for collapsed tool titles (display-only).
 * Pure helpers — no TUI imports so they can be unit-tested with node:test.
 */

/** Tools that stay fully expanded after finish (Grok Edit default). */
const ALWAYS_EXPANDED_TOOLS = new Set(["edit", "write"]);

/** Max code-point length for the command body inside Execute \`...\`. */
const MAX_COMMAND_DISPLAY_CHARS = 80;

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

function truncateChars(s: string, max: number): string {
  if ([...s].length <= max) return s;
  return [...s].slice(0, Math.max(1, max - 1)).join("") + "…";
}

/**
 * Peel a leading `cd <cwd> &&` / `;` when the path matches session cwd (lexical).
 * Fail-closed on relative paths, mismatch, or ambiguous forms.
 */
export function stripRedundantSessionCd(command: string, cwd?: string): string {
  if (!cwd || !cwd.trim()) return command;
  const trimmed = command.trimStart();
  const m = trimmed.match(/^cd\s+(?:\/d\s+)?("([^"]+)"|'([^']+)'|(\S+))\s*(?:&&|;)\s*(.+)$/i);
  if (!m) return command;
  const pathToken = (m[2] ?? m[3] ?? m[4] ?? "").replace(/\/+$/, "");
  const remainder = (m[5] ?? "").trim();
  if (!remainder) return command;
  // Absolute-shaped only
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
  // MCP style server__tool → last segment
  const base = name.includes("__") ? name.split("__").pop()! : name;
  return base
    .split(/[-_]/)
    .filter(Boolean)
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
    .join(" ");
}

/**
 * Human-readable title for a tool call (no expand hint, no error mark).
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
      return path ? `Read \`${path}\`` : "Read";
    }
    case "edit": {
      const path = str(a.path) ?? str(a.file_path);
      return path ? `Edit \`${path}\`` : "Edit";
    }
    case "write": {
      const path = str(a.path) ?? str(a.file_path);
      return path ? `Write \`${path}\`` : "Write";
    }
    case "bash": {
      const raw = str(a.command) ?? "";
      const peeled = stripRedundantSessionCd(raw, options?.cwd);
      const cmd = truncateChars(peeled.trim() || "…", MAX_COMMAND_DISPLAY_CHARS);
      return `Execute \`${cmd}\``;
    }
    case "grep": {
      const pattern = str(a.pattern);
      return pattern ? pattern : "Search";
    }
    case "find": {
      const pattern = str(a.pattern) ?? str(a.glob);
      return pattern ? `Find \`${pattern}\`` : "Find";
    }
    case "ls": {
      const path = str(a.path) ?? ".";
      return `List \`${path}\``;
    }
    default: {
      const label = titleCaseToolName(name);
      const preview =
        str(a.path) ??
        str(a.file_path) ??
        str(a.query) ??
        str(a.url) ??
        str(a.pattern) ??
        str(a.command);
      if (preview) {
        const short = truncateChars(preview, 48);
        return `${label} \`${short}\``;
      }
      return label;
    }
  }
}

/**
 * Collapsed one-line label: optional error mark + title (no keybinding hint).
 */
export function formatCollapsedToolLabel(
  toolName: string,
  args: unknown,
  options?: { cwd?: string; isError?: boolean },
): string {
  const title = formatToolTitle(toolName, args, { cwd: options?.cwd });
  if (options?.isError) {
    return `✗ ${title}`;
  }
  return title;
}
