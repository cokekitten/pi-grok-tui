// Production is loaded by pi/jiti. Native Node tests need the equivalent
// relative .js -> .ts fallback for sources that use emitted-JS import paths.
import { registerHooks } from "node:module";
registerHooks({
  resolve(specifier, context, nextResolve) {
    try {
      return nextResolve(specifier, context);
    } catch (error) {
      if (error.code === "ERR_MODULE_NOT_FOUND" && specifier.startsWith(".") && specifier.endsWith(".js")) {
        return nextResolve(specifier.slice(0, -3) + ".ts", context);
      }
      throw error;
    }
  },
});
