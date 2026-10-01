#!/usr/bin/env python3
"""Real pi/jiti/PTY regression. Synthetic transcript, isolated config, no model calls.

Requires python3 and pi on PATH. The observer only reads completed frames;
all navigation is driven by terminal wheel/press/release/End and /reload input.
"""
import fcntl
import json
import os
from pathlib import Path
import pty
import select
import shutil
import signal
import struct
import subprocess
import tempfile
import termios
import time
import uuid

REPO = Path(__file__).resolve().parents[1]
OBSERVER = r'''
import { TuiAltScreen, stripTerminalSequences } from "@earendil-works/pi-tui";
import { writeFileSync, renameSync } from "node:fs";
export default function (pi) {
  let restore;
  pi.on("session_start", (_event, ctx) => {
    const original = TuiAltScreen.prototype.doRender;
    const installation = `${Date.now()}-${Math.random()}`;
    let tick = 0;
    function observe(...args) {
      const result = original.apply(this, args);
      const frame = this.currentLayout;
      if (!frame || !this.previousScreen?.length) return result;
      const visit = box => box.scrollView === frame.primaryScrollView
        ? box : box.children?.map(visit).find(Boolean);
      const box = visit(frame.root);
      const screen = this.previousScreen;
      const snapshot = { installation, tick: ++tick, following: this.isFollowingOutput,
        scrollTop: frame.primaryScrollView?.scrollTop, viewportRow: box?.rect.y,
        strips: screen.flatMap((s, i) => s.includes(";pi-grok-tui/v1/fold/prompt-jump") ? [i] : []),
        screen: screen.map(s => stripTerminalSequences(s).trim()) };
      const path = process.env.PI_JUMP_TEST_FRAME;
      writeFileSync(path + ".tmp", JSON.stringify(snapshot));
      renameSync(path + ".tmp", path);
      return result;
    }
    TuiAltScreen.prototype.doRender = observe;
    restore = () => {
      if (TuiAltScreen.prototype.doRender === observe) TuiAltScreen.prototype.doRender = original;
    };
    ctx.ui.setWidget("jump-test-render", undefined);
  });
  pi.on("session_shutdown", () => restore?.());
}
'''


