"""A second project's package install says what it is waiting for.

Q-020: TeX's packages are installed one at a time for the whole computer,
which is right, and a second project's Install waited on that lock for up
to five minutes saying nothing. The package being installed is named while
it runs, and the drawer asks for it while it waits.
"""

import asyncio

from nexttex import texpkg


def test_the_package_being_installed_is_named_while_it_runs(client, monkeypatch):
    monkeypatch.setattr(texpkg, "manager_here", lambda: ("tlmgr", "/usr/bin/tlmgr"))
    started = asyncio.Event()

    async def slow(argv, timeout):
        started.set()
        await asyncio.sleep(0.3)
        return 0, ""

    monkeypatch.setattr(texpkg, "_run", slow)

    async def both():
        first = asyncio.create_task(texpkg.install("siunitx"))
        await started.wait()
        during = texpkg.CURRENT
        second = asyncio.create_task(texpkg.install("lipsum"))
        await asyncio.sleep(0.05)
        still = texpkg.CURRENT
        await first
        await second
        return during, still, texpkg.CURRENT

    during, still, after = asyncio.run(both())
    assert during == "siunitx"
    assert still == "siunitx", "the second waits, and the first is the one named"
    assert after == ""


def test_the_route_says_what_is_installing(client, monkeypatch):
    monkeypatch.setattr(texpkg, "CURRENT", "siunitx")
    assert client.get("/api/tex/installing").json() == {"package": "siunitx"}
    monkeypatch.setattr(texpkg, "CURRENT", "")
    assert client.get("/api/tex/installing").json() == {"package": ""}
