"""A sandboxed NextTex for the review drivers: its own state, port and token.

Not a check.  Used by the Python drivers beside it, run by hand.

Started the way e2e/server.ts starts one.  Stopped only by the PID it was
started under, after reading that PID's environment to confirm it is ours.
"""
import json, os, signal, socket, subprocess, sys, tempfile, time, urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
TOKEN = "probe-token"
MARK = "NEXTTEX_PROBE_SANDBOX"


def free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


class Sandbox:
    def __init__(self, wrap=(), config=None, **env):
        self.dir = Path(tempfile.mkdtemp(prefix="nexttex-probe-",
                                         dir=os.environ.get("PROBE_TMP")))
        self.data, self.config, self.projects = (self.dir / n for n in ("data", "config", "projects"))
        for d in (self.data, self.config, self.projects):
            d.mkdir(parents=True)
        self.port = free_port()
        state = self.data / "nexttex"
        state.mkdir(parents=True)
        (state / "config.json").write_text(json.dumps({
            "port": self.port, "localhost": True, "tailscale": False,
            "token": TOKEN, "model": "", "provider": "claude", "openai_key": "",
            **(config or {}),
        }))
        full = {**os.environ,
                "XDG_DATA_HOME": str(self.data), "XDG_CONFIG_HOME": str(self.config),
                "NEXTTEX_SCRIPTED_AGENT": "reply",
                "NEXTTEX_DICTIONARY_BASE": "http://127.0.0.1:9/npm",
                "NEXTTEX_FAKE_CLAUDE_AUTH": "1",
                "NEXTTEX_COLLAB_TRANSPORT": "loopback",
                MARK: str(self.dir), **env}
        for k, v in env.items():
            if v == "":
                full.pop(k, None)
        self.log = open(self.dir / "server.log", "w")
        self.proc = subprocess.Popen(
            [*wrap, str(ROOT / ".venv/bin/python"), "-m", "server.run"],
            cwd=ROOT, env=full, stdout=self.log, stderr=subprocess.STDOUT,
            start_new_session=True,
        )
        self.base = f"http://127.0.0.1:{self.port}"
        deadline = time.time() + 60
        while time.time() < deadline:
            try:
                self.get("/api/instance")
                return
            except Exception:
                if self.proc.poll() is not None:
                    raise RuntimeError((self.dir / "server.log").read_text()[-2000:])
                time.sleep(0.2)
        raise RuntimeError("sandbox never answered")

    def request(self, method, path, body=None, timeout=300):
        data = json.dumps(body).encode() if body is not None else None
        req = urllib.request.Request(self.base + path, data=data, method=method, headers={
            "x-nexttex-token": TOKEN, "content-type": "application/json",
            "origin": self.base,
        })
        with urllib.request.urlopen(req, timeout=timeout) as r:
            raw = r.read()
            try:
                return json.loads(raw)
            except ValueError:
                return raw

    def get(self, path, **kw):
        return self.request("GET", path, **kw)

    def post(self, path, body=None, **kw):
        return self.request("POST", path, body if body is not None else {}, **kw)

    def stop(self):
        pid = self.proc.pid
        try:
            environ = Path(f"/proc/{pid}/environ").read_bytes().split(b"\0")
        except FileNotFoundError:
            return
        if f"{MARK}={self.dir}".encode() not in environ:
            raise RuntimeError(f"pid {pid} is not this sandbox; refusing to kill it")
        os.killpg(pid, signal.SIGTERM)
        try:
            self.proc.wait(10)
        except subprocess.TimeoutExpired:
            os.killpg(pid, signal.SIGKILL)
            self.proc.wait(5)
