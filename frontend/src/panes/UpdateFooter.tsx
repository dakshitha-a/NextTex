import { useEffect, useRef, useState } from "react";
import api, { type Instance, type Report, type UpdateReport } from "../api";
import { readStored, writeStored } from "../appearance";
import { snapshot } from "../errors";
import { standingOf } from "./update-standing";
import { Button } from "../ui/Button";
import { Heading } from "../ui/controls";
import { Sheet } from "../ui/Sheet";

/** Whether this install is behind the repository it came from.
 *
 *  It was the foot of the projects rail; it is a sheet opened from the
 *  app bar's update button now, and the button's own look is the only
 *  thing on the bar: resting, checking, or waiting with a pen-coloured
 *  dot and a pulsing ring. The check still runs once on mount, never on a
 *  timer, whether or not the sheet is ever opened, because the button
 *  has to know. Updating exits the server, so this lives on the projects
 *  screen and nowhere near an open document.
 *
 *  The rule the whole thing turns on is that this must not become a nag.
 *  It is the first screen of every session.  So the check runs once, never
 *  on a timer; a check that fails on its own is silent, and only says so
 *  when the writer asked; and commits that change nothing but documentation
 *  are mentioned in a grey line rather than presented as an update.
 */

/** What the app bar's button shows. */
export type UpdateState = "opening" | "resting" | "checking" | "waiting" | "busy" | "attention";

const DISMISSED = "nexttex.update.dismissed";

type Phase =
  /** Before the first answer.  Distinct from `resting`, which means the
   *  check has been and gone: this one draws nothing, so an install with no
   *  repository does not flash a button it could never honour. */
  | { kind: "opening" }
  | { kind: "resting" }
  | { kind: "checking" }
  /** `asked` is whether a human pressed something to get this, and it is
   *  the whole of the difference between a check that may be silenced and
   *  one that may not.  The same distinction already decides whether a
   *  failed check is reported or swallowed, four lines into `check`. */
  | { kind: "report"; report: UpdateReport; asked: boolean }
  | { kind: "updating" }
  | { kind: "restarting" }
  | { kind: "manual" }
  | { kind: "failed"; message: string }
  | { kind: "error"; message: string };

/** Report a problem, from the press to the text on the clipboard.
 *
 *  `ready` holds the report and whether the automatic copy worked. It is
 *  attempted right after the fetch because Chrome allows a clipboard write
 *  within the moment of the click; Safari and Firefox do not once an await
 *  has passed, so the card that follows has its own Copy, on its own
 *  press, which every browser honours. */
type Trouble =
  | null
  | { kind: "fetching" }
  | { kind: "ready"; report: Report; copied: boolean; shown: boolean }
  | { kind: "error"; message: string };

