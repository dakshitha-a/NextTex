import { useEffect, useRef, useState } from "react";
import api, { type UpdateReport } from "../api";

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
  | { kind: "resting" }
  | { kind: "checking" }
  | { kind: "report"; report: UpdateReport }
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
  const [phase, setPhase] = useState<Phase>({ kind: "resting" });
  const [log, setLog] = useState<string[]>([]);
  const [step, setStep] = useState("");
  const [showLog, setShowLog] = useState(false);
  const [showCommits, setShowCommits] = useState(false);
  const startedFrom = useRef("");

  const check = async (asked: boolean) => {
    if (asked) setPhase({ kind: "checking" });
    try {
      const report = await api.updateCheck(asked);
      if (report.updating) {
        watch();
        return;
      }
      setPhase({ kind: "report", report });
    } catch (problem: any) {
      // A check nobody asked for stays quiet.  An install on an offline
      // tailnet must not open onto a red line every morning.
      setPhase(asked ? { kind: "error", message: problem.message } : { kind: "resting" });
    }
  };

  useEffect(() => {
    check(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    onBusy(phase.kind === "updating" || phase.kind === "restarting");
  }, [phase.kind, onBusy]);

  /** Follow an update that is already running, from any tab. */
  const watch = () => {
    setPhase({ kind: "updating" });
    const source = new EventSource("/api/update/stream");
    source.onmessage = (message) => {
      const event = JSON.parse(message.data);
      if (event.type === "output") setLog((lines) => [...lines, event.text]);
      if (event.type === "step") setStep(event.label);
      if (event.type === "failed") {
        source.close();
        setShowLog(true);
        setPhase({ kind: "failed", message: event.message });
      }
      if (event.type === "done") {
        // Close it here rather than letting it drop: an EventSource whose
        // server has just exited reconnects against the new one for ever.
        source.close();
        setPhase(event.restart === "auto" ? { kind: "restarting" } : { kind: "manual" });
        waitForRestart();
      }
    };
    source.onerror = () => {
      // The server going away mid-stream is the expected ending, not a fault.
      source.close();
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
    const deadline = Date.now() + 60_000;
    const tick = async () => {
      try {
        const now = await api.instance();
        if (startedFrom.current && now.boot !== startedFrom.current) {
          window.location.reload();
          return;
        }
      } catch {
        /* still down; that is what we are waiting for */
      }
      if (Date.now() < deadline) window.setTimeout(tick, 1000);
      else setPhase({ kind: "manual" });
    };
    window.setTimeout(tick, 1000);
  };

  const start = async () => {
    try {
      startedFrom.current = (await api.instance()).boot;
      await api.startUpdate();
      setLog([]);
      setStep("");
      watch();
    } catch (problem: any) {
      setPhase({ kind: "error", message: problem.message });
    }
  };

  return (
    <div className="nx-arrive mt-8 min-h-[20px]">
      {render()}
    </div>
  );

  function render() {
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
          <Log lines={log} shown onToggle={() => undefined} />
          <div className="mt-3 flex items-center gap-2">
            <button className="ghost-button h-[28px] px-3 t-ui" onClick={start}>
              Try again
            </button>
          </div>
        </Card>
      );
    }

    const report = phase.report;
    if (!report.checkout) return null;      // nothing it could ever do

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

    if (recall(DISMISSED) === report.head + ":" + report.behind) {
      return <Resting onCheck={() => check(true)} />;
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
              : "This update changes the interface, which needs Node to rebuild."}
          </div>
          <p className="t-meta mt-1 text-ink-2">
            {report.dirty.length
              ? "Updating would overwrite them, so it will not run. Commit or discard them in a terminal, then check again."
              : `${report.node_reason} Install Node, then check again.`}
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
              setPhase({ kind: "resting" });
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
