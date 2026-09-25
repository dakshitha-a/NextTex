"""Q-028: one regular-expression search, and whether the server still answers.

Not a check: a review driver, run by hand from the repository root with
`.venv/bin/python e2e/review/q028_search_freeze.py`.  A sandbox server gets
a project with one crafted line; a search for `(a+)+$` is sent with the
regular-expression switch on, and `/api/instance`, which touches nothing,
is asked for while it runs.  The sandbox is then stopped by the process it
started, which is the only way to end the search.
"""
import shutil, sys, threading, time, urllib.parse
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent))
from probe_sandbox import Sandbox

sb = Sandbox()
try:
    root = sb.projects / "paper"; root.mkdir()
    (root / "main.tex").write_text("\\documentclass{article}\n\\begin{document}\nx\n\\end{document}\n")
    (root / "evil.tex").write_text("a" * 34 + "!\n")
    pid = sb.post("/api/projects", {"path": str(root)})["id"]
    sb.post(f"/api/projects/{pid}/open")
    pattern = urllib.parse.quote("(a+)+$")
    threading.Thread(target=lambda: sb.get(f"/api/projects/{pid}/search?q={pattern}&regex=true",
                                           timeout=30), daemon=True).start()
    time.sleep(1)
    t = time.time()
    try:
        sb.get("/api/instance", timeout=15)
        print(f"the server answered in {time.time() - t:.2f} s while the search ran")
    except Exception as error:
        print(f"the server did not answer within 15 s while the search ran: {error}")
finally:
    sb.stop(); shutil.rmtree(sb.dir, ignore_errors=True)
