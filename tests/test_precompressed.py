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


def test_a_hashed_asset_is_kept_by_the_browser_for_good(assets):
    """Vite names every chunk by its content, so a name that is still the
    same is a body that is still the same. Each reload used to revalidate
    every chunk and be told 304, one round trip each for an answer that
    could not change."""
    (assets / "index-BtPilmL7.js").write_bytes(b"const x = 1;\n" * 400)
    (assets / "index-BtPilmL7.js.br").write_bytes(b"brotli-bytes")
    for accept in ("br", None):
        response = fetch(assets, "index-BtPilmL7.js", accept)
        assert response.headers["cache-control"] == "public, max-age=31536000, immutable"


def test_a_name_without_a_hash_is_not_marked_immutable(assets):
    response = fetch(assets, "app.js", "br")
    assert "immutable" not in response.headers.get("cache-control", "")


def test_webassembly_is_served_compressed_with_its_own_type(assets):
    """The grammar checker's module is 16 MB and went out whole: the build
    did not compress `.wasm`. A browser compiling it while it streams needs
    `application/wasm` on the decompressed body, not the envelope's type."""
    (assets / "harper_wasm_bg-BEyNQVrT.wasm").write_bytes(b"\0asm" + b"\0" * 4096)
    (assets / "harper_wasm_bg-BEyNQVrT.wasm.br").write_bytes(b"brotli-bytes")
    response = fetch(assets, "harper_wasm_bg-BEyNQVrT.wasm", "gzip, deflate, br")
    assert response.headers["content-encoding"] == "br"
    assert response.headers["content-type"] == "application/wasm"


def test_the_build_compresses_webassembly_and_module_workers():
    """`precompress.mjs` decides what gets a compressed copy; the two
    largest files the interface ships were outside its list."""
    script = (Path(__file__).resolve().parent.parent / "frontend" / "precompress.mjs").read_text()
    listed = script.split("const WORTH_IT", 1)[1].split("\n", 1)[0]
    assert '".wasm"' in listed and '".mjs"' in listed
