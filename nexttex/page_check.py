"""Look at a page the agent published, the way the writer's browser will.

The thesis's agent published a derivation whose equations were drawn by
its own script, and one extra parenthesis stopped that script: every
equation was blank, `publish_page` said it had worked, and nobody knew
until the writer sent a screenshot. A page is code, and code that is never
run is not checked. So after a page is saved it is opened in a headless
Chrome, Chromium or Edge, whichever the machine has, under the same
sandbox the writer's tab gets, and what went wrong comes back to the agent
with a picture of the page, as a figure script's does.

Nothing is installed for this. Every Windows has Edge, most desktops have
Chrome or Chromium, and `NEXTTEX_BROWSER` names one anywhere else. With
none, the answer says the page was not looked at and why, rather than
saying nothing. The browser is driven by its own command line, twice and
side by side: once for the page as its scripts left it, with the console
written to stderr, and once for a screenshot. The page is served from a
throwaway server on a loopback port that answers for the page and for the
KaTeX files a page may load, and for nothing else.
"""

from __future__ import annotations

import os
import platform
import re
import shutil
import subprocess
import tempfile
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field
from html.parser import HTMLParser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

#: Long enough for a page's scripts and its Google font, short enough that
#: a page that never settles does not hold the agent's turn. What the
#: browser said by then is still read.
TIMEOUT = 20
#: How long the page's scripts get, in the browser's own virtual time,
#: before the document is read.
SCRIPT_BUDGET_MS = 3000
#: The screenshot's window: wide as a laptop's, tall enough for the top of
#: a long page.
WINDOW = (1200, 1600)

#: Where the usual browsers live when they are not on the PATH.
_KNOWN = {
    "Windows": [
        r"%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe",
        r"%ProgramFiles%\Microsoft\Edge\Application\msedge.exe",
        r"%ProgramFiles%\Google\Chrome\Application\chrome.exe",
        r"%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe",
        r"%LocalAppData%\Google\Chrome\Application\chrome.exe",
    ],
    "Darwin": [
        "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
        "/Applications/Chromium.app/Contents/MacOS/Chromium",
        "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
    ],
}
_ON_PATH = ("chrome-headless-shell", "google-chrome", "google-chrome-stable", "chromium",
            "chromium-browser", "microsoft-edge", "microsoft-edge-stable", "msedge", "chrome")
#: Chrome's own headless shell, as Playwright and Chrome for Testing leave
#: it. Preferred where it is: a full browser driven headless can take its
#: time to exit, and on one Linux desktop never printed the page at all.
_SHELLS = ("~/.cache/ms-playwright/chromium_headless_shell-*/*/chrome-headless-shell",
           "%LocalAppData%/ms-playwright/chromium_headless_shell-*/*/chrome-headless-shell.exe",
           "~/Library/Caches/ms-playwright/chromium_headless_shell-*/*/chrome-headless-shell")


def find_browser() -> str | None:
    """A Chromium-family browser's executable, or None."""
    named = os.environ.get("NEXTTEX_BROWSER", "").strip()
    if named:
        return named if Path(named).is_file() else None
    for pattern in _SHELLS:
        expanded = os.path.expanduser(os.path.expandvars(pattern))
        found = sorted(Path("/").glob(expanded.lstrip("/"))) if expanded.startswith("/") else []
        if found:
            return str(found[-1])
    for name in _ON_PATH:
        found = shutil.which(name)
        if found:
            return found
    for raw in _KNOWN.get(platform.system(), []):
        path = Path(os.path.expandvars(raw))
        if path.is_file():
            return str(path)
    return None


def katex_files() -> Path | None:
    """Where this install keeps the KaTeX pages load: the built interface's
    copy, or the development tree's."""
    root = Path(__file__).resolve().parent.parent / "frontend"
    for folder in (root / "dist" / "assets" / "katex", root / "node_modules" / "katex" / "dist"):
        if (folder / "katex.min.js").is_file():
            return folder
    return None


@dataclass
class Look:
    """What opening a page found."""

    #: Uncaught errors and refused loads, each with its line where the
    #: browser gave one.
    errors: list[str] = field(default_factory=list)
    #: Maths that came out empty, and KaTeX's own complaints.
    blanks: list[str] = field(default_factory=list)
    #: The top of the page as drawn, a PNG, or None.
    picture: bytes | None = None
    #: Set when the page was not looked at, saying why.
    unchecked: str = ""
    #: The page has no dark colours, so it stays light in a dark NextTex.
    themeless: bool = False

    @property
    def clean(self) -> bool:
        return not self.unchecked and not self.errors and not self.blanks and not self.themeless


