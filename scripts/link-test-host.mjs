// Tests use the installed host, not a bundled second copy of Pi.
// Optional argument: a node_modules directory from a non-managed installation.
import { lstatSync, mkdirSync, readFileSync, realpathSync, symlinkSync, unlinkSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

try {
  let modules = process.argv[2] && resolve(process.argv[2]);
  if (!modules) {
    const install = process.env.PI_MANAGED_INSTALL_ROOT ?? join(homedir(), ".pi/agent/install");
    const version = readFileSync(join(install, "current-version"), "utf8").trim();
    if (!/^[A-Za-z0-9][A-Za-z0-9._+-]*$/.test(version)) throw new Error("Invalid managed Pi version");
    modules = join(install, "releases", version, "node_modules");
  }
  const scope = join(process.cwd(), "node_modules/@earendil-works");
  const links = ["pi-coding-agent", "pi-tui"].map(name => {
    const target = realpathSync(join(modules, "@earendil-works", name));
    const path = join(scope, name);
    let existing;
    try { existing = lstatSync(path); } catch (error) { if (error.code !== "ENOENT") throw error; }
    if (existing && !existing.isSymbolicLink()) throw new Error("Refusing to replace real dependency: " + path);
    return { target, path, existing };
  });
  // Preflight all targets before modifying either link.
  mkdirSync(scope, { recursive: true });
  for (const { target, path, existing } of links) {
    if (existing) unlinkSync(path);
    symlinkSync(target, path, "junction");
    console.log(path + " -> " + target);
  }
} catch (error) {
  console.error("Cannot link Pi test host: " + error.message);
  process.exitCode = 1;
}
