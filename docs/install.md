# Installing, running and updating NextTex

The README gives the one line that installs NextTex and the three steps
after it. This document is everything else: what the installer asks and
does, how to start and stop the server by hand on each platform, how an
update works, how to remove an install completely, what NextTex needs from
the machine, and what has and has not been verified on Windows.

## Installing

```bash
curl -fsSL https://raw.githubusercontent.com/dakshitha-a/NextTex/master/scripts/install.sh | sh
```

On Windows, in PowerShell:

```powershell
irm https://raw.githubusercontent.com/dakshitha-a/NextTex/master/scripts/install.ps1 | iex
```

`iex` has no way to pass an argument, so if you want to answer something in
advance rather than being asked, build the script block instead:

```powershell
& ([scriptblock]::Create((irm https://raw.githubusercontent.com/dakshitha-a/NextTex/master/scripts/install.ps1))) -Dir 'D:\NextTex'
```

**It asks you two things, and it shows you everything before it asks either
one.**

The first is where to put itself. It offers `~/apps/NextTex`; press return to
take that, or type any empty directory you like. This one has to come first,
because until it has cloned there is nothing to look at yet. If you would
rather not be asked, `--dir=PATH` or the `NEXTTEX_DIR` variable answers in
advance, and an install running somewhere with no terminal just takes the
default. Your own projects live outside this directory and are never touched
by an install, an update or an uninstall.

Then it looks at your machine, all of it, before another word, and tells you
what it found in four groups:

- what is already here,
- what it is going to download, and how big each one is,
- **what you will have to install yourself**, with the command to do it on
  your platform,
- and what is missing but does not matter.

After that comes the plan: a numbered list of what it will do, what the whole
thing will download, roughly how long that takes, and anything it writes
outside this one directory.

That plan is the second question. Press return to accept it, type a number to
change that one item, or `q` to stop. Once it starts working, nothing
interrupts you again.

`git` is the only thing you need beforehand, and `curl` if there is no
Python on the machine at all, since that is what fetches one. Python, TeX
and the Claude CLI are all fetched for you if they are missing and you
asked for them. If you would rather read the script before you run it,
clone the repository yourself and run `scripts/install.sh` from inside it.
It does the same thing either way, except that it then installs into the
checkout you are standing in instead of asking where to go.

The first install takes a while, mostly because TeX is a large download. This
is the same bargain as the first time you set up a scientific Python stack:
one slow afternoon, and then it is just there. Every long step shows you how
long it has been running and the last line the tool itself printed, so a slow
mirror looks like a slow mirror rather than a hang. If something does fail,
you get the actual error, the path to the full log, and an installer that
stopped rather than one that carried on and told you it was ready. Run it
again afterwards and it picks up where it left off.

At the end it prints a URL with an access token in it, exactly like the link
`jupyter notebook` gives you. That is how you get in the first time. NextTex
then offers to set a password, and after that any browser signs in with the
password instead. You can skip that, and the URL stays the only way in, which
is fine on a machine only you can reach.

> [!WARNING]
> Anyone who has that URL can read and edit your projects, password or not,
> because it is also the way back in if you forget the password. Treat it like
> a password itself, and do not put NextTex on the open internet.

### What the installer actually does

`scripts/install.sh` and `scripts/install.ps1` are short bootstraps. They do
only what has to happen before any Python is known to exist: refuse a platform
they are not for, check for `git`, ask where the checkout goes, clone it, and
find an interpreter. Any Python 3.10 or newer will do, and if the machine has
none at all they say so and fetch `uv`, which brings its own. Then they hand
over to `python -m nexttex.install`, which is the same code on Linux, macOS
and Windows.

**The survey.** It looks for `git`, and for the Python that is running it
and whether that Python can make a virtual environment at all: Debian and
Ubuntu ship one that cannot, which used to be the most common way a first
install failed. It looks for `uv`, and for a `.venv` that is already here.
It looks for a TeX installation wherever TinyTeX, MacTeX, MiKTeX or TeX Live
puts one, and says which of `latexmk`, `biber`, `synctex`, `chktex` and
`texcount` are missing from it. It looks for `pdftotext`, `pandoc`,
`claude`, `tailscale` and Node, for whether this machine can start things at login,
and for whatever configuration a previous install left. It also opens a
two-second connection to each host it may need, so being offline is
something you are told rather than something you wait three minutes to
discover.

