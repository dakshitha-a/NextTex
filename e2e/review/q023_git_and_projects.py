"""Q-023, Q-024 and Q-026, through the server's routes on a sandbox.

Not a check: a review driver, run by hand from the repository root with
`.venv/bin/python e2e/review/q023_git_and_projects.py`.  A merge left with a
conflict in a terminal, then the Git drawer's commit; a detached head; and
an archived project whose folder is added again.
"""
import json, shutil, subprocess, sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent))
from probe_sandbox import Sandbox

sb = Sandbox()
def listing(x):
    return x.get("projects", x) if isinstance(x, dict) else x

try:
    root = sb.projects / "paper"; root.mkdir()
    g = lambda *a: subprocess.run(["git", "-C", str(root), *a], capture_output=True, text=True)
    (root / "main.tex").write_text("line one\n")
    g("init", "-q", "-b", "main"); g("config", "user.email", "p@e.invalid"); g("config", "user.name", "P")
    g("add", "-A"); g("commit", "-qm", "first")
    g("checkout", "-qb", "other"); (root / "main.tex").write_text("line from other\n"); g("commit", "-qam", "other")
    g("checkout", "-q", "main"); (root / "main.tex").write_text("line from main\n"); g("commit", "-qam", "main")
    print("terminal merge:", g("merge", "other").stdout.strip().splitlines()[-1])
    pid = sb.post("/api/projects", {"path": str(root)})["id"]
    sb.post(f"/api/projects/{pid}/open")
    status = sb.get(f"/api/projects/{pid}/git")
    print("Q-023 drawer status keys:", sorted(status.keys()) if isinstance(status, dict) else status)
    print("Q-023 drawer status:", json.dumps(status)[:400])
    try:
        out = sb.post(f"/api/projects/{pid}/git/commit", {"message": "from the drawer"})
        print("Q-023 commit answered:", json.dumps(out)[:200])
    except Exception as e:
        print("Q-023 commit refused:", e)
    print("Q-023 HEAD holds:", repr(g("show", "HEAD:main.tex").stdout))
    # Q-024: a detached head.
    g("checkout", "-q", "--detach", "HEAD~1")
    status = sb.get(f"/api/projects/{pid}/git")
    print("Q-024 branch shown:", status.get("branch") if isinstance(status, dict) else status)
    # Q-026: archive the project, then add its folder again.
    sb.post(f"/api/projects/{pid}/state", {"state": "archived"})
    before = [p for p in listing(sb.get("/api/projects")) if p.get("path") == str(root)]
    print("Q-026 before re-adding:", [(p.get("state"), p.get("last_opened")) for p in before])
    sb.post("/api/projects", {"path": str(root)})
    after = [p for p in listing(sb.get("/api/projects")) if p.get("path") == str(root)]
    print("Q-026 after re-adding:", [(p.get("state"), p.get("last_opened")) for p in after])
finally:
    sb.stop(); shutil.rmtree(sb.dir, ignore_errors=True)
