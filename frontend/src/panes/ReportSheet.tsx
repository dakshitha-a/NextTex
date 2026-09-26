import { useEffect, useState } from "react";
import api, { type Report } from "../api";
import { snapshot } from "../errors";
import { Button } from "../ui/Button";
import { Heading } from "../ui/controls";
import { Sheet } from "../ui/Sheet";

/** Report a problem, from the press to the text on the clipboard.
 *
 *  It was a branch of the update footer, so it could only be reached from
 *  the projects screen's app bar; the drawer's foot inside a project
 *  mounts it too now, since a problem is usually met with a document
 *  open.  The sheet asks for the report the moment it opens, once.
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

export default function ReportSheet({ onClose }: { onClose: () => void }) {
  const [trouble, setTrouble] = useState<Trouble>(null);

  // Ask for the report, try the clipboard while the click is still warm,
  // then show the card whatever the clipboard said.
  useEffect(() => {
    let live = true;
    setTrouble({ kind: "fetching" });
    (async () => {
      let report: Report;
      try {
        report = await api.report(snapshot(), navigator.userAgent);
      } catch (problem) {
        if (live) setTrouble({ kind: "error", message: String((problem as Error)?.message ?? problem) });
        return;
      }
      let copied = false;
      try {
        await navigator.clipboard?.writeText(report.text);
        copied = true;
      } catch {
        /* the card's own Copy is the way then */
      }
      if (live) setTrouble({ kind: "ready", report, copied, shown: false });
    })();
    return () => {
      live = false;
    };
  }, []);

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
          onClose={onClose}
        />
      )}
    </Sheet>
  );
}

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
            className="t-code-sm mt-3 max-h-80 overflow-auto whitespace-pre-wrap break-words rounded-control bg-surface p-3 text-ink-2"
            data-testid="report-text"
          >
            {report.text}
          </pre>
        ) : null}
      </Card>
    </div>
  );
}

/** A card on the second surface, shared with the update sheet. */
export function Card({
  children,
  sweeping,
}: {
  children: React.ReactNode;
  sweeping?: boolean;
}) {
  return (
    <div className="relative overflow-hidden rounded-card bg-surface-2 px-3 py-2.5">
      {sweeping ? <div className="hairline absolute inset-x-0 top-0 h-0.5" /> : null}
      {children}
    </div>
  );
}