export default function UpdateFooter({
  onBusy,
  open,
  onClose,
  onState,
}: {
  onBusy: (busy: boolean) => void;
  /** Which sheet is up: the update's, the problem report's, or none. */
  open: "update" | "report" | null;
  onClose: () => void;
  /** The state for the app bar's button. */
  onState: (state: UpdateState) => void;
}) {
  const [phase, setPhase] = useState<Phase>({ kind: "opening" });
  const [log, setLog] = useState<string[]>([]);
  const [step, setStep] = useState("");
  const [showLog, setShowLog] = useState(false);
  const [showCommits, setShowCommits] = useState(false);
  const [trouble, setTrouble] = useState<Trouble>(null);
  /** Who this server is, asked once on mount. What is wanted from it is the
   *  pair of commits: the one this process loaded and the one on disk. */
  const [self, setSelf] = useState<Instance | null>(null);
  const startedFrom = useRef("");
  /** True once we have given up on learning which process we started from.
   *
   *  Then the question changes: not "has the nonce moved" -- there is
   *  nothing to compare against -- but "has the server been away and come
   *  back", which a failed tick followed by a successful one answers. */
  const blind = useRef(false);
  /** The live stream and the poll, so both can be shut down when this leaves
   *  the screen, and so the poll is only ever started once. */
  const source = useRef<EventSource | null>(null);
  const polling = useRef(false);
  const timer = useRef<number | null>(null);
  const wentAway = useRef(false);

  const check = async (asked: boolean) => {
    if (asked) setPhase({ kind: "checking" });
    try {
      const report = await api.updateCheck(asked);
      if (report.updating) {
        // A tab that arrives part-way through -- another window, or this
        // one reloaded -- has no idea which process it is watching, so it
        // has to learn that before the restart it is about to wait for.
        // Without this it waits out the full minute and then tells the
        // reader to restart a server that already came back.
        startedFrom.current = (await api.instance().catch(() => ({ boot: "" }))).boot;
        // Asking which process this is fails exactly when the server is
        // mid-restart, which is the reason a tab is joining in the first
        // place.  Left as an empty baseline, the first answer to arrive --
        // from the *new* process -- was adopted as the thing to wait for a
        // change from, so the comparison could never fire and the reader was
        // told a minute later to restart a server that had come back.  That
        // is the failure this whole path exists to prevent, through its own
        // error case.
        blind.current = !startedFrom.current;
        watch();
        // And start watching for the restart straight away, rather than
        // waiting for the stream to end.  The stream replays the output it
        // has collected but not the `done` event, so a tab that arrives
        // after the job finished would otherwise wait for a message that
        // has already been and gone.  The poll only ever reloads when a
        // different process answers, so starting it early costs nothing.
        waitForRestart();
        return;
      }
      setPhase({ kind: "report", report, asked });
    } catch (problem: any) {
      // A check nobody asked for stays quiet.  An install on an offline
      // tailnet must not open onto a red line every morning.
      setPhase(asked ? { kind: "error", message: problem.message } : { kind: "resting" });
    }
  };

  useEffect(() => {
    api.instance().then(setSelf).catch(() => setSelf(null));
  }, []);

  useEffect(() => {
    check(false);
    // Neither the stream nor the poll used to be shut down when this left
    // the screen: both were started from plain functions with nothing
    // holding them. In practice the projects screen locks itself while an
    // update runs, so there was no way to navigate away and this was a leak
    // rather than a fault; it is one line either way.
    return () => {
      source.current?.close();
      source.current = null;
      if (timer.current) window.clearTimeout(timer.current);
      polling.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    onBusy(phase.kind === "updating" || phase.kind === "restarting");
  }, [phase.kind, onBusy]);
  useEffect(() => {
    onState(stateOf(phase, self));
  }, [phase, self, onState]);

  // The report sheet asks for the report the moment it opens, once.
  useEffect(() => {
    if (open === "report" && trouble === null) void reportProblem();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  /** Follow an update that is already running, from any tab. */
  const watch = () => {
    setPhase({ kind: "updating" });
    source.current?.close();
    const stream = new EventSource("/api/update/stream");
    source.current = stream;
    /** Drop the stream, and only clear the ref if it is still ours: a later
     *  `watch` may already have replaced it. */
    const drop = () => {
      stream.close();
      if (source.current === stream) source.current = null;
    };
    stream.onmessage = (message) => {
      const event = JSON.parse(message.data);
      if (event.type === "output") setLog((lines) => [...lines, event.text]);
      if (event.type === "step") setStep(event.label);
      if (event.type === "failed") {
        drop();
        setShowLog(true);
        setPhase({ kind: "failed", message: event.message });
      }
      if (event.type === "done") {
        // Close it here rather than letting it drop: an EventSource whose
        // server has just exited reconnects against the new one for ever.
        drop();
        setPhase(event.restart === "auto" ? { kind: "restarting" } : { kind: "manual" });
        waitForRestart();
      }
    };
    stream.onerror = () => {
      // The server going away mid-stream is the expected ending, not a fault.
      drop();
      setPhase((current) =>
        current.kind === "updating" ? { kind: "restarting" } : current,
      );
      waitForRestart();
    };
  };

  /** Poll until a *different process* answers, then reload.
   *
   *  The nonce rather than the commit: an update that pulls nothing still
   *  restarts, and waiting for a sha that never moves would time out for no
   *  reason. */
  const waitForRestart = () => {
    // Once. `check` starts this directly when it finds a job already
    // running, and `watch` starts it again when the stream ends, so two
    // loops could share one deadline and race each other to reload.
    if (polling.current) return;
    polling.current = true;
    const deadline = Date.now() + 60_000;
    const tick = async () => {
      try {
        const now = await api.instance();
        if (blind.current) {
          // No baseline, because asking which process this was failed. If
          // the server has been unreachable since, this answer is a new
          // process and that is the news we were waiting for. If it has
          // not, the failed ask was a blip rather than a restart, and this
          // answer is still the old process: take it as the baseline after
          // all and carry on the ordinary way.
          if (wentAway.current) {
            window.location.reload();
            return;
          }
          blind.current = false;
          startedFrom.current = now.boot;
        } else if (!startedFrom.current) {
          startedFrom.current = now.boot;
        } else if (now.boot !== startedFrom.current) {
          window.location.reload();
          return;
        }
      } catch {
        /* still down; that is what we are waiting for */
        wentAway.current = true;
      }
      if (Date.now() < deadline) {
        timer.current = window.setTimeout(tick, 1000);
      } else {
        polling.current = false;
        setPhase({ kind: "manual" });
      }
    };
    timer.current = window.setTimeout(tick, 1000);
  };

  /** Leave and come back on the commit the files hold.
   *
   *  The same wait the update path uses: the page polls `boot` until a
   *  different process answers and reloads itself then, so the reader is
   *  not left refreshing to find out whether it worked. */
  const restartNow = async () => {
    try {
      startedFrom.current = (await api.instance()).boot;
      polling.current = false;
      blind.current = false;
      wentAway.current = false;
      await api.restart();
      setPhase({ kind: "restarting" });
      waitForRestart();
    } catch (problem: any) {
      setPhase({ kind: "error", message: problem.message });
    }
  };

  const start = async () => {
    try {
      startedFrom.current = (await api.instance()).boot;
      await api.startUpdate();
      setLog([]);
      setStep("");
      // A fresh run gets fresh guards, or a retry after a failed update
      // would find the poll already marked as started and never reload.
      polling.current = false;
      blind.current = false;
      wentAway.current = false;
      // A failure opens the log, so a retry after one would otherwise start
      // with it already expanded: a different card from the first attempt's.
      setShowLog(false);
      watch();
    } catch (problem: any) {
      setPhase({ kind: "error", message: problem.message });
    }
  };

  /** Ask for the report, try the clipboard while the click is still warm,
   *  then show the card whatever the clipboard said. */
  const reportProblem = async () => {
    setTrouble({ kind: "fetching" });
    let report: Report;
    try {
      report = await api.report(snapshot(), navigator.userAgent);
    } catch (problem) {
      setTrouble({ kind: "error", message: String((problem as Error)?.message ?? problem) });
      return;
    }
    let copied = false;
    try {
      await navigator.clipboard?.writeText(report.text);
      copied = true;
    } catch {
      /* the card's own Copy is the way then */
    }
    setTrouble({ kind: "ready", report, copied, shown: false });
  };


  if (open === "report") {
    return (
      <Sheet open onClose={onClose} label="Report a problem" testid="report-sheet" width={520}>
        <Heading level={2} display>Report a problem</Heading>
        {trouble === null || trouble.kind === "fetching" ? (
          <p className="t-meta mt-2 text-ink-2">Gathering the report.</p>
        ) : (
          <ReportCard
            trouble={trouble}
            onCopied={(copied) =>
              setTrouble((t) => (t?.kind === "ready" ? { ...t, copied } : t))
            }
            onShow={() =>
              setTrouble((t) => (t?.kind === "ready" ? { ...t, shown: !t.shown } : t))
            }
            onClose={() => {
              setTrouble(null);
              onClose();
            }}
          />
        )}
      </Sheet>
    );
  }
  if (open !== "update") return null;
  return (
    <Sheet open onClose={onClose} label="Updates" testid="update-sheet" width={520}>
      <Heading level={2} display>Updates</Heading>
      <div className="mt-2 nx-arrive">{render()}</div>
      <div className="nx-sheet-foot">
        <Button variant="quiet" onClick={onClose}>Done</Button>
      </div>
    </Sheet>
  );

  function render() {
    if (phase.kind === "opening") {
      return <p className="t-meta text-ink-3">Asking the repository.</p>;
    }

    if (phase.kind === "checking") {
      return (
        <Line>
          <span className="t-meta text-ink-3">Checking.</span>
        </Line>
      );
    }

    if (phase.kind === "resting") {
      return (
        <Line>
          <span className="t-meta text-ink-2">Nothing has been checked yet.</span>
          <span className="flex-1" />
          <Button variant="ghost" onClick={() => check(true)}>
            Check for updates
          </Button>
        </Line>
      );
    }

    if (phase.kind === "error") {
      return (
        <Card>
          <div className="t-ui text-ink">Could not reach the repository.</div>
          <p className="t-meta mt-1 text-ink-2">
            This machine may be offline. Nothing here has changed. ({phase.message})
          </p>
          <div className="mt-3 flex items-center gap-2">
            <Button variant="ghost" onClick={() => check(true)}>Try again</Button>
          </div>
        </Card>
      );
    }

    if (phase.kind === "updating") {
      return (
        <Card sweeping>
          <div className="t-ui text-ink">Updating NextTex</div>
          <div className="t-meta mt-1 text-ink-2">{step || "Starting"}</div>
          <div className="t-code-sm mt-1 truncate text-ink-3">
            {log[log.length - 1] ?? ""}
          </div>
          <Log lines={log} shown={showLog} onToggle={() => setShowLog(!showLog)} />
        </Card>
      );
    }

    if (phase.kind === "restarting") {
      return (
        <Card sweeping>
          <div className="t-ui text-ink">Restarting</div>
          <p className="t-meta mt-1 text-ink-2">This page comes back on its own.</p>
        </Card>
      );
    }

    if (phase.kind === "manual") {
      return (
        <Card>
          <div className="t-ui text-ink">Update installed.</div>
          <p className="t-meta mt-1 text-ink-2">
            NextTex cannot restart itself here. Stop it and start it again, then
            reload this page.
          </p>
          <div className="mt-3">
            <Button variant="ghost" onClick={() => window.location.reload()}>Reload</Button>
          </div>
        </Card>
      );
    }

    if (phase.kind === "failed") {
      return (
        <Card>
          <div className="t-ui text-error">The update did not finish.</div>
          <p className="t-meta mt-1 text-ink-2">
            The install may be part-way through. Read the log below, then finish
            it in a terminal with <code className="t-code-sm">scripts/update.sh</code>.
          </p>
          {/* The real toggle. This card used to hard-code `shown` and pass a
              function with no body, so it drew a button reading "Hide the
              log" that did nothing when pressed, with two hundred lines of
              install output wedged open above Try again. */}
          <Log lines={log} shown={showLog} onToggle={() => setShowLog(!showLog)} />
          <div className="mt-3 flex items-center gap-2">
            <Button variant="ghost" onClick={start}>Try again</Button>
          </div>
        </Card>
      );
    }

    const report = phase.report;

    // Before anything about the repository, because this is a statement
    // about the process the writer is talking to rather than about
    // upstream, and it outranks both of the answers below: "up to date" is
    // true of the files and false of the program reading them, and "an
    // update is waiting" is about the wrong update.
    if (standingOf(self) === "restart") {
      return (
        <Line>
          <span
            className="t-micro shrink-0 text-warn"
            data-testid="update-unrestarted"
          >
            Updated on disk to {self?.diskHead}.{" "}
            {self?.supervised
              ? "Restart to run it."
              : "Stop NextTex and start it again to run it."}
          </span>
          <span className="t-micro min-w-0 truncate text-ink-3">
            This process is still running {self?.head}.
          </span>
          <span className="flex-1" />
          {/* Reload was the control here, and on this line it is a dead
              end: the page comes back from the same process, `head` is
              fixed at process start, and the reader is handed back the
              identical sentence.  A restart is what the sentence asks
              for, and where nothing would start NextTex again there is no
              control to offer, so the first span says to do it by hand
              instead. */}
          {self?.supervised ? (
            <Button variant="ghost" onClick={restartNow}>Restart now</Button>
          ) : null}
        </Line>
      );
    }

    // Nothing it could ever do about updating; a problem can still be
    // reported from a folder that is not a checkout.
    if (!report.checkout) {
      return (
        <Line>
          <span className="t-meta text-ink-2">
            This install is not a checkout, so it cannot update itself.
          </span>
        </Line>
      );
    }

    // Asked before anything is read off the numbers, because when the fetch
    // failed there are no numbers: `behind` keeps its default of zero and
    // this used to fall straight through to "Up to date." on a machine that
    // was five commits behind a repository it could not reach. The error
    // card below belongs to `phase.kind === "error"`, which is the request
    // itself failing; a report that arrives carrying an error is not that,
    // and reached nothing that would draw it.
    if (!report.checked) {
      return (
        <Line>
          <span
            className="t-micro shrink-0 text-warn"
            data-testid="update-unchecked"
          >
            Could not reach the repository.
          </span>
          {/* git's own words, which can be a paragraph: it is the least
              important thing on the line and the only thing that can be
              any length, so it is what gives way.  Without the truncate
              the sentence wrapped to three rows and carried Try again off
              the end of the footer. */}
          <span
            className="t-micro min-w-0 truncate text-ink-3"
            title={report.error || undefined}
          >
            {report.error || "This machine may be offline."}
          </span>
          <span className="flex-1" />
          <Button size="inline" onClick={() => check(true)}>Try again</Button>
        </Line>
      );
    }

    if (report.behind === 0) {
      return (
        <Line>
          <span className="t-micro text-ink-3" data-testid="update-current">
            {report.version ? `NextTex ${report.version}, up to date.` : "Up to date."}
          </span>
          <span className="flex-1" />
          <Button size="inline" onClick={() => check(true)}>Check again</Button>
        </Line>
      );
    }

    // Set aside earlier, and nobody has asked since.
    //
    // Two things about this.  It is gated on `asked`, because a dismissal is
    // a statement about the check that runs when this screen opens and was
    // never meant to gag one the writer pressed a button for; without that
    // gate every later press of the button below was answered, and the
    // answer thrown away here, so the update became unreachable until
    // upstream moved.  And it says an update is waiting rather than offering
    // a bare "Check for updates", which is indistinguishable from never
    // having checked: an update you set aside for a quieter afternoon should
    // leave something on screen to come back to.
    if (!phase.asked && readStored(DISMISSED) === report.head + ":" + report.behind) {
      return (
        <Line>
          <span className="t-micro text-ink-3">An update is waiting.</span>
          <span className="flex-1" />
          <Button size="inline" onClick={() => check(true)}>Show it</Button>
        </Line>
      );
    }

    // Commits exist but none of them reaches the running program.
    if (report.changing === 0) {
      return (
        <>
          <Line>
            <span className="t-micro text-ink-3">
              {report.behind === 1
                ? "1 new commit, which does not change NextTex."
                : `${report.behind} new commits, none of which change NextTex.`}
            </span>
            <span className="flex-1" />
            <Button size="inline" onClick={() => setShowCommits(!showCommits)}>
              {showCommits ? "Hide them" : "Show them"}
            </Button>
            <Button size="inline" onClick={start}>Update</Button>
          </Line>
          {showCommits ? <Commits commits={report.commits} /> : null}
        </>
      );
    }

    if (!report.can_update) {
      return (
        <Card>
          <div className="t-ui text-ink">
            {report.dirty.length
              ? "The NextTex folder has changes that are not committed."
              : "The interface for this update is still being built."}
          </div>
          <p className="t-meta mt-1 text-ink-2">
            {report.dirty.length
              ? "Updating would overwrite them, so it will not run. Commit or discard them in a terminal, then check again."
              : `${report.build_reason} It usually takes a minute; check again shortly.`}
          </p>
          {report.dirty.slice(0, 5).map((path) => (
            <div key={path} className="t-code-sm mt-1 text-ink-3">
              {path}
            </div>
          ))}
          {report.dirty.length > 5 ? (
            <div className="t-micro mt-1 text-ink-3">
              and {report.dirty.length - 5} more
            </div>
          ) : null}
          <div className="mt-3">
            <Button size="inline" onClick={() => check(true)}>Check again</Button>
          </div>
        </Card>
      );
    }

    return (
      <Card>
        <div className="t-ui text-ink" data-testid="update-headline">
          {headline(report)}
        </div>
        <p className="t-meta mt-1 text-ink-2">
          Takes about a minute.{" "}
          {report.restart === "auto"
            ? "NextTex restarts afterwards and this page reloads itself."
            : "NextTex has to be started again afterwards."}
        </p>
        <Commits commits={report.commits} />
        <div className="mt-3 flex items-center gap-2">
          <Button variant="pen" data-testid="update-now" onClick={start}>
            Update
          </Button>
          <Button
            variant="quiet"
            onClick={() => {
              writeStored(DISMISSED, report.head + ":" + report.behind);
              // The report is kept rather than thrown away, and marked
              // unasked: that lands on the dismissed branch above, which is
              // also where a reload lands, so the two routes to "set aside"
              // agree by construction rather than by coincidence.
              setPhase({ kind: "report", report, asked: false });
            }}
          >
            Not now
          </Button>
        </div>
      </Card>
    );
  }
}

/** The one word the app bar's button needs. "Waiting" is an update that
 *  reaches the program and has not been set aside; "attention" is an
 *  install updated on disk and not restarted, or a failed update; "busy"
 *  is one running. */
function stateOf(phase: Phase, self: Instance | null): UpdateState {
  if (phase.kind === "opening") return "opening";
  if (phase.kind === "checking") return "checking";
  if (phase.kind === "updating" || phase.kind === "restarting") return "busy";
  if (phase.kind === "failed" || phase.kind === "manual") return "attention";
  if (standingOf(self) === "restart") return "attention";
  if (phase.kind === "report") {
    const report = phase.report;
    if (!report.checkout || !report.checked) return "resting";
    if (report.behind > 0 && report.changing > 0 && report.can_update) return "waiting";
  }
  return "resting";
}

/** The version on offer first, when upstream carries one and it is not
 *  the one installed, then the commit count: a number is what a writer
 *  remembers and compares, and the count is what says how much moved. An
 *  upstream that carries the same number is one whose commits since here
 *  were docs and tests, which is already the "none of which change
 *  NextTex" line and never reaches this. */
function headline(report: UpdateReport): string {
  const { behind, changing, version, upstream_version: upstream } = report;
  const word = (n: number) =>
    ["no", "one", "two", "three", "four", "five"][n] ?? String(n);
  const lead = upstream && upstream !== version ? `NextTex ${upstream} is available. ` : "";
  if (changing === behind) {
    return lead + (behind === 1
      ? "One new commit changes NextTex."
      : `${cap(word(behind))} new commits change NextTex.`);
  }
  return lead + (changing === 1
    ? `${cap(word(behind))} new commits, one of which changes NextTex.`
    : `${cap(word(behind))} new commits, ${word(changing)} of which change NextTex.`);
}

const cap = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

/** What the writer gets after pressing it.
 *
 *  A card rather than a popup, for two reasons the browsers decide. A
 *  `window.open` after the report has been fetched is a popup with no click
 *  behind it, and Safari and Firefox block it; a link is never blocked. And
 *  the writer is meant to read the report before it goes anywhere, which a
 *  page that opened itself would not have given them the chance to do. The
 *  text is behind a toggle because eighty lines of log on the first screen
 *  of a session is not what anybody came for. */
function ReportCard({
  trouble,
  onCopied,
  onShow,
  onClose,
}: {
  trouble: Exclude<Trouble, null | { kind: "fetching" }>;
  onCopied: (copied: boolean) => void;
  onShow: () => void;
  onClose: () => void;
}) {
  const [said, setSaid] = useState("");
  if (trouble.kind === "error") {
    return (
      <div className="mt-3">
        <Card>
          <div className="t-ui text-ink">Could not put the report together.</div>
          <p className="t-meta mt-1 text-ink-2">
            {trouble.message}. From a terminal, <code>python server/run.py --report</code> prints
            the same text.
          </p>
          <div className="mt-3">
            <Button variant="quiet" onClick={onClose}>Close</Button>
          </div>
        </Card>
      </div>
    );
  }
  const { report, copied, shown } = trouble;
  const copy = () => {
    const clipboard = navigator.clipboard;
    if (!clipboard) {
      setSaid("Could not copy; select the text below");
      onCopied(false);
      return;
    }
    clipboard
      .writeText(report.text)
      .then(() => {
        setSaid("Copied");
        onCopied(true);
      })
      .catch(() => {
        setSaid("Could not copy; select the text below");
        onCopied(false);
      });
    window.setTimeout(() => setSaid(""), 1500);
  };
  return (
    <div className="mt-3" data-testid="report-card">
      <Card>
        <div className="t-ui text-ink">
          {copied ? "The report is on your clipboard." : "Copy the report, then open the issue."}
        </div>
        <p className="t-meta mt-1 text-ink-2">
          It holds the commit, the settings without their secrets, the tools NextTex found
          and the last lines of its logs. Read it before you paste it: it names this machine.
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <a
            className="nx-button"
            data-variant="ghost"
            data-size="sm"
            data-testid="report-open"
            href={report.newIssue}
            target="_blank"
            rel="noopener"
          >
            Open a new issue
          </a>
          <Button variant="quiet" data-testid="report-copy" onClick={copy}>
            {said || "Copy"}
          </Button>
          <Button variant="quiet" onClick={onShow}>
            {shown ? "Hide the report" : "Show the report"}
          </Button>
          <span className="flex-1" />
          <Button variant="quiet" onClick={onClose}>Close</Button>
        </div>
        {shown ? (
          <pre
            className="t-code-sm mt-3 max-h-[320px] overflow-auto whitespace-pre-wrap break-words rounded-control bg-surface p-3 text-ink-2"
            data-testid="report-text"
          >
            {report.text}
          </pre>
        ) : null}
      </Card>
    </div>
  );
}

/** Wrapping, because the rail is 280px and a line with a message, a
 *  button and Report a problem on it is wider than that.  Nothing on a
 *  line is carried off it; it drops under. */
function Line({ children }: { children: React.ReactNode }) {
  return <div className="flex flex-wrap items-center gap-x-3 gap-y-1">{children}</div>;
}

function Card({
  children,
  sweeping,
}: {
  children: React.ReactNode;
  sweeping?: boolean;
}) {
  return (
    <div className="relative overflow-hidden rounded-card bg-surface-2 px-3 py-[10px]">
      {sweeping ? <div className="hairline absolute inset-x-0 top-0 h-[2px]" /> : null}
      {children}
    </div>
  );
}

/** The subjects, and what each one touches.  Prose, so not monospace --
 *  the sha would be, which is why it is not shown: it earns nothing here. */
function Commits({ commits }: { commits: UpdateReport["commits"] }) {
  const shown = commits.slice(0, 5);
  return (
    <div className="mt-2 max-h-[132px] overflow-auto">
      {shown.map((commit) => (
        <div key={commit.sha} className="flex h-[22px] items-center gap-2">
          <span className="t-meta min-w-0 flex-1 truncate text-ink-2">
            {commit.subject}
          </span>
          <span className="t-micro shrink-0 text-ink-3">
            {commit.touches === "interface"
              ? "interface"
              : commit.touches === "neither"
                ? "docs"
                : ""}
          </span>
        </div>
      ))}
      {commits.length > shown.length ? (
        <div className="t-micro text-ink-3">and {commits.length - shown.length} more</div>
      ) : null}
    </div>
  );
}

function Log({
  lines,
  shown,
  onToggle,
}: {
  lines: string[];
  shown: boolean;
  onToggle: () => void;
}) {
  const box = useRef<HTMLPreElement | null>(null);
  useEffect(() => {
    if (box.current) box.current.scrollTop = box.current.scrollHeight;
  }, [lines, shown]);
  return (
    <>
      <div className="mt-2">
        <Button size="inline" onClick={onToggle}>
          {shown ? "Hide the log" : "Show what it is doing"}
        </Button>
      </div>
      {shown ? (
        <pre
          ref={box}
          className="t-code-sm mt-2 max-h-[220px] overflow-auto whitespace-pre-wrap rounded-control bg-surface p-3 text-ink-2"
        >
          {lines.join("\n")}
        </pre>
      ) : null}
    </>
  );
}
