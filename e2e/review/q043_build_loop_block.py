"""Q-043: how long the server stops answering at the end of a big build.

Not a check: a review driver, run by hand from the repository root with
`NEXTTEX_THESIS=<dir> .venv/bin/python e2e/review/q043_build_loop_block.py`,
where the directory is a project `bench.build_project` made.  Its chapters
cite and refer to things they never define, so a full build carries tens
of thousands of warnings.  `/api/instance` is asked for every ten
milliseconds during a full build, and every wait over 300 ms is printed.
"""
import os, shutil, sys, threading, time
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent))
from probe_sandbox import Sandbox

thesis = os.environ.get("NEXTTEX_THESIS")
if not thesis:
    sys.exit("set NEXTTEX_THESIS to a project bench.build_project made")
sb = Sandbox()
try:
    root = sb.projects / "thesis"
    shutil.copytree(thesis, root)
    shutil.rmtree(root / ".git", ignore_errors=True)
    pid = sb.post("/api/projects", {"path": str(root)})["id"]
    sb.post(f"/api/projects/{pid}/open")
    gaps, stop = [], threading.Event()
    def ping():
        while not stop.is_set():
            t = time.perf_counter()
            try: sb.get("/api/instance", timeout=120)
            except Exception: pass
            d = (time.perf_counter() - t) * 1000
            if d > 300: gaps.append(round(d))
            time.sleep(0.01)
    threading.Thread(target=ping, daemon=True).start()
    t = time.time()
    r = sb.post(f"/api/projects/{pid}/compile", {"full": True}, timeout=600)
    time.sleep(2); stop.set()
    print(f"full build {time.time() - t:.1f} s, {len(r.get('diagnostics', []))} diagnostics;"
          f" waits over 300 ms: {gaps}")
finally:
    sb.stop(); shutil.rmtree(sb.dir, ignore_errors=True)
