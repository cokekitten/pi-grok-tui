/**
 * Resolve and import pi-coding-agent internal modules.
 *
 * pi's bundled runtime serves the package to extensions through jiti
 * virtualModules, so internals are reached via the package root namespace
 * (components, InteractiveMode, theme helpers are re-exported there). The
 * live theme singleton is shared through a globalThis symbol.
 */
import * as piAgent from "@earendil-works/pi-coding-agent";

export const PI_CODING_AGENT = "@earendil-works/pi-coding-agent";

export const INTERNAL_MODULES = {
  assistantMessageComponent:
    "dist/modes/interactive/components/assistant-message.js",
  toolExecution: "dist/modes/interactive/components/tool-execution.js",
  customMessage: "dist/modes/interactive/components/custom-message.js",
  theme: "dist/modes/interactive/theme/theme.js",
} as const;

const THEME_KEY = Symbol.for("@earendil-works/pi-coding-agent:theme");
const THEME_KEY_LEGACY = Symbol.for("@mariozechner/pi-coding-agent:theme");

function readGlobalTheme(): unknown {
  const values = globalThis as typeof globalThis & {
    [THEME_KEY]?: unknown;
    [THEME_KEY_LEGACY]?: unknown;
  };
  const current = values[THEME_KEY] ?? values[THEME_KEY_LEGACY];
  if (!current) {
    throw new Error("Theme not initialized. Call initTheme() first.");
  }
  return current;
}

// Forward each access to the current global theme, mirroring the upstream
// theme export (a proxy over the same globalThis slot).
const liveTheme = new Proxy({} as Record<string, unknown>, {
  get(_target, prop) {
    const current = readGlobalTheme() as Record<string, unknown>;
    return current[prop as string];
  },
});

export async function importInternal<T>(
  packageName: string,
  relativePath: string,
): Promise<T> {
  if (packageName !== PI_CODING_AGENT) {
    throw new Error(`Unsupported package: ${packageName}`);
  }
  if (relativePath === INTERNAL_MODULES.theme) {
    return { theme: liveTheme } as T;
  }
  return piAgent as T;
}
