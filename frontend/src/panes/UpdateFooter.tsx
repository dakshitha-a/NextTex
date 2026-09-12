import { useEffect, useRef, useState } from "react";
import api, { type Instance, type UpdateReport } from "../api";
import { standingOf } from "./update-standing";

/** Whether this install is behind the repository it came from.
 *
 *  It sits at the foot of the project list, which is the only sensible
 *  place for it: updating exits the server, and offering that beside an
 *  open document with unsaved sentences in it would be wrong.
 *
 *  The rule the whole thing turns on is that this must not become a nag.
 *  It is the first screen of every session.  So the check runs once, never
 *  on a timer; a check that fails on its own is silent, and only says so
 *  when the writer asked; and commits that change nothing but documentation
 *  are mentioned in a grey line rather than presented as an update.
 */

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

function remember(key: string, value: string) {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    /* a private window: the choice lasts this session */
  }
}

function recall(key: string): string {
  try {
    return window.localStorage.getItem(key) ?? "";
  } catch {
    return "";
  }
}

export default function UpdateFooter({ onBusy }: { onBusy: (busy: boolean) => void }) {
  const [phase, setPhase] = useState<Phase>({ kind: "opening" });
  const [log, setLog] = useState<string[]>([]);
  const [step, setStep] = useState("");
  const [showLog, setShowLog] = useState(false);
  const [showCommits, setShowCommits] = useState(false);
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

  return (
    // The projects screen's ground is --surround, which is a darker plane
    // than the surfaces the inks were certified against.  Everything dim in
    // here steps up one; see the rule in styles.css.
    <div className="nx-arrive nx-on-surround mt-8 min-h-[20px]">
      {render()}
    </div>
  );

  function render() {
    if (phase.kind === "opening") return null;

    if (phase.kind === "checking") {
      return (
        <Line>
          <button className="quiet t-micro" disabled>
            Checking
          </button>
        </Line>
      );
    }

    if (phase.kind === "resting") return <Resting onCheck={() => check(true)} />;

    if (phase.kind === "error") {
      return (
        <Card>
          <div className="t-ui text-ink">Could not reach the repository.</div>
          <p className="t-meta mt-1 text-ink-2">
            This machine may be offline. Nothing here has changed. ({phase.message})
          </p>
          <div className="mt-3">
            <button className="ghost-button h-[28px] px-3 t-ui" onClick={() => check(true)}>
              Try again
            </button>
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
            <button
              className="ghost-button h-[28px] px-3 t-ui"
              onClick={() => window.location.reload()}
            >
              Reload
            </button>
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
            <button className="ghost-button h-[28px] px-3 t-ui" onClick={start}>
              Try again
            </button>
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
          <span className="t-micro text-warn" data-testid="update-unrestarted">
            Updated on disk to {self?.diskHead}. Restart to run it.
          </span>
          <span className="t-micro text-ink-3">
            This process is still running {self?.head}.
          </span>
          <span className="flex-1" />
          <button className="quiet t-micro" onClick={() => window.location.reload()}>
            Reload
          </button>
        </Line>
      );
    }

    if (!report.checkout) return null;      // nothing it could ever do

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
          <span className="t-micro text-warn" data-testid="update-unchecked">
            Could not reach the repository.
          </span>
          <span className="t-micro text-ink-3">
            {report.error || "This machine may be offline."}
          </span>
          <span className="flex-1" />
          <button className="quiet t-micro" onClick={() => check(true)}>
            Try again
          </button>
        </Line>
      );
    }

    if (report.behind === 0) {
      return (
        <Line>
          <span className="t-micro text-ink-3">Up to date.</span>
          <span className="flex-1" />
          <button className="quiet t-micro" onClick={() => check(true)}>
            Check again
          </button>
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
    if (!phase.asked && recall(DISMISSED) === report.head + ":" + report.behind) {
      return (
        <Line>
          <span className="t-micro text-ink-3">An update is waiting.</span>
          <span className="flex-1" />
          <button className="quiet t-micro" onClick={() => check(true)}>
            Show it
          </button>
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
            <button className="quiet t-micro" onClick={() => setShowCommits(!showCommits)}>
              {showCommits ? "Hide them" : "Show them"}
            </button>
            <span className="h-[10px] w-px shrink-0 bg-line" />
            <button className="quiet t-micro" onClick={start}>
              Update
            </button>
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
            <button className="quiet t-micro" onClick={() => check(true)}>
              Check again
            </button>
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
          <button
            className="ghost-button h-[28px] px-3 t-ui"
            data-testid="update-now"
            onClick={start}
          >
            Update
          </button>
          <button
            className="quiet t-micro h-[28px] px-2"
            onClick={() => {
              remember(DISMISSED, report.head + ":" + report.behind);
              // The report is kept rather than thrown away, and marked
              // unasked: that lands on the dismissed branch above, which is
              // also where a reload lands, so the two routes to "set aside"
              // agree by construction rather than by coincidence.
              setPhase({ kind: "report", report, asked: false });
            }}
          >
            Not now
          </button>
        </div>
      </Card>
    );
  }
}

function headline(report: UpdateReport): string {
  const { behind, changing } = report;
  const word = (n: number) =>
    ["no", "one", "two", "three", "four", "five"][n] ?? String(n);
  if (changing === behind) {
    return behind === 1
      ? "One new commit changes NextTex."
      : `${cap(word(behind))} new commits change NextTex.`;
  }
  return changing === 1
    ? `${cap(word(behind))} new commits, one of which changes NextTex.`
    : `${cap(word(behind))} new commits, ${word(changing)} of which change NextTex.`;
}

const cap = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

function Resting({ onCheck }: { onCheck: () => void }) {
  return (
    <Line>
      <button className="quiet t-micro" onClick={onCheck}>
        Check for updates
      </button>
    </Line>
  );
}

function Line({ children }: { children: React.ReactNode }) {
  return <div className="flex items-center gap-3">{children}</div>;
}

function Card({
  children,
  sweeping,
}: {
  children: React.ReactNode;
  sweeping?: boolean;
}) {
  return (
    <div className="relative overflow-hidden rounded-[5px] border border-line bg-surface px-[10px] py-[10px]">
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
        <button className="quiet t-micro" onClick={onToggle}>
          {shown ? "Hide the log" : "Show what it is doing"}
        </button>
      </div>
      {shown ? (
        <pre
          ref={box}
          className="t-code-sm mt-2 max-h-[220px] overflow-auto whitespace-pre-wrap rounded-[3px] bg-surface-2 p-3 text-ink-2"
        >
          {lines.join("\n")}
        </pre>
      ) : null}
    </>
  );
}
