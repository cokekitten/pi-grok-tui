/**
 * Shared extension state (thinking expand + patch refcount).
 */

export interface ActiveEntry {
  messageTimestamp: number;
  contentIndex: number;
}

export interface ThinkingScrollState {
  activeByTimestamp: Map<number, ActiveEntry>;
  globalExpanded: boolean;
  patchRefCount: number;
  patchCleanup?: (() => void) | undefined;
  patchInstallPromise?: Promise<() => void> | undefined;
  patchRelease?: (() => Promise<void>) | undefined;
}

const STATE_KEY = Symbol.for("thinking-scroll.state");

export function getState(): ThinkingScrollState {
  const existing = (globalThis as any)[STATE_KEY];
  if (existing && typeof existing === "object") return existing;
  const created: ThinkingScrollState = {
    activeByTimestamp: new Map(),
    globalExpanded: false,
    patchRefCount: 0,
  };
  (globalThis as any)[STATE_KEY] = created;
  return created;
}
