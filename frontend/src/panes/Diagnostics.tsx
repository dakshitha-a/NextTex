import { useEffect, useMemo, useState } from "react";
import { orderRows, rowKey } from "./diagnostic-rows";
import { uiScale } from "../viewport";
import { Handle } from "../chrome";
import { onFrame } from "../timing";
import { get, set, useStore } from "../store";
import api from "../api";

/** The button that used to be a sentence: "run tlmgr install <name>".
 *
 *  Opened with the row, it asks the server which package provides the
 *  file, so the button can name it before anything is pressed; a file no
 *  package provides, or a TeX with no package manager, leaves the row as
 *  it was, with the sentence.  Two presses to install, the pip card's
 *  shape, because the install downloads from a mirror and unpacks what it
 *  downloads.  A failure shows the manager's own words under the row: a
 *  TinyTeX behind its mirror says "remote repository is newer than local",
 *  and that sentence is the whole of the fix.
 */
function InstallPackage({ file }: { file: string }) {
  const projectId = useStore((s) => s.projectId);
  const [found, setFound] = useState<{ package: string; manager: string } | null>(null);
  const [installing, setInstalling] = useState<"" | "asked" | "running" | "done">("");
  const [said, setSaid] = useState("");

  useEffect(() => {
    let live = true;
    setFound(null);
    setInstalling("");
    setSaid("");
    if (!projectId) return;
    api.texPackage(projectId, file)
      .then((answer) => live && setFound(answer))
      .catch(() => live && setFound({ package: "", manager: "" }));
    return () => {
      live = false;
    };
  }, [projectId, file]);

  if (!projectId || !found) return null;
  if (!found.manager) return null;
  if (!found.package) {
    return (
      <p className="t-meta mt-2 text-ink-3" data-testid="tex-install-none">
        No package on the mirror provides {file}; check the spelling.
      </p>
    );
  }
  const pkg = found.package;

  const install = async () => {
    if (installing !== "asked") {
      setInstalling("asked");
      return;
    }
    setInstalling("running");
    try {
      const answer = await api.texInstall(projectId, pkg);
      if (answer.ok) {
        setInstalling("done");
      } else {
        setSaid(answer.err || `${pkg} could not be installed.`);
        setInstalling("");
      }
    } catch (problem: any) {
      setSaid(problem?.message ?? String(problem));
      setInstalling("");
    }
  };

  return (
    <div className="mt-2 flex flex-wrap items-center gap-3">
      {installing === "done" ? (
        <span className="t-meta text-ink-2" data-testid="tex-install-done">
          {pkg} is installed; building again.
        </span>
      ) : (
        <button
          className="ghost-button h-[24px] px-3 t-micro"
          data-testid="tex-install"
          disabled={installing === "running"}
          onClick={(event) => {
            event.stopPropagation();
            void install();
          }}
        >
          {installing === "running"
            ? `Installing ${pkg}`
            : installing === "asked"
              ? `Yes, install ${pkg}`
              : `Install ${pkg}`}
        </button>
      )}
      {installing === "asked" ? (
        <span className="t-meta text-ink-2">
          Downloads {pkg} from a CTAN mirror with tlmgr, then builds again.
        </span>
      ) : null}
      {said ? (
        <pre
          className="t-code-sm max-h-[72px] w-full overflow-auto whitespace-pre-wrap text-error"
          data-testid="tex-install-error"
        >
          {said}
        </pre>
      ) : null}
    </div>
  );
}

function summarise(rows: { severity: string }[]): string {
  const errors = rows.filter((row) => row.severity === "error").length;
  const warnings = rows.length - errors;
  const parts: string[] = [];
  if (errors) parts.push(`${errors} ${errors === 1 ? "error" : "errors"}`);
  if (warnings) parts.push(`${warnings} ${warnings === 1 ? "warning" : "warnings"}`);
  return parts.join(", ") || "Nothing to fix";
}