**The plan.** A virtual environment and the Python dependencies, with `iroh`
and `resvg` tried separately, from wheels only, so a platform with no build
for one loses sharing, or SVG figures drawn as pictures in a Word download,
rather than the install; the survey says which. TinyTeX if you want one, or MiKTeX on Windows, and `tlmgr` to
add whichever of the five tools are missing. The TeX it installs is the
one NextTex builds with afterwards, even on a machine that already had
another: the installer writes it down in the install's `config.json` as
`tex`, and `NEXTTEX_TEX`, a directory, overrides both. A writing agent, if any.
Nothing is installed unless you say Claude, the default is none, and the app
asks again, in a sheet over its projects list, the first time it opens. The interface built for this commit,
downloaded rather than built, with Node 22.13+ used only if that download
fails. Whether the server answers on localhost only or also on your tailnet.
And a `systemd --user` unit on Linux, a launchd agent on macOS, or a logon
task on Windows, written only if you asked for one.

All of it is idempotent. Run it again after installing something it said was
missing and it picks up where it left off without touching your projects.

## Running it

The installer sets NextTex to start at login, and puts a shortcut on your
desktop. The shortcut opens NextTex in your browser, and starts it first if
nothing is running, so it works whether or not you kept the start-at-login
step. It runs the app rather than storing the address, so it does not go
stale and it holds no copy of your access token. On a machine with no
desktop, which is the usual shape of a Linux box you reach from somewhere
else, the installer says so and skips it. Say no on the plan screen, or pass
`--no-shortcut`, if you would rather not have one.

To control the server by hand:

**Linux**

```bash
systemctl --user start nexttex
systemctl --user stop nexttex
systemctl --user restart nexttex
systemctl --user status nexttex
journalctl --user -u nexttex -f        # follow the log
```

`systemctl --user disable nexttex` stops it starting at login, and `enable`
puts it back.

**macOS**

```bash
launchctl load   ~/Library/LaunchAgents/com.nexttex.server.plist
launchctl unload ~/Library/LaunchAgents/com.nexttex.server.plist
tail -f ~/.local/share/nexttex/server.log
```

**Windows**, in PowerShell:

```powershell
Start-ScheduledTask -TaskName NextTex
Stop-ScheduledTask  -TaskName NextTex
```

Registering that task wants administrator, so on an ordinary account
`scripts\register-task.ps1`, which is what the installer calls for this,
falls back to a shortcut in your Startup folder and says which it used. If
it is the shortcut, there is no task to start or stop: run
`.venv\Scripts\python.exe -u server\run.py` to start it, or open the
`nexttex` shortcut itself, and end the `python` process running
`server\run.py` to stop it. `shell:startup` in the Run box opens the folder
the shortcut is in.

The task and the shortcuts run `pythonw.exe`, the interpreter with no
window, so there is no terminal window holding NextTex that closing would
stop it with. Each starts it with `--log-to-state`, which sends everything
it prints to `server.log` and `server.err.log` beside the install log, so
a server that will not start has left its last words there however it was
started, and nothing it runs for you, a build or a git command, opens a
window of its own. An install set up before 3.17.2 has a task that still
runs `python.exe`; run `scripts\register-task.ps1` once more, as the
installer does, to move it over.

If NextTex stops on its own, the task starts it again within five minutes,
as a Linux or Mac service does straight away. `Stop-ScheduledTask` stops it
for good until the next sign-in or the next five minutes, so to keep it
stopped, disable the task: `Disable-ScheduledTask -TaskName NextTex`. An
install set up before 3.18.7 has a task that only starts at sign-in; run
`scripts\register-task.ps1` once more to give it the second trigger. If
the task was first made from an administrator PowerShell, Windows lets
only an administrator change it. The script then asks for administrator
itself, with Windows' usual "Allow changes?" prompt. Click Yes and the
task gets its restart. Click No and the task is kept as it was; running
the script once from an administrator PowerShell does the same later.

