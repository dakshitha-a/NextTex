"""Serving the bundle already compressed, rather than compressing it again.

Compression per request is the obvious move and the wrong one here.  On the
real bundle, Starlette's GZipMiddleware at its default level costs about
38 ms of CPU before the first byte moves; measured over loopback that took
the file from 1.9 ms to 40 ms.  Somebody running NextTex on the machine
they are sitting at -- which is most people -- would have paid twenty times
the latency to save bytes their link never had trouble with.

Compressed once at build time instead, the same file arrives in 1.6 ms and
202 kB: faster than sending it uncompressed, because there is less of it to
read and write, and smaller than anything worth computing per request.
"""

import asyncio
import gzip
from pathlib import Path

import pytest
from server.main import PrecompressedStatic


@pytest.fixture
def assets(tmp_path: Path) -> Path:
    body = b"const x = 1;\n" * 400
    (tmp_path / "app.js").write_bytes(body)
    (tmp_path / "app.js.gz").write_bytes(gzip.compress(body, 9))
    # Not real brotli -- nothing here decompresses it, and the point is
    # which bytes are handed over with which headers.
    (tmp_path / "app.js.br").write_bytes(b"brotli-bytes")
    (tmp_path / "plain.js").write_bytes(body)
    return tmp_path


def scope(path: str, accept: str | None) -> dict:
    headers = [(b"host", b"testserver")]
    if accept is not None:
        headers.append((b"accept-encoding", accept.encode()))
    return {
        "type": "http", "method": "GET", "path": f"/{path}", "raw_path": f"/{path}".encode(),
        "root_path": "", "query_string": b"", "headers": headers, "scheme": "http",
        "server": ("testserver", 80), "client": ("test", 1), "app": None,
    }


def fetch(assets: Path, path: str, accept: str | None):
    """The house style is asyncio.run at the edge; there is no async
    pytest plugin here and this needs one call, not a framework."""
    files = PrecompressedStatic(directory=assets)
    return asyncio.run(files.get_response(path, scope(path, accept)))


def test_a_browser_that_takes_brotli_gets_the_brotli_copy(assets):
    response = fetch(assets, "app.js", "gzip, deflate, br, zstd")
    assert response.headers["content-encoding"] == "br"
    # The type of what it decompresses to, not of the envelope: a browser
    # handed application/gzip downloads the file instead of running it.
    assert "javascript" in response.headers["content-type"]
    assert response.headers["vary"] == "Accept-Encoding"


def test_a_browser_that_takes_only_gzip_gets_gzip(assets):
    response = fetch(assets, "app.js", "gzip, deflate")
    assert response.headers["content-encoding"] == "gzip"
    assert "javascript" in response.headers["content-type"]


def test_a_client_that_takes_neither_gets_the_file_itself(assets):
    response = fetch(assets, "app.js", None)
    assert "content-encoding" not in response.headers
    # And it still says the answer depends on the request header, or a
    # cache between here and the browser will hand the wrong body on.
    assert response.headers["vary"] == "Accept-Encoding"


def test_a_file_with_no_compressed_copy_is_served_as_it_is(assets):
    response = fetch(assets, "plain.js", "gzip, deflate, br")
    assert "content-encoding" not in response.headers
    assert response.headers["vary"] == "Accept-Encoding"


def test_a_missing_file_is_still_a_404(assets):
    # Raised rather than returned, which is what StaticFiles does and what
    # the app already handles; the wrapper must not swallow it into a 200.
    from starlette.exceptions import HTTPException

    with pytest.raises(HTTPException) as raised:
        fetch(assets, "nothing.js", "gzip, br")
    assert raised.value.status_code == 404


def test_the_build_writes_the_compressed_copies():
    """The script the build runs, and what it refuses to bother with."""
    script = (Path(__file__).parent.parent / "frontend" / "precompress.mjs").read_text()
    assert "brotliCompress" in script and "gzip" in script
    # A PNG or a woff2 is already compressed and would only grow.
    assert ".png" not in script
    assert '"build": "vite build && node precompress.mjs"' in (
        Path(__file__).parent.parent / "frontend" / "package.json"
    ).read_text()
