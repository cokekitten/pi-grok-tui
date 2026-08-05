/**
 * Keep pi's main editor/footer visually docked to the bottom of the terminal.
 *
 * Pi's TUI is an inline, vertically stacked component tree. When the rendered
 * transcript is shorter than the terminal, growing/collapsing chat rows moves
 * the editor. This patch pads the root TUI immediately before the editor
 * container so the whole root is at least one terminal high. Once the
 * transcript exceeds the viewport, normal terminal scrolling takes over.
 *
 * This is visual docking, not a separate scrollable message pane. If content
 * first overflows and later shrinks, pi's terminal.clearOnShrink setting can
 * re-anchor the inline viewport. Disable with PI_GROK_TUI_DOCK_EDITOR=0 if
 * another extension owns root layout.
 */
import { TUI } from "@earendil-works/pi-tui";

type Renderable = {
  render(width: number): string[];
  children?: unknown[];
};

type DockableTui = TUI & {
  children: Renderable[];
  terminal: { rows: number };
};

function isFalseLike(value: string | undefined): boolean {
  return value != null && ["0", "false", "off", "no"].includes(value.toLowerCase());
}

export function isEditorDockEnabled(): boolean {
  return !isFalseLike(process.env.PI_GROK_TUI_DOCK_EDITOR);
}

/** Number of blank rows needed to make the root exactly one viewport tall. */
export function editorDockFillRows(
  renderedRows: number,
  terminalRows: number,
): number {
  if (!Number.isFinite(renderedRows) || !Number.isFinite(terminalRows)) return 0;
  return Math.max(0, Math.floor(terminalRows) - Math.max(0, Math.floor(renderedRows)));
}

function isMainEditor(node: unknown, tui: DockableTui): boolean {
  if (!node || typeof node !== "object") return false;
  const editor = node as {
    tui?: unknown;
    actionHandlers?: { get?: unknown; set?: unknown };
    getText?: unknown;
    setText?: unknown;
    handleInput?: unknown;
  };

  // CustomEditor owns app-level actionHandlers; this avoids matching ordinary
  // text inputs used inside selectors/dialogs.
  return (
    editor.tui === tui &&
    typeof editor.actionHandlers?.get === "function" &&
    typeof editor.actionHandlers?.set === "function" &&
    typeof editor.getText === "function" &&
    typeof editor.setText === "function" &&
    typeof editor.handleInput === "function"
  );
}

function containsMainEditor(
  node: unknown,
  tui: DockableTui,
  seen = new Set<object>(),
  depth = 0,
): boolean {
  if (!node || typeof node !== "object" || depth > 16) return false;
  if (seen.has(node)) return false;
  seen.add(node);

  if (isMainEditor(node, tui)) return true;
  const children = (node as { children?: unknown[] }).children;
  if (!Array.isArray(children)) return false;
  return children.some((child) =>
    containsMainEditor(child, tui, seen, depth + 1),
  );
}

function flatten(renderedChildren: string[][]): string[] {
  const lines: string[] = [];
  for (const childLines of renderedChildren) {
    for (const line of childLines) lines.push(line);
  }
  return lines;
}

/**
 * Patch only the root TUI render. Child containers keep native rendering.
 * Returns an idempotent cleanup function.
 */
export function installEditorDockPatch(): () => void {
  if (!isEditorDockEnabled()) return () => {};

  const prototype = TUI.prototype as unknown as {
    render(width: number): string[];
  };
  const originalRender = prototype.render;
  if (typeof originalRender !== "function") {
    throw new Error("pi-grok-tui: TUI.render missing");
  }

  const originalOwnDescriptor = Object.getOwnPropertyDescriptor(
    TUI.prototype,
    "render",
  );
  let renderDepth = 0;

  const patchedRender = function (
    this: DockableTui,
    width: number,
  ): string[] {
    // Defensive fallback if a custom component re-enters root rendering.
    if (renderDepth > 0 || !Array.isArray(this.children)) {
      return originalRender.call(this, width);
    }

    renderDepth += 1;
    try {
      // Render each root child exactly once, preserving Container.render order.
      const renderedChildren = this.children.map((child) => child.render(width));
      const editorIndex = this.children.findIndex((child) =>
        containsMainEditor(child, this),
      );
      if (editorIndex < 0) return flatten(renderedChildren);

      const renderedRows = renderedChildren.reduce(
        (sum, childLines) => sum + childLines.length,
        0,
      );
      const fillRows = editorDockFillRows(renderedRows, this.terminal?.rows);
      if (fillRows > 0) {
        renderedChildren[editorIndex] = [
          ...Array.from({ length: fillRows }, () => ""),
          ...renderedChildren[editorIndex]!,
        ];
      }
      return flatten(renderedChildren);
    } finally {
      renderDepth -= 1;
    }
  };

  prototype.render = patchedRender;

  let cleaned = false;
  return () => {
    if (cleaned) return;
    cleaned = true;
    // Do not overwrite a later extension's patch.
    if (prototype.render !== patchedRender) return;
    if (originalOwnDescriptor) {
      Object.defineProperty(TUI.prototype, "render", originalOwnDescriptor);
    } else {
      delete (TUI.prototype as unknown as { render?: unknown }).render;
    }
  };
}