**Any platform.** To print the URL and token again, which is the way back in
if you have forgotten the password. A server started as a service prints
its address to its log and never the token, which is what this is for:

```bash
.venv/bin/python server/run.py --print-url
```

To choose a new password from the machine itself, which also signs every
browser out. Restart NextTex afterwards: a running server read its settings
when it started and is still checking against the old one.

```bash
.venv/bin/python server/run.py --set-password
```

To run it in the foreground instead, which is the quickest way to see why it
will not start:

```bash
.venv/bin/python server/run.py
```

If you installed a second copy with `--instance NAME`, every name above gains
the same suffix: the service is `nexttex-NAME`, its state lives in
`~/.local/share/nexttex-NAME`, and the interface carries a badge so you can
tell the two apart. Running `server/run.py` by hand for that copy takes
`--instance NAME` as well, which is what its shortcut and its login task
pass; without it you are talking to the first install.

## Keeping it up to date

`./scripts/update.sh` pulls, reinstalls, rebuilds and restarts, or
`scripts\update.ps1` on Windows. Your projects live outside this directory and
neither script touches them.

You can also update from the project list. NextTex checks once when that
screen opens and, if the repository is ahead, the update button at the top
right of the screen turns the pen colour with a small ring; press it for the
commit subjects and an Update button. It restarts itself afterwards and the
page comes back on its own.

An update is offered only once its tests have passed on GitHub, so a version
still being tested waits, usually for ten minutes or less, and one that failed
its tests is not offered at all. If an update does not start, NextTex goes
back by itself to the version it was running: after three starts that never
settle, it returns to the commit it left and the interface that went with it,
and the update sheet says so the next time you open the list. The version it
went back from is not offered again; the next one is.

It is deliberately quiet. Commits that change only documentation or tests are
reported as *"three new commits, none of which change NextTex"*, a grey line
rather than an alert, and a check that cannot reach GitHub says nothing unless
you asked for it.