export default function Diagnostics({
  height,
  onJump,
  onFix,
  onClose,
  onResize,
}: {
  height: number;
  onJump: (file: string, line: number) => void;
  onFix: (text: string) => void;
  onClose: () => void;
  onResize: (height: number) => void;
}) {
  const compile = useStore((s) => s.diagnostics);
  // Written by the server with no model involved: which error is the cause
  // and which are its consequences.  A writer running NextTex without an
  // agent still gets told where to start.
  const summary = useStore((s) => s.compile?.summary);
  const lint = useStore((s) => s.lint);
  const activePath = useStore((s) => s.activePath);
  // Keyed by what the diagnostic is, not by where it is in the list. These
  // were indices, and the list is rebuilt from scratch on every build: a
  // build that reordered it left the open row and the selection bar on
  // whichever diagnostics had landed in those two slots, which is a row
  // the writer never opened and never chose.
  const [expanded, setExpanded] = useState<string | null>(null);
  // In the store, because F8 steps through these from anywhere in the app
  // and the drawer is not always the thing with the keyboard.
  const selected = useStore((s) => s.selectedDiagnostic);
  const setSelected = (key: string | null) => set({ selectedDiagnostic: key });
  const previews = useStore((s) => s.previews);
  /** Which document's errors to show, when several are previewed. Empty
   *  means all of them, which is what this drawer always did and is right
   *  for a project with one document. */
  const [only, setOnly] = useState("");
  const [rawLog, setRawLog] = useState<Record<string, string>>({});
  // The project's request for shell escape, and this machine's answer.
  // "asked" is the only state drawn here: the question sits above the
  // list because the build that ran without the flag is what filled it.
  const shellEscape = useStore((s) => s.settings.shellEscape);
  const [allowing, setAllowing] = useState<"" | "asked" | "running">("");
  const [allowSaid, setAllowSaid] = useState("");

  const allowShellEscape = async () => {
    const projectId = get().projectId;
    if (!projectId) return;
    // Two presses, the pip card's shape: the first says what it would do
    // and the second does it.  A build that runs programs is the one thing
    // in NextTex that must not happen on a slip.
    if (allowing !== "asked") {
      setAllowing("asked");
      return;
    }
    setAllowing("running");
    try {
      const body = await api.allowShellEscape(projectId, true);
      set({ settings: { ...get().settings, shellEscape: body.shellEscape } });
      setAllowing("");
    } catch (problem: any) {
      setAllowSaid(problem?.message ?? String(problem));
      setAllowing("");
    }
  };

  const all = useMemo(() => orderRows(compile, lint), [compile, lint]);
  const rows = useMemo(
    () => (only ? all.filter((row) => row.document === only) : all),
    [all, only],
  );
  // Offered only where it is a question. One previewed document is the
  // ordinary case and a filter with one option is furniture.
  const documents = useMemo(
    () => previews.filter((name) => all.some((row) => row.document === name)),
    [previews, all],
  );

  const showLog = async (document: string) => {
    const projectId = get().projectId;
    if (!projectId) return;
    // Marked as asked before the answer arrives, so the button does not
    // sit there inviting a second press through a slow read.
    setRawLog((current) => ({ ...current, [document]: "" }));
    try {
      const answer = await api.buildLog(projectId, document);
      setRawLog((current) => ({ ...current, [document]: answer.text }));
    } catch (error: any) {
      setRawLog((current) => ({ ...current, [document]: error.message }));
    }
  };

  if (height === 0) return null;

  return (
    <div
      className="nx-furniture flex shrink-0 flex-col border-t border-line bg-surface"
      data-testid="diagnostics"
      style={{ height }}
    >
      <Handle
        axis="row"
        onPointerDown={(event) => {
          event.preventDefault();
          const startY = event.clientY;
          const startHeight = height;
          // Once per frame, keeping the newest position rather than the
          // first: this is a position, so the last one is the true one.  The
          // pane dividers went through `onFrame` when it was written and this
          // resizer, being a second copy of the same code, did not.
          const move = onFrame((moveEvent: PointerEvent) => {
            // Pointer travel is in viewport pixels; the height is not.
            const next =
              startHeight + (startY - moveEvent.clientY) / uiScale();
            onResize(Math.min(Math.max(next, 84), 320));
          });
          const up = () => {
            move.cancel();
            window.removeEventListener("pointermove", move);
            window.removeEventListener("pointerup", up);
            // A drag can also end without a pointerup: a browser dialog, a
            // tab switch, an interrupted touch. App.tsx learned this for the
            // pane splitters and this resizer never got the same fix, so an
            // interrupted drag left the move listener attached and the
            // drawer resized on every mouse movement afterwards.
            window.removeEventListener("pointercancel", up);
          };
          window.addEventListener("pointermove", move);
          window.addEventListener("pointerup", up);
          window.addEventListener("pointercancel", up);
        }}
      />
      {/* The whole bar closes the drawer, the way the preview's and the
          agent's headers fold their panes. The button stays: it is what
          says the bar is a control, and it is what a keyboard reaches. */}
      <div
        className="flex h-[26px] shrink-0 cursor-pointer items-center justify-between border-b border-line px-[10px] transition-colors duration-[90ms] hover:bg-surface-2"
        data-testid="diagnostics-header"
        title="Close the list"
        onClick={(event) => {
          if ((event.target as HTMLElement).closest("button")) return;
          onClose();
        }}
      >
        {/* Named, not counted: "3 findings" tells a writer nothing, and
            severity carried only by a coloured bar is severity carried by
            colour alone. */}
        <span className="t-micro text-ink-2">
          {summarise(rows)}
        </span>
        {documents.length > 1 ? (
          /* One flat list of every previewed document's diagnostics, with
             nothing saying which was which. Offered only where it is a
             question: one previewed document is the ordinary case and a
             filter with one option is furniture. */
          <select
            value={only}
            aria-label="Which document"
            data-testid="diagnostics-document"
            className="t-micro ml-auto mr-2 rounded-[3px] border border-line bg-surface px-1 text-ink-2"
            onClick={(event) => event.stopPropagation()}
            onChange={(event) => setOnly(event.target.value)}
          >
            <option value="">Every document</option>
            {documents.map((name) => (
              <option key={name} value={name}>
                {name.split("/").pop()}
              </option>
            ))}
          </select>
        ) : null}
        <button className="t-micro text-ink-3 hover:text-ink" onClick={onClose}>
          Close
        </button>
      </div>
      {shellEscape === "asked" ? (
        <div
          className="shrink-0 border-b border-line bg-surface-2 px-3 py-2"
          data-testid="shell-escape-ask"
        >
          <p className="t-ui text-ink">
            This project asks for shell escape, which lets the build run
            programs.
          </p>
          <div className="mt-1 flex flex-wrap items-center gap-3">
            <button
              className="ghost-button h-[24px] px-3 t-micro"
              data-testid="shell-escape-allow"
              disabled={allowing === "running"}
              onClick={() => void allowShellEscape()}
            >
              {allowing === "running"
                ? "Allowing"
                : allowing === "asked"
                  ? "Yes, allow it on this computer"
                  : "Allow"}
            </button>
            <span className="t-meta text-ink-2">
              {allowing === "asked"
                ? "Every build of this project here may run any program the document names, until you revoke it in Settings."
                : "Asked in nexttex.toml; answered once per project, on this computer."}
            </span>
            {allowSaid ? <span className="t-meta text-error">{allowSaid}</span> : null}
          </div>
        </div>
      ) : null}
      {summary ? (
        <div
          className="shrink-0 border-b border-line bg-surface-2 px-3 py-2"
          data-testid="build-summary"
        >
          <p className="t-ui text-ink">
            <span className="text-error">Start here. </span>
            {summary.headline}
            {summary.file ? (
              <button
                className="quiet t-micro ml-2"
                onClick={() =>
                  summary.file && onJump(summary.file, summary.line ?? 1)
                }
              >
                {summary.file.split("/").pop()}
                {summary.line ? `:${summary.line}` : ""}
              </button>
            ) : null}
          </p>
          {/* Deliberately not `summary.detail`: it is the same sentence the
              row's own expansion shows, and repeating it here cost the
              list the room it needed to show the row. */}
          {summary.fix ? (
            <p className="t-meta mt-1 text-ink-2">
              <span className="text-ink-3">What to do: </span>
              {summary.fix}
            </p>
          ) : null}
          {summary.note ? (
            <p className="t-micro mt-1 text-ink-3">{summary.note}</p>
          ) : null}
        </div>
      ) : null}
      <div className="min-h-0 flex-1 overflow-auto">
        {rows.map((item) => {
          const bar = item.severity === "error" ? "bg-error" : "bg-warn";
          const key = rowKey(item);
          const open = expanded === key;
          return (
            <div key={key} className="group">
              {/* A plain div holding two siblings, rather than a
                  role="button" with a real button inside it. That shape is
                  the axe rule `nested-interactive`, impact serious: the
                  outer element is announced as one button and the inner
                  one is either unreachable or folded into its name. The
                  row's own job, opening the diagnostic and jumping to it,
                  belongs to a real button covering the part of the row
                  that says what the error is; Fix sits beside it. */}
              <div
                data-selected={selected === key ? "true" : undefined}
                className={`relative flex h-[28px] items-center hover:bg-surface-2 ${
                  selected === key ? "bg-surface-2" : ""
                }`}
              >
                <span className={`absolute left-0 h-full w-[3px] ${bar}`} />
                {selected === key ? (
                  <span className="absolute left-[3px] h-full w-[2px] bg-pen" />
                ) : null}
                <button
                  className="flex h-full min-w-0 flex-1 cursor-pointer items-center text-left"
                  aria-expanded={open}
                  onClick={() => {
                    setSelected(key);
                    setExpanded(open ? null : key);
                    if (item.file && item.line) onJump(item.file, item.line);
                  }}
                >
                <span className="ml-[6px] w-2 shrink-0 text-ink-3 opacity-0 group-hover:opacity-100">
                  <svg width="8" height="8" viewBox="0 0 8 8" aria-hidden>
                    <path
                      d={open ? "M0 2 L4 6 L8 2" : "M2 0 L6 4 L2 8"}
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.4"
                    />
                  </svg>
                </span>
                <span className="t-code-sm w-[40px] shrink-0 pr-1 text-right text-ink-3 tnum">
                  {item.line ?? ""}
                </span>
                <span className="t-meta ml-2 min-w-0 flex-1 truncate text-ink">
                  {item.message}
                </span>
                {item.file && item.file !== activePath ? (
                  <span className="t-micro shrink-0 px-2 text-ink-3">
                    {item.file.split("/").pop()}
                  </span>
                ) : null}
                </button>
                <button
                  className="ghost-button mr-2 h-[22px] nx-tap [--nx-tap-y:22px] shrink-0 px-2 t-micro hoverable:opacity-0 hoverable:group-hover:opacity-100 focus:opacity-100"
                  onClick={(event) => {
                    event.stopPropagation();
                    onFix(
                      `Fix: ${item.message}` +
                        (item.file ? ` (${item.file}:${item.line ?? 0})` : ""),
                    );
                  }}
                >
                  Fix
                </button>
                {/* The one thing a writer does with an error message that
                    NextTex cannot do for them: take it somewhere else, to
                    a search or to a colleague. It was selectable text
                    inside a button, which means selecting it opened the
                    row and jumped the editor. */}
                <button
                  className="ghost-button mr-2 h-[22px] nx-tap [--nx-tap-y:22px] shrink-0 px-2 t-micro hoverable:opacity-0 hoverable:group-hover:opacity-100 focus:opacity-100"
                  data-testid="diagnostic-copy"
                  onClick={(event) => {
                    event.stopPropagation();
                    const where = item.file
                      ? `${item.file}:${item.line ?? 0}: `
                      : "";
                    void navigator.clipboard
                      ?.writeText(`${where}${item.message ?? ""}`)
                      .catch(() => undefined);
                  }}
                >
                  Copy
                </button>
              </div>
              {open && item.explain ? (
                <div className="ml-[40px] border-l border-line bg-surface-2 px-3 py-2">
                  <p className="t-ui text-ink">{item.explain.title}</p>
                  <p className="t-meta mt-1 text-ink-2">{item.explain.detail}</p>
                  <p className="t-meta mt-2 text-ink-2">
                    <span className="text-ink-3">What to do: </span>
                    {item.explain.fix}
                  </p>
                  {item.missingFile ? (
                    <InstallPackage file={item.missingFile} />
                  ) : null}
                </div>
              ) : null}
              {open && item.context ? (
                <pre className="t-code-sm ml-[40px] max-h-[54px] overflow-auto border-l border-line bg-surface-2 px-2 py-1 text-ink-2">
                  {item.context}
                </pre>
              ) : null}
              {/* The raw log, in the place a few lines of it already go.
                  Section 7 of the design document rejects a bottom console
                  with Problems, Output and Terminal tabs; this is what
                  keeping the log reachable looks like without one. */}
              {open ? (
                <div className="ml-[40px] border-l border-line bg-surface-2 px-2 py-1">
                  {rawLog[item.document ?? ""] === undefined ? (
                    <button
                      className="quiet t-micro"
                      data-testid="show-raw-log"
                      onClick={() => void showLog(item.document ?? "")}
                    >
                      Show the raw log
                    </button>
                  ) : (
                    <pre className="t-code-sm max-h-[220px] overflow-auto whitespace-pre-wrap text-ink-3">
                      {rawLog[item.document ?? ""] || "The log is empty."}
                    </pre>
                  )}
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}
