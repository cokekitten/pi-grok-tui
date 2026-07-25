/**
 * Shared helpers: strip background color blocks, zero padding, dim body text.
 *
 * IMPORTANT: never call node.invalidate() on ToolExecutionComponent — its
 * invalidate() re-enters updateDisplay and will infinite-loop with stripBgDeep.
 */

const passthrough = (t: string) => t;

export function stripAnsi(s: string): string {
  // eslint-disable-next-line no-control-regex
  return s.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, "");
}

/** Clear render caches without calling invalidate() (avoids updateDisplay re-entry). */
function clearRenderCache(n: {
  cache?: unknown;
  cachedText?: unknown;
  cachedWidth?: unknown;
  cachedLines?: unknown;
  invalidateCache?: () => void;
}): void {
  try {
    n.cache = undefined;
    n.cachedText = undefined;
    n.cachedWidth = undefined;
    n.cachedLines = undefined;
    // Box has invalidateCache that only clears cache — safe
    if (typeof n.invalidateCache === "function") {
      n.invalidateCache();
    }
  } catch {
    /* ignore */
  }
}

/** Recursively clear Box/Text background functions and padding. */
export function stripBgDeep(node: unknown, depth = 0): void {
  if (!node || typeof node !== "object" || depth > 10) return;

  // Never descend into / re-enter tool roots via invalidate
  const n = node as {
    toolName?: string;
    updateDisplay?: unknown;
    setBgFn?: (fn: (t: string) => string) => void;
    setCustomBgFn?: (fn: (t: string) => string) => void;
    bgFn?: (t: string) => string;
    customBgFn?: (t: string) => string;
    paddingX?: number;
    paddingY?: number;
    children?: unknown[];
    contentBox?: unknown;
    contentText?: unknown;
    selfRenderContainer?: unknown;
    cache?: unknown;
    cachedText?: unknown;
    cachedWidth?: unknown;
    cachedLines?: unknown;
    invalidateCache?: () => void;
  };

  try {
    if (typeof n.setBgFn === "function") n.setBgFn(passthrough);
    else if ("bgFn" in n) n.bgFn = passthrough;
    if (typeof n.setCustomBgFn === "function") n.setCustomBgFn(passthrough);
    else if ("customBgFn" in n) n.customBgFn = passthrough;
    if (typeof n.paddingY === "number") {
      n.paddingX = 0;
      n.paddingY = 0;
    }
    clearRenderCache(n);
  } catch {
    /* ignore */
  }

  // Prefer known child containers over full children walk on ToolExecution
  // (walking ToolExecution.children + invalidate used to re-enter updateDisplay)
  if (n.contentBox) stripBgDeep(n.contentBox, depth + 1);
  if (n.contentText) stripBgDeep(n.contentText, depth + 1);
  if (n.selfRenderContainer) stripBgDeep(n.selfRenderContainer, depth + 1);

  if (Array.isArray(n.children)) {
    for (const c of n.children) {
      // Skip nested ToolExecution (shouldn't nest, but be safe)
      if (
        c &&
        typeof c === "object" &&
        typeof (c as { updateDisplay?: unknown }).updateDisplay === "function" &&
        typeof (c as { toolName?: unknown }).toolName === "string"
      ) {
        continue;
      }
      stripBgDeep(c, depth + 1);
    }
  }
}

/**
 * Dim body Text nodes (skip marked title/status lines).
 * Does not call ToolExecution.invalidate().
 */
export function dimBodyTexts(
  node: unknown,
  dimFn: (text: string) => string,
  skipMarks: string[],
  depth = 0,
): void {
  if (!node || typeof node !== "object" || depth > 10) return;
  const n = node as Record<string, unknown> & {
    setText?: (t: string) => void;
    text?: string;
    children?: unknown[];
    toolName?: string;
    updateDisplay?: unknown;
    cachedText?: unknown;
    cachedWidth?: unknown;
    cachedLines?: unknown;
  };

  // Don't recurse into nested tools
  if (typeof n.toolName === "string" && typeof n.updateDisplay === "function" && depth > 0) {
    return;
  }

  for (const m of skipMarks) {
    if (n[m]) return;
  }

  if (typeof n.setText === "function" && typeof n.text === "string") {
    try {
      const plain = stripAnsi(n.text);
      if (plain.trim().length > 0) {
        n.setText(dimFn(plain));
        // Clear Text caches only — do NOT call invalidate()
        n.cachedText = undefined;
        n.cachedWidth = undefined;
        n.cachedLines = undefined;
      }
    } catch {
      /* ignore */
    }
  }

  if (Array.isArray(n.children)) {
    for (const c of n.children) dimBodyTexts(c, dimFn, skipMarks, depth + 1);
  }
}