NextTex has a version number. The app bar carries it beside the name, and
the update sheet says what it means: *"NextTex 1.0.0, up to date"* when
there is nothing to do, and *"NextTex 1.1.0 is available"* ahead of the
commit count when there is.
The number moves the way you would expect: the last part for fixes, the
middle for something new you can see or do, the first when an update needs
more than an update. In a terminal, `python3 -m nexttex.version` prints it
with the commit the code is on and the one the interface was built from,
and the [releases page](https://github.com/dakshitha-a/NextTex/releases)
lists what each version changed.

**Not now** puts the commit list away without losing it. The sheet then
says *"An update is waiting"* with a **Show it** beside it, and the button on
the app bar keeps its ring, so you can come back and update on an afternoon
that suits you rather than having to remember. The list stays away on its
own until you ask.

An update that has landed on disk without the server being restarted is its
own case, and the sheet says so before it says anything about GitHub:
*"Updated on disk to abc1234. Restart to run it."* The running process
reports the commit it started with, which is the only commit it can honestly
claim; the files are a separate fact and are reported beside it. Without that
pair, an install updated by hand and not restarted reported the new commit,
matched it against the remote and called itself up to date, three times over,
while serving the old code.

Both scripts write to `update.log` beside `install.log`, in
`~/.local/share/nexttex/` on every platform, Windows included. An update is the
operation most likely to leave a machine in a state its owner cannot explain,
so it leaves a record the way the install does. The file is appended to, again
the way `install.log` is, so it holds every update this install has ever run:
the last block is the one you want, and it is the one to send if you are asking
for help. The report described in [bug-reports.md](bug-reports.md#writing-a-report)
quotes that block for you.

## Uninstalling

Four things to remove, in this order: the service, the desktop shortcut,
the install, and the state directory. Your projects are in none of them.

**Your project *files* survive; your project *list* does not.** The state
directory holds `projects.json`, so an uninstall takes NextTex's memory of
which folders were yours with it. Every folder is still there, with its
`.nexttex` directory and so with its history and its trash, but a fresh
install opens on an empty list and you point it at each project again.
If you are uninstalling in order to reinstall, copy `projects.json` out
first and put it back afterwards and there will be nothing to redo. This
was learned by following this section on a real machine on 23 September
2026 and then wondering where the projects had gone.

**Linux**

```bash
systemctl --user disable --now nexttex
rm ~/.config/systemd/user/nexttex.service
systemctl --user daemon-reload
rm -f ~/Desktop/NextTex.desktop
rm -rf ~/apps/NextTex ~/.local/share/nexttex
```

**macOS**

```bash
launchctl unload ~/Library/LaunchAgents/com.nexttex.server.plist
rm ~/Library/LaunchAgents/com.nexttex.server.plist
rm -f ~/Desktop/NextTex.command
rm -rf ~/apps/NextTex ~/.local/share/nexttex
```

**Windows**, in PowerShell:

```powershell
Stop-ScheduledTask -TaskName NextTex -ErrorAction SilentlyContinue
Unregister-ScheduledTask -TaskName NextTex -Confirm:$false -ErrorAction SilentlyContinue
Get-CimInstance Win32_Process | Where-Object { $_.ProcessId -ne $PID -and $_.CommandLine -like '*apps\NextTex\server\run.py*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }
Remove-Item "$([Environment]::GetFolderPath('Startup'))\NextTex.lnk" -ErrorAction SilentlyContinue
Remove-Item "$([Environment]::GetFolderPath('Desktop'))\NextTex.lnk" -ErrorAction SilentlyContinue
Remove-Item -Recurse -Force "$HOME\apps\NextTex", "$HOME\.local\share\nexttex"
```

The third line stops a server that the Startup shortcut started, which no
task knows about. Windows will not delete a program that is running, so
the folder cannot go until the server has.

`$_.ProcessId -ne $PID` in that line is not decoration. The filter reads
every process's command line and looks for the install's path in it, and
a shell that was *given this block as text* has that path in its own
command line, so without the exclusion the line kills the shell running
the uninstall and lines four, five and six never happen. Pasting the
block at a PowerShell prompt is safe, because an interactive shell's
command line is just the executable; it bites when the block is passed
with `powershell -Command`, or by any script or tool that wraps it. The
failure looks exactly like success, since the server does stop and
NextTex does disappear from the browser, while the install directory, the
state directory and both shortcuts are still there. Found on a real
machine on 23 September 2026, by a run that did exactly that.

**Your projects keep their own state, and this does not remove it.** Every
project you opened has a `.nexttex` directory inside it holding that
project's history, its trash, the agent's transcript and context, and
anything the library imported. That is the project's, not the install's,
which is why it lives with the project and survives all of the above: a
copy of the folder carries its past with it, and reinstalling NextTex
finds everything where it was. If you want a project's NextTex state gone
as well, delete the `.nexttex` directory inside that project. On a machine
with a few projects and a full trash this can be the largest thing the
uninstall leaves, and `~/apps` is left behind empty if NextTex was the
only thing in it.

If you installed somewhere else with `NEXTTEX_DIR`, that is the directory to
remove instead. If you installed a second copy with `--instance NAME`, every
name above gains the same suffix (`nexttex-NAME`, `com.nexttex.server-NAME`,
`~/.local/share/nexttex-NAME`) and the copies are independent, so removing
one leaves the others alone.

Everything NextTex fetched for itself is inside the install directory,
including the `uv` it may have downloaded and the Python environment, so
deleting the folder really does remove them. The state directory holds
`config.json`, which holds your token, your password and your list of
projects, so it goes too.

**What this does not remove**, deliberately:

- **Your projects.** They were never inside the install; the registry held
  paths. Each still has its `.nexttex/` beside it with the version history
  and the trash in it, and deleting that is a separate decision. The section
  below on [a project on disk](guide.md#a-project-on-disk) says what is in there.
- **TeX.** TinyTeX at `~/.TinyTeX`, or `~/Library/TinyTeX` on macOS, is
  about 460 MB and is a normal TeX installation that anything else on the
  machine can use. `tlmgr` did not put anything NextTex-specific in it.
- **The Claude CLI**, and whatever account it is signed in to. NextTex never
  held those credentials, so removing NextTex does not sign you out.

One thing worth knowing before you do it on a shared project: the state
directory holds this install's identity as a peer. Remove it and reinstall
and you are a *new* peer to your collaborators, with a different public key,
and somebody will have to invite you back. Your files and their history are
untouched either way. It is the collaborative link that is lost, which is
the same thing that happens when somebody removes you.

## Your first session

About twenty minutes, most of it TinyTeX downloading. Open the URL, choose
an agent or none in the sheet that greets you, and open
`examples/minimal-article` as a project from the *Other ways in* menu
beside *New project*. It typesets as it opens. Type a sentence into the
abstract and the page follows about two seconds later; double-click a
paragraph on the page to jump back to the line that set it. The full walkthrough, with a deliberate error, the version
history and a GitHub backup, is in
[docs/first-session.md](first-session.md).

## Windows

### On Windows, verified in more places than it used to be

Windows support is written, and most of it has now been run end to end on
a real laptop rather than only on a runner. On 22 and 23 September 2026,
on Windows 11 with an account that is an administrator but runs
unelevated, all of this happened in one sitting and each line of it found
something:

- the documented `irm ... | iex` install, from nothing to a working
  install, including MiKTeX fetched by the installer;
- the uninstall, by the six lines *Uninstalling* gives above, which is how we
  learned that one of them could kill the shell running it;
- the update button twice, once carrying an install a hundred and
  seventy-six commits forward in one step, with the restart helper
  bringing the server back each time;
- the **logon task**, registered, rebooted into, and starting the server
  by itself, which this section called unproven for a year;
- the desktop shortcut, from a OneDrive-redirected Desktop, starting a
  server and opening a browser on it;
- a server left alone overnight through nine sleep cycles, still serving
  in the morning.

The whole install after the clone is the same Python that Linux and macOS
run, so what used to be Windows-only code is now Windows-only *branches*
of code the test suite exercises on every platform, including the
console-encoding fallback that a legacy code page needs.

**What is still unproven**, with the reason for each. Signing in to Claude
from the browser needs a pseudo-terminal, which Windows does not have, so
run `claude auth login` in a terminal once or use an OpenAI key. The
drawer's *Install* button has never run against a real MiKTeX package
manager: the machine that finally had one had a mismatched toolchain, one
distribution's engine reading another's package tree, and a result from
that would have meant nothing either way. The interactive prompts have
never been answered by a person on Windows, because every automated run
arrives with a redirected input and takes the unattended path. And no
Intel Mac has run any of it.

**Two things worth knowing if you run it there.** A server started by the
logon task took about five minutes from boot to answering on its port,
where the same build started from the desktop shortcut took twenty-five
seconds, so if you reboot and look straight away you may think it did not
start. And if you have two TeX distributions installed, check the TeX line
in *Report a problem*: it now says when the engine on your PATH belongs to
a different distribution from the one NextTex found, which is worth fixing
before you wonder why a one-page document takes a minute and a half.

Reports welcome.

## Requirements

The last column has three states. **Named** is the middle one: the
installer will not fetch it, but it tells you so on its survey, before it
asks you anything, with the command for the platform you are on, so you can
install it and run the installer again.

| What | Why | Supplied by the installer? |
|---|---|---|
| `git` | NextTex is a checkout, and stays one so it can update itself | **named** |
| Python 3.10+ | The server | yes, and `uv` brings one if this machine has none |
| Node 22.13+ | Only to build the interface locally, if the prebuilt one cannot be downloaded | **named** |
| `pdflatex`, `latexmk`, `synctex` | Typesetting and the two-way jump | yes: TinyTeX, or MiKTeX on Windows, if you let it |
| `biber` | biblatex bibliographies | yes, via `tlmgr` |
| `chktex`, `texcount` | Linting and word counts | yes, via `tlmgr` |
| `pdftotext` | Only for reading a folder of papers into your `.bib`, and for PDF figures in a Word download | **named**, and it comes with poppler-utils |
| `pandoc` | Only to download a document as Word, HTML or Markdown | **named** |
| The [Claude CLI](https://claude.ai/download) | Only for the Claude agent | yes, if you choose it, at install time or later from the settings sheet |
| An OpenAI API key | Only for the OpenAI agent | no, you paste it into the app |
| `gh`, signed in | Only for *Back this up to GitHub* | no |
| `tailscale` | Only to reach this install from another machine | **named** |
| iroh | Only to share a project with another writer | yes, with the Python dependencies |
| resvg | Only to turn an SVG figure into a picture for a Word download; `rsvg-convert` or Inkscape do instead | yes, with the Python dependencies, where a wheel exists |
| ImageMagick (`magick`) | Only to make a PNG of a TIFF, BMP or HEIC picture you attach for the agent | **named** |

Nothing in the bottom half of that table is needed to write and typeset.

### What it costs to leave running

NextTex is meant to be left switched on, so what it uses while nothing is
happening matters more than what it uses at its peak. Measured on Linux, on
an install configured for Claude, with the thesis-shaped project the
benchmarks use, which is forty source files and two megabytes of LaTeX:

| | |
|---|---|
| Memory, idle | about 90 MB |
| Memory, with a forty-file project open | about 91 MB |
| Processor, idle | 0.1% of one core |
| The state directory | tens of kilobytes |

The number that surprises people is the third one: an idle NextTex is
genuinely idle. There is no polling loop and no scheduled work. The file
watcher waits on the operating system, and a build only happens because you
typed something. Choosing no agent, or OpenAI, takes the idle figure to about
60 MB, because the Claude SDK is the larger part of it.

What is *not* in those numbers is `latexmk`, which is a separate process that
starts when a build does and exits when it finishes. A big build is the one
time NextTex will use a whole core, and that is TeX rather than NextTex.

On disk, an install is about 300 MB, nearly all of it the Python virtual
environment. TeX is much larger than everything else here, since TinyTeX is
about 460 MB installed, and it goes outside NextTex, shared with anything
else on the machine that typesets.

Your projects are the rest, and they are yours: the version history is
compressed and content-addressed, so a year of writing is usually smaller
than the PDF it produces.

## Access, TLS, and why Tailscale is in here

The installer prints a URL carrying a token, which is how the first browser
gets in. That browser is then asked to set a password, the way JupyterLab
does, and once there is one every browser after it gets a sign-in page.
Signing in issues *that browser* its own session rather than handing it the
install's token, so no browser is holding the master credential. The
settings sheet can sign the others out, which is useful when the one you
left signed in is a laptop you no longer have. The token stays as the way
back in, as a query parameter or an `x-nexttex-token` header, so scripts
are unaffected and a forgotten password is recoverable from the machine
itself.

On localhost it is plain HTTP, so a password typed at the machine's own
browser crosses nothing but the loopback; any address another machine can
reach is served over TLS, with a certificate from `tailscale cert` where your
tailnet has HTTPS and a self-signed one otherwise. A password never crosses a
network in the clear.

This is a separate question from who may sync with you. The password decides
which *browsers* may drive this install; a collaborator's public key decides
which *installs* may exchange documents with it. Neither one grants the other.

Signing in to Claude drives the CLI's own login and the credentials land where
the CLI keeps them, so NextTex never sees or stores them. An OpenAI key goes
in the instance's config file, `chmod 600`.

Tailscale is in here because the machine you want to write on is often not the
one you are sitting at: a lab workstation, a compute server, the box the data
lives on. The usual answer is an SSH tunnel each time, or a reverse proxy and
a certificate and a hostname to maintain. Choose Tailscale at install time
instead and the server also answers on your tailnet address, over TLS,
reachable from your own devices and nothing else. The machine can sit behind a
university firewall with no inbound route and still be the one you write on
from a train. If you only ever write at the desk it is installed on, say
localhost and skip it.
