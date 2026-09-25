"""How long one keystroke on one peer takes to reach another.

Not a check: a review driver, run by hand from the repository root with
`.venv/bin/python e2e/review/q-collab-keystroke.py`.  Two loopback peers
share a project; one character at a time is typed into Alice's document,
and the time until Bob's document holds it is printed, over the in-process
transport the tests use.  It says what NextTex's own path costs, not what
a network adds.
"""
import asyncio, statistics, sys, tempfile, time
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from tests.collab.conftest import Peer, join_up, until
from server.collab import transport

async def main():
    transport.HUB.clear()
    base = Path(tempfile.mkdtemp(prefix="nexttex-keystroke-"))
    text = "The chapter.\n" + "A line of a thesis, long enough to be a paragraph.\n" * 800
    alice = Peer(base / "alice", {"main.tex": text}).be("a" * 16)
    bob = Peer(base / "bob", {}).be("b" * 16)
    await join_up(alice, bob)
    fid = alice.store.file_id_for("main.tex")
    assert await until(lambda: bob.store.file_id_for("main.tex") == fid, 10)
    bob.open_documents()
    a_text = alice.store.body(fid)
    assert await until(lambda: (bob.store.body(fid) is not None and len(str(bob.store.body(fid))) == len(str(a_text))), 20)
    took = []
    for i in range(60):
        mark = f"<{i}>"
        t = time.perf_counter()
        with alice.store.texts[fid].transaction():
            a_text.insert(len(str(a_text)) // 2, mark)
        ok = False
        deadline = time.perf_counter() + 5
        while time.perf_counter() < deadline:
            if mark in str(bob.store.body(fid)):
                ok = True
                break
            await asyncio.sleep(0.001)
        took.append((time.perf_counter() - t) * 1000 if ok else float("inf"))
    took.sort()
    print(f"keystroke to the other peer, {len(took)} edits in a {len(text)//1024} kB file: "
          f"median {statistics.median(took):.1f} ms, p90 {took[int(len(took)*0.9)]:.1f}, worst {took[-1]:.1f}")
    await alice.close(); await bob.close()

asyncio.run(main())
