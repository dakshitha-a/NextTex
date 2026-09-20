import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import api from "../api";
import type { ScriptResult } from "../api";
import { RunIcon, StopIcon } from "../ui/icons";
import { useStore } from "../store";
import { lastLine, outcomeLabel } from "../script-run";
import { Button } from "../ui/Button";

/** What a script did the last time it ran, in the preview pane.
 *
 *  Drawn in place of the page when the script tab is in front.  Top row is
 *  the same 26 px furniture the image viewer's footer uses: the path, Run
 *  or Stop, and the outcome in four words.  Below, scrolling: the figures
 *  the run drew, on paper like a figure being viewed; the files it wrote
 *  into the project, each a button that opens it; what it printed; and,
 *  on a failure, the traceback with its last line set in the ink and the
 *  two ways forward, the agent and an install.
 *
 *  Nothing here runs a script on its own.  The agent's runs pass the
 *  permission fence with the script as the card's text; a rerun from
 *  here of a script the agent has just changed would not, so the pane
 *  says the script changed and offers the button.
 */

export default function Script({
  onRun,
  onStop,
  onOpen,
  onAsk,
}: {
  onRun: (path: string) => void;
  onStop: (path: string) => void;
  /** Open a file the run wrote, in the editor's viewer. */
  onOpen: (path: string) => void;
  /** Hand the failure to the agent, seeded into the composer.  Absent
   *  when the install has no agent, and then the button is not drawn. */
  onAsk?: (path: string, result: ScriptResult) => void;
}) {
  const projectId = useStore((s) => s.projectId);
  const script = useStore((s) => s.script);
  const [installing, setInstalling] = useState<"" | "asked" | "running">("");
  const [installSaid, setInstallSaid] = useState("");

  // A different script, or a new run: the install question starts over.
  useEffect(() => {
    setInstalling("");
    setInstallSaid("");
  }, [script?.path, script?.result?.run]);

  const result = script?.result ?? null;
  const running = script?.running ?? false;
  const live = script?.live ?? null;
  const label = useMemo(() => outcomeLabel(result, running), [result, running]);

  // What the run has printed so far is appended as it arrives, and the
  // body keeps the end in view unless the reader has scrolled up to read
  // something earlier, in which case it is theirs.  A new run starts
  // stuck to the end again.
  const body = useRef<HTMLDivElement | null>(null);
  const stuck = useRef(true);
  useEffect(() => {
    if (running) stuck.current = true;
  }, [running, script?.path]);
  useLayoutEffect(() => {
    const element = body.current;
    if (!element || !running || !stuck.current) return;
    element.scrollTop = element.scrollHeight;
  }, [live?.out, live?.err, running]);

  if (!script || !projectId) return null;
  const path = script.path;
  const name = path.split("/").pop() ?? path;

  const install = async () => {
    const missing = result?.missing;
    if (!missing) return;
    if (installing !== "asked") {
      setInstalling("asked");
      return;
    }
    setInstalling("running");
    try {
      const answer = await api.installForScript(projectId, missing);
      if (answer.ok) {
        setInstalling("");
        onRun(path);
      } else {
        setInstallSaid(answer.err || `${missing} could not be installed.`);
        setInstalling("");
      }
    } catch (problem: any) {
      setInstallSaid(problem?.message ?? String(problem));
      setInstalling("");
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="script-pane">
      {/* The strip: the preview strip's recipe, 28 px on the second
          surface with no rule, the path in the mono, Run or Stop, and the
          run's outcome at the right. */}
      <div className="t-meta flex h-[28px] shrink-0 items-center gap-4 overflow-hidden whitespace-nowrap bg-surface-2 px-3 text-ink-3">
        <span className="t-code-sm truncate text-ink-2" title={path}>{path}</span>
        {running ? (
          <button
            className="nx-tap [--nx-tap-y:28px] flex shrink-0 items-center gap-1 hover:text-ink"
            data-testid="script-stop"
            onClick={() => onStop(path)}
          >
            <StopIcon size={12} /> Stop
          </button>
        ) : (
          <button
            className="nx-tap [--nx-tap-y:28px] flex shrink-0 items-center gap-1 hover:text-ink"
            data-testid="script-run"
            title="Run this script"
            onClick={() => onRun(path)}
          >
            <RunIcon size={12} /> Run
          </button>
        )}
        <span
          className={`tnum ml-auto shrink-0 ${
            result && !result.ok && !running ? "text-error" : ""
          }`}
          data-testid="script-outcome"
          aria-live="polite"
        >
          {label}
        </span>
      </div>
      <div
        className="min-h-0 flex-1 overflow-auto bg-surround"
        ref={body}
        onScroll={(event) => {
          const element = event.currentTarget;
          stuck.current = element.scrollHeight - element.scrollTop - element.clientHeight < 8;
        }}
      >
        {!result && !running ? (
          <div className="flex h-full items-center justify-center px-8 text-center">
            <div className="max-w-[42ch]">
              <p className="t-display text-ink-3">{name}</p>
              <p className="t-meta mt-2 text-ink-2">
                Run to see what it prints and draws. What it saves into the
                project is listed here too.
              </p>
              <Button variant="ghost" className="mt-4" onClick={() => onRun(path)}>
                Run {name}
              </Button>
            </div>
          </div>
        ) : null}
        {running && !(live && (live.out || live.err)) ? (
          <p className="t-meta px-4 py-3 text-ink-3" role="status">Running {name}.</p>
        ) : null}
        {running && live && (live.out || live.err) ? (
          // The run so far.  The same test ids as the finished output, so
          // a reader, or a spec, finds the text in the one place; the
          // finished result's blocks below are held back while this is
          // drawn so the two never show at once.
          <div className="flex flex-col gap-4 px-4 py-4">
            {live.out ? (
              <pre
                className="t-code-sm m-0 whitespace-pre-wrap break-words rounded-[3px] border border-line bg-surface px-3 py-2 text-ink"
                data-testid="script-stdout"
              >
                {live.out.trimEnd()}
              </pre>
            ) : null}
            {live.err ? <Stderr text={live.err} failed={false} /> : null}
          </div>
        ) : null}
        {result && !running ? (
          <div className="flex flex-col gap-4 px-4 py-4">
            {script.changedByAgent ? (
              <div className="flex items-center gap-3 rounded-[3px] border border-line bg-surface px-3 py-2">
                <span className="t-meta text-ink-2">The agent changed this script.</span>
                <Button variant="ghost" size="inline" data-testid="script-run-again" onClick={() => onRun(path)}>
                  Run again
                </Button>
              </div>
            ) : null}
            {result.figures.map((figure) => (
              // On paper and with the page's shadow, for the reason the
              // image viewer does the same: a plot with a transparent
              // background is judged against white on the page.
              <div key={`${result.run}-${figure}`} className="nx-page w-full">
                <img
                  src={api.scriptFigureUrl(projectId, path, figure, result.run)}
                  alt={`${name}, ${figure.replace(".png", "").replace("-", " ")}`}
                  data-testid="script-figure"
                  style={{ display: "block", width: "100%", height: "auto" }}
                />
              </div>
            ))}
            {result.saved.length ? (
              <ul className="flex flex-col gap-1" data-testid="script-saved">
                {result.saved.map((file) => (
                  <li key={file}>
                    <button
                      className="t-meta text-left text-ink-2 hover:text-ink"
                      onClick={() => onOpen(file)}
                    >
                      Wrote <span className="text-ink">{file}</span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
            {result.out.trim() ? (
              <pre
                className="t-code-sm m-0 whitespace-pre-wrap break-words rounded-[3px] border border-line bg-surface px-3 py-2 text-ink"
                data-testid="script-stdout"
              >
                {result.out.trimEnd()}
              </pre>
            ) : null}
            {result.err.trim() ? (
              <Stderr text={result.err} failed={!result.ok} />
            ) : null}
            {result.clipped ? (
              <p className="t-micro text-ink-3">Output clipped at 64 kB per stream.</p>
            ) : null}
            {!result.ok && !result.stopped ? (
              <div className="flex flex-wrap items-center gap-2" data-testid="script-actions">
                {onAsk ? (
                  <Button variant="ghost" data-testid="script-ask-agent" onClick={() => onAsk(path, result)}>
                    Ask the agent
                  </Button>
                ) : null}
                {result.missing ? (
                  <Button
                    variant="ghost"
                    data-testid="script-install"
                    disabled={installing === "running"}
                    onClick={install}
                  >
                    {installing === "running"
                      ? `Installing ${result.missing}`
                      : installing === "asked"
                        ? `Yes, install ${result.missing}`
                        : `Install ${result.missing}`}
                  </Button>
                ) : null}
                {installing === "asked" && result.missing ? (
                  <span className="t-meta text-ink-2">
                    This downloads {result.missing} from PyPI and runs its installer,
                    then runs the script again.
                  </span>
                ) : null}
                {installSaid ? (
                  <span className="t-meta text-error">{installSaid}</span>
                ) : null}
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}

/** What the script wrote to stderr.  On a failure the last line is the
 *  sentence that says what went wrong, so it is set in the ink and the
 *  frames above it a step back. */
function Stderr({ text, failed }: { text: string; failed: boolean }) {
  const body = text.trimEnd();
  const last = failed ? lastLine(body) : "";
  const head = last && body.endsWith(last) ? body.slice(0, body.length - last.length) : body;
  return (
    <pre
      className={`t-code-sm m-0 whitespace-pre-wrap break-words rounded-[3px] border px-3 py-2 ${
        failed ? "border-error bg-surface" : "border-line bg-surface"
      }`}
      data-testid="script-stderr"
    >
      <span className={failed ? "text-ink-2" : "text-ink"}>{head}</span>
      {last ? <span className="text-ink">{last}</span> : null}
    </pre>
  );
}