def look(html: str, katex_dir: Path | None, browser: str | None = None) -> Look:
    """Open `html` as the writer's browser will and say what went wrong."""
    browser = browser or find_browser()
    if browser is None:
        return Look(unchecked=(
            "No Chrome, Chromium or Edge was found on this machine, so the page "
            "was not opened to check it. NEXTTEX_BROWSER can name one."))
    server = _serve(html.encode("utf-8"), katex_dir)
    url = f"http://127.0.0.1:{server.server_address[1]}/"
    try:
        with ThreadPoolExecutor(max_workers=2) as pool:
            read = pool.submit(_run, browser, ["--enable-logging=stderr", "--v=0",
                                               f"--virtual-time-budget={SCRIPT_BUDGET_MS}",
                                               "--dump-dom", url],
                               lambda out, _err: "</html>" in out)
            shot = pool.submit(_picture, browser, url)
            dom, log = read.result()
            picture = shot.result()
    except OSError as error:
        return Look(unchecked=f"The browser could not open the page: {error}.")
    finally:
        server.shutdown()
        server.server_close()
    found = Look(errors=_errors(log), picture=picture, themeless=not _THEMED.search(html))
    found.blanks = _blanks(dom)
    if not dom.strip() and not found.errors:
        # Named, since which browser it was is the first question: a full
        # Chrome driven headless can sit on `--dump-dom` until it is killed,
        # as Ubuntu's google-chrome did on CI on 26 October 2026, where the
        # headless shell answers in under a second.
        found.unchecked = (f"The browser opened the page but had not read it back after "
                           f"{TIMEOUT} seconds ({Path(browser).name}).")
    return found


def _serve(page: bytes, katex_dir: Path | None) -> ThreadingHTTPServer:
    """A loopback server for one page and the KaTeX it may load, under the
    policy the writer's tab gets, on a port of its own."""
    from .pages import policy

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *args):  # the check's own noise is nobody's
            pass

        def do_GET(self):
            origin = f"http://{self.headers.get('Host', '127.0.0.1')}"
            if self.path == "/":
                self._send(page, "text/html; charset=utf-8", {"Content-Security-Policy": policy(origin)})
                return
            if katex_dir is not None and self.path.startswith("/assets/katex/"):
                relative = self.path[len("/assets/katex/"):].split("?")[0]
                target = (katex_dir / relative).resolve()
                if target.is_file() and katex_dir.resolve() in target.parents:
                    kind = {".js": "text/javascript", ".css": "text/css",
                            ".woff2": "font/woff2"}.get(target.suffix, "application/octet-stream")
                    self._send(target.read_bytes(), kind, {"Access-Control-Allow-Origin": "*"})
                    return
            self.send_response(404)
            self.end_headers()

        def _send(self, body: bytes, kind: str, extra: dict):
            self.send_response(200)
            self.send_header("Content-Type", kind)
            for key, value in extra.items():
                self.send_header(key, value)
            self.end_headers()
            self.wfile.write(body)

    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    return server


def _flags(profile: str) -> list[str]:
    return ["--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check",
            "--hide-scrollbars", f"--user-data-dir={profile}",
            # A container's root cannot use the browser's own sandbox; the
            # page is still under its policy's sandbox, which is the one
            # that keeps it from NextTex.
            *(["--no-sandbox"] if hasattr(os, "geteuid") and os.geteuid() == 0 else []),
            f"--window-size={WINDOW[0]},{WINDOW[1]}"]


def _run(browser: str, extra: list[str], done=lambda out, err: False) -> tuple[str, str]:
    """Run the browser until it exits, `done` says it has said enough, or
    the time is up, and return what it printed by then. A browser that
    printed the page and then took its time to exit is not waited for."""
    out: list[str] = []
    err: list[str] = []
    with tempfile.TemporaryDirectory() as profile:
        process = subprocess.Popen([browser, *_flags(profile), *extra], stdout=subprocess.PIPE,
                                   stderr=subprocess.PIPE, text=True, errors="replace")
        readers = [threading.Thread(target=lambda: out.extend(process.stdout), daemon=True),
                   threading.Thread(target=lambda: err.extend(process.stderr), daemon=True)]
        for reader in readers:
            reader.start()
        deadline = time.monotonic() + TIMEOUT
        try:
            while process.poll() is None and time.monotonic() < deadline:
                if done("".join(out), "".join(err)):
                    break
                time.sleep(0.05)
        finally:
            if process.poll() is None:
                process.kill()
            process.wait()
            for reader in readers:
                reader.join(timeout=2)
    return "".join(out), "".join(err)


def _picture(browser: str, url: str) -> bytes | None:
    with tempfile.TemporaryDirectory() as scratch:
        out = Path(scratch) / "page.png"
        _run(browser, [f"--virtual-time-budget={SCRIPT_BUDGET_MS}", f"--screenshot={out}", url],
             done=lambda _out, err: "written to file" in err)
        return out.read_bytes() if out.is_file() else None


