import { it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
const script = fileURLToPath(new URL("./scripts/link-test-host.mjs", import.meta.url));
it("links both test peers to the managed current version and refreshes after an upgrade", () => {
  const root = mkdtempSync(join(tmpdir(), "grok-host-setup-"));
  try {
    const install = join(root, "install"), repo = join(root, "repo");
    mkdirSync(repo); mkdirSync(install);
    for (const version of ["1.5.0", "1.6.0"]) {
      const modules = join(install, "releases", version, "node_modules", "@earendil-works");
      for (const name of ["pi-coding-agent", "pi-tui"]) mkdirSync(join(modules, name), { recursive: true });
      writeFileSync(join(install, "current-version"), version + "\n");
      const result = spawnSync(process.execPath, [script], { cwd: repo, env: { ...process.env, PI_MANAGED_INSTALL_ROOT: install }, encoding: "utf8" });
      assert.equal(result.status, 0, result.stderr);
      for (const name of ["pi-coding-agent", "pi-tui"]) {
        assert.equal(realpathSync(join(repo, "node_modules", "@earendil-works", name)), realpathSync(join(modules, name)));
      }
    }
  } finally { rmSync(root, { recursive: true, force: true }); }
});
it("refuses to overwrite a real dependency directory", () => {
  const root = mkdtempSync(join(tmpdir(), "grok-host-setup-"));
  try {
    const install = join(root, "install");
    for (const name of ["pi-coding-agent", "pi-tui"]) mkdirSync(join(install, "releases", "1.5.0", "node_modules", "@earendil-works", name), { recursive: true });
    writeFileSync(join(install, "current-version"), "1.5.0\n");
    const dependency = join(root, "node_modules", "@earendil-works", "pi-tui");
    mkdirSync(dependency, { recursive: true }); writeFileSync(join(dependency, "keep"), "keep");
    const result = spawnSync(process.execPath, [script], { cwd: root, env: { ...process.env, PI_MANAGED_INSTALL_ROOT: install }, encoding: "utf8" });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Refusing to replace/);
    assert.equal(realpathSync(dependency), join(realpathSync(root), "node_modules", "@earendil-works", "pi-tui"));
  } finally { rmSync(root, { recursive: true, force: true }); }
});
