/**
 * Resolve and import pi-coding-agent internal dist modules.
 */
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export function getPackageRoot(packageName: string): string {
  const entryUrl = import.meta.resolve(packageName);
  const entryPath = fileURLToPath(entryUrl);
  // package entry is typically dist/index.js → root is parent of dist
  return dirname(dirname(entryPath));
}

export function resolveInternalModuleUrl(
  packageName: string,
  relativePath: string,
): string {
  const packageRoot = getPackageRoot(packageName);
  return pathToFileURL(join(packageRoot, relativePath)).href;
}

export async function importInternal<T>(
  packageName: string,
  relativePath: string,
): Promise<T> {
  const moduleUrl = resolveInternalModuleUrl(packageName, relativePath);
  return (await import(moduleUrl)) as T;
}

export const PI_CODING_AGENT = "@earendil-works/pi-coding-agent";

export const INTERNAL_MODULES = {
  assistantMessageComponent:
    "dist/modes/interactive/components/assistant-message.js",
  toolExecution: "dist/modes/interactive/components/tool-execution.js",
  customMessage: "dist/modes/interactive/components/custom-message.js",
  theme: "dist/modes/interactive/theme/theme.js",
} as const;