def main():
    pi_bin = shutil.which("pi")
    assert pi_bin, "pi must be installed on PATH"
    with tempfile.TemporaryDirectory(prefix="pi-prompt-jump-pty-") as tmp:
        root = Path(tmp).resolve()
        agent = root / "agent"
        agent.mkdir()
        (agent / "settings.json").write_text(json.dumps({
            "theme": "dark", "tuiMode": "fullscreen", "quietStartup": True,
            "fullscreenScrollbar": "always", "fullscreenExitOutput": "resume-hint",
        }))
        observer = root / "observe.ts"
        observer.write_text(OBSERVER)
        snapshot = root / "frame.json"
        session = root / "synthetic.jsonl"
        entries = [{"type": "session", "version": 3, "id": str(uuid.uuid4()),
                    "timestamp": "2026-10-02T00:00:00.000Z", "cwd": str(root)}]
        parent = None
        for number, (role, text) in enumerate([
            ("user", "SYNTHETIC_USER_A"),
            ("assistant", "\n".join(f"SYNTHETIC_REPLY_A_{i}" for i in range(50))),
            ("user", "SYNTHETIC_USER_B\n\nSecond user continuation"),
            ("assistant", "\n".join(f"SYNTHETIC_REPLY_B_{i}" for i in range(50))),
        ]):
            message = {"role": role, "content": [{"type": "text", "text": text}],
                       "timestamp": 1790899200000 + number * 1000}
            if role == "assistant":
                message.update({"api": "anthropic-messages", "provider": "anthropic",
                                "model": "claude-sonnet-4-6", "stopReason": "stop",
                                "usage": {"input": 0, "output": 0, "cacheRead": 0,
                                          "cacheWrite": 0, "totalTokens": 0,
                                          "cost": {"input": 0, "output": 0, "cacheRead": 0,
                                                   "cacheWrite": 0, "total": 0}}})
            entry = {"type": "message", "id": f"synthetic-{number}", "parentId": parent,
                     "timestamp": "2026-10-02T00:00:00.000Z", "message": message}
            entries.append(entry)
            parent = entry["id"]
        session.write_text("\n".join(json.dumps(e) for e in entries) + "\n")
        # Deliberately do not forward provider keys or the real agent directory.
        env = {k: os.environ[k] for k in ("PATH", "HOME", "LANG", "TMPDIR") if k in os.environ}
        env.update({"TERM": "xterm-256color", "PI_CODING_AGENT_DIR": str(agent),
                    "PI_JUMP_TEST_FRAME": str(snapshot), "PI_OFFLINE": "1",
                    "PI_TELEMETRY": "0", "PI_SKIP_VERSION_CHECK": "1",
                    "PI_IMAGE_PROTOCOL": "none"})
        master, slave = pty.openpty()
        fcntl.ioctl(slave, termios.TIOCSWINSZ, struct.pack("HHHH", 24, 80, 0, 0))
        process = subprocess.Popen([
            pi_bin, "-ne", "-ns", "-np", "-nc", "--offline", "--tui-mode", "fullscreen",
            "-e", str(REPO / "extensions/grok-tui.ts"), "-e", str(observer),
            "--session", str(session), "--provider", "anthropic", "--model", "sonnet",
        ], cwd=root, env=env, stdin=slave, stdout=slave, stderr=slave, start_new_session=True)
        os.close(slave)
        output = bytearray()
        proofs = []
        latest = None

        def wait_for(label, predicate, previous=None):
            nonlocal latest
            deadline = time.monotonic() + 30
            while time.monotonic() < deadline:
                ready, _, _ = select.select([master], [], [], 0.05)
                if ready:
                    try:
                        output.extend(os.read(master, 65536))
                    except OSError:
                        break
                if snapshot.exists():
                    latest = json.loads(snapshot.read_text())
                    changed = previous is None or (latest["installation"], latest["tick"]) != previous
                    if changed and predicate(latest):
                        proof = {"stage": label, "following": latest["following"],
                                 "scrollTop": latest["scrollTop"], "strips": latest["strips"],
                                 "top": latest["screen"][latest["viewportRow"]:latest["viewportRow"] + 3]}
                        proofs.append(proof)
                        print(json.dumps(proof, ensure_ascii=False), flush=True)
                        return latest
                if process.poll() is not None:
                    break
            raise AssertionError(f"{label} failed; last snapshot={latest}; terminal tail={output[-3000:]!r}")

        def send(sequence, label, predicate):
            previous = (latest["installation"], latest["tick"])
            os.write(master, sequence)
            return wait_for(label, predicate, previous)

        def click():
            y = latest["viewportRow"] + 1
            return f"\x1b[<0;8;{y}M\x1b[<0;8;{y}m".encode()

        def floating(frame, name):
            row = frame["viewportRow"]
            return (frame["strips"] == [row] and name in frame["screen"][row]
                    and frame["screen"][row].startswith("❯ "))

        try:
            wait_for("initial-bottom", lambda f: f["following"] and any("SYNTHETIC_REPLY_B_49" in s for s in f["screen"]))
            send(b"\x1b[<64;8;5M", "wheel-shows-user-B", lambda f: floating(f, "SYNTHETIC_USER_B"))
            send(click(), "click-lands-on-B-floats-A", lambda f: floating(f, "SYNTHETIC_USER_A")
                 and "SYNTHETIC_USER_B" in f["screen"][f["viewportRow"] + 1])
            send(click(), "click-lands-on-A-no-older-float", lambda f: not f["strips"]
                 and "SYNTHETIC_USER_A" in f["screen"][f["viewportRow"] + 1])
            send(b"\x1b[F", "end-hides-float", lambda f: f["following"] and not f["strips"])
            old_installation = latest["installation"]
            send(b"/reload\r", "reload-installs-new-code", lambda f: f["installation"] != old_installation and f["following"])
            send(b"\x1b[<64;8;5M", "wheel-after-reload", lambda f: floating(f, "SYNTHETIC_USER_B"))
            send(click(), "click-after-reload", lambda f: floating(f, "SYNTHETIC_USER_A")
                 and "SYNTHETIC_USER_B" in f["screen"][f["viewportRow"] + 1])
            print(f"PASS: {len(proofs)} real pi PTY checkpoints; no model calls", flush=True)
        finally:
            if process.poll() is None:
                os.killpg(process.pid, signal.SIGTERM)
                try:
                    process.wait(timeout=3)
                except subprocess.TimeoutExpired:
                    os.killpg(process.pid, signal.SIGKILL)
                    process.wait()
            os.close(master)


if __name__ == "__main__":
    main()
