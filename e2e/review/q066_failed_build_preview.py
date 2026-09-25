"""What the preview is served after a build that fails.

Not a check: a review driver, run by hand from the repository root with
`.venv/bin/python e2e/review/q066_failed_build_preview.py`.  A document is
built cleanly, then broken the way the probe's writer journey broke it, an
environment closed before it opens, and built again.  Printed: each build's
outcome and error count, and what the PDF route answers after each.
"""
import sys, shutil, urllib.error, urllib.request
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent))
from probe_sandbox import Sandbox, TOKEN

GOOD = ("\\documentclass{article}\n\\begin{document}\n"
        "\\section{Results}\nThe decay is fastest in water.\n\\end{document}\n")
BROKEN = GOOD.replace("The decay", "\\end{itemize}\nThe decay\n\\begin{itemize}\n\\item one\n")

def pdf_status(sb, pid):
    req = urllib.request.Request(f"{sb.base}/api/projects/{pid}/pdf",
                                 headers={"x-nexttex-token": TOKEN})
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            return f"{r.status}, {len(r.read())} bytes"
    except urllib.error.HTTPError as e:
        return f"{e.code}"

sb = Sandbox()
try:
    root = sb.projects / "paper"; root.mkdir()
    (root / "main.tex").write_text(GOOD)
    pid = sb.post("/api/projects", {"path": str(root)})["id"]
    sb.post(f"/api/projects/{pid}/open")
    for label, text in (("clean", GOOD), ("broken", BROKEN), ("fixed", GOOD)):
        sb.request("PUT", f"/api/projects/{pid}/file",
                   {"path": "main.tex", "text": text, "compile": False, "origin": "probe"})
        r = sb.post(f"/api/projects/{pid}/compile", {"full": True})
        errors = [d for d in r.get("diagnostics", []) if d.get("severity") == "error"]
        print(f"{label}: outcome={r.get('outcome')} errors={len(errors)} pdf route -> {pdf_status(sb, pid)}")
        for d in errors[:3]:
            print("   ", d.get("message", "")[:90])
finally:
    sb.stop(); shutil.rmtree(sb.dir, ignore_errors=True)
