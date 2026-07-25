/**
 * Strip SkillInvocationMessageComponent color blocks; keep text only.
 * Matches flat tool chrome (no purple/green skill box).
 */
import {
  importInternal,
  PI_CODING_AGENT,
} from "./internal-import.js";

export async function installSkillFlatPatch(): Promise<() => void> {
  const mod = await importInternal<{
    SkillInvocationMessageComponent?: unknown;
  }>(
    PI_CODING_AGENT,
    "dist/modes/interactive/components/skill-invocation-message.js",
  );

  const Ctor = mod.SkillInvocationMessageComponent as
    | {
        prototype: {
          bgFn?: (t: string) => string;
          setBgFn?: (fn: (t: string) => string) => void;
          paddingX?: number;
          paddingY?: number;
          updateDisplay?: () => void;
        };
      }
    | undefined;

  if (!Ctor?.prototype?.updateDisplay) {
    throw new Error("thinking-scroll: SkillInvocationMessageComponent missing");
  }

  const proto = Ctor.prototype;
  const original = proto.updateDisplay!;

  proto.updateDisplay = function (this: {
    bgFn?: (t: string) => string;
    setBgFn?: (fn: (t: string) => string) => void;
    paddingX?: number;
    paddingY?: number;
  }) {
    original.call(this);
    // Flatten after native paints customMessageBg box
    try {
      if (typeof this.setBgFn === "function") {
        this.setBgFn((t: string) => t);
      } else if ("bgFn" in this) {
        this.bgFn = (t: string) => t;
      }
      if (typeof this.paddingY === "number") {
        this.paddingX = 0;
        this.paddingY = 0;
      }
    } catch {
      /* ignore */
    }
  };

  return () => {
    proto.updateDisplay = original;
  };
}