#: A console line from the browser's log: `...:CONSOLE:12] "message", source: url (12)`.
_CONSOLE = re.compile(r':CONSOLE(?::|\()(\d+)\)?\] "(.*)", source: (?:\S*)? ?\((\d+)\)')
#: Which of the page's console lines are problems rather than its own logging.
_PROBLEM = re.compile(r"^(Uncaught|Refused to|Access to|Failed to load|Error|Warning: KaTeX|KaTeX)")


def _errors(log: str) -> list[str]:
    found: list[str] = []
    for match in _CONSOLE.finditer(log):
        message, line = match.group(2), match.group(3)
        if not _PROBLEM.search(message):
            continue
        text = f"{message} (line {line})" if line not in ("", "0") else message
        if text not in found:
            found.append(text)
    return found[:20]


#: Maths delimiters still in the page's text after KaTeX has run: a brace
#: left open makes auto-render pair the dollars wrongly, and everything
#: after it on the line stays as source, with no error anywhere.
_LEFT_AS_TEXT = re.compile(r"\$\$?[^$\n]{1,200}?\$\$?|\\\[|\\\(")
_VOID = {"area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta",
         "source", "track", "wbr"}


class _Reader(HTMLParser):
    """Reads the page as its scripts left it, for maths that came out
    empty, KaTeX's own errors, which it draws in place with the message in
    the title, and, on a page that loads KaTeX, maths it never reached."""

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.blanks: list[str] = []
        self.loads_katex = False
        self.text: list[str] = []
        self._math: list[list[str]] = []
        self._open: list[bool] = []

    def handle_starttag(self, tag, attrs):
        attributes = dict(attrs)
        if tag == "script" and "katex" in (attributes.get("src") or ""):
            self.loads_katex = True
        if tag == "math":
            self._math.append([])
        classes = (attributes.get("class") or "").split()
        if "katex-error" in classes:
            title = attributes.get("title") or "KaTeX could not set this"
            self.blanks.append(title.replace("ParseError: ", "KaTeX: ")[:300])
        if tag not in _VOID:
            hidden = tag in ("script", "style", "code", "pre") or any(
                name.startswith("katex") or name == "no-maths" for name in classes)
            self._open.append(hidden)

    def handle_endtag(self, tag):
        if tag == "math" and self._math:
            text = "".join(self._math.pop()).strip()
            if not text:
                self.blanks.append("An equation (a <math> element) came out empty.")
        if tag not in _VOID and self._open:
            self._open.pop()

    def handle_data(self, data):
        for open_math in self._math:
            open_math.append(data)
        if not any(self._open):
            self.text.append(data)


def _blanks(dom: str) -> list[str]:
    reader = _Reader()
    try:
        reader.feed(dom)
    except Exception:  # a reader's trouble is not the page's
        return []
    for unknown in re.findall(r'<mstyle mathcolor="#cc0001"><mtext>([^<]{1,80})</mtext>', dom)[:10]:
        reader.blanks.append(f"KaTeX does not know {unknown}: define it in the project or write it another way.")
    if reader.loads_katex:
        for match in list(_LEFT_AS_TEXT.finditer("".join(reader.text)))[:5]:
            reader.blanks.append(f"Maths left as text, never set: {match.group(0)[:80]}")
    counted: dict[str, int] = {}
    for blank in reader.blanks:
        counted[blank] = counted.get(blank, 0) + 1
    return [f"{text} ({count} times)" if count > 1 else text for text, count in counted.items()][:20]


#: Dark colours a page can be given: under the root's `data-theme`, which
#: NextTex's Open sets, or for a reader whose system is dark.
_THEMED = re.compile(r"""data-theme\s*=\s*["']?dark|prefers-color-scheme\s*:\s*dark""", re.IGNORECASE)


def report(found: Look) -> str:
    """What the agent is told."""
    if found.unchecked:
        return f"Not checked: {found.unchecked}"
    if found.clean:
        return ("Opened it in a browser under the page's own sandbox: no script errors, "
                "and no maths came out empty. This is how its top looks; read it before "
                "you say it is done.")
    lines = ["Opened it in a browser under the page's own sandbox, and it has problems. "
             "Fix them and publish again before you tell the writer it is ready."]
    lines += [f"- {error}" for error in found.errors]
    lines += [f"- {blank}" for blank in found.blanks]
    if found.themeless:
        lines.append("- It has no dark colours, so it stays light when the writer's NextTex is dark. "
                     "Put the light colours on :root and the dark ones under :root[data-theme=\"dark\"], "
                     "and the same under @media (prefers-color-scheme: dark) { :root:not([data-theme=\"light\"]) { ... } } "
                     "for a link opened elsewhere.")
    return "\n".join(lines)
