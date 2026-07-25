/**
 * Shared helpers: strip background color blocks, zero padding, dim body text.
 */

const passthrough = (t: string) => t;

export function stripAnsi(s: string): string {
  // eslint-disable-next-line no-control-regex
  return s.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, "");
}

/** Recursively clear Box/Text background functions and padding. */
export function stripBgDeep(node: unknown, depth = 0): void {
  if (!node || typeof node !== "object" || depth > 10) return;
  const n = node as {
    setBgFn?: (fn: (t: string) => string) => void;
    setCustomBgFn?: (fn: (t: string) => string) => void;
    bgFn?: (t: string) => string;
    customBgFn?: (t: string) => string;
    paddingX?: number;
    paddingY?: number;
    children?: unknown[];
    invalidate?: () => void;
    invalidateCache?: () => void;
    cache?: unknown;
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
    n.cache = undefined;
    n.invalidateCache?.();
    n.invalidate?.();
  } catch {
    /* ignore */
  }

  if (Array.isArray(n.children)) {
    for (const c of n.children) stripBgDeep(c, depth + 1);
  }
}

/**
 * Dim body Text nodes (skip marked title/status lines).
 * Re-colors plain text with theme.dim / muted so body is quieter than titles.
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
    invalidate?: () => void;
  };

  for (const m of skipMarks) {
    if (n[m]) return;
  }

  if (typeof n.setText === "function" && typeof n.text === "string") {
    try {
      const plain = stripAnsi(n.text);
      // Avoid double-dimming empty lines
      if (plain.trim().length > 0) {
        n.setText(dimFn(plain));
        n.invalidate?.();
      }
    } catch {
      /* ignore */
    }
  }

  if (Array.isArray(n.children)) {
    for (const c of n.children) dimBodyTexts(c, dimFn, skipMarks, depth + 1);
  }
}
