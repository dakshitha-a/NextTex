import { Suspense, lazy, useMemo, type ReactNode } from "react";
import api from "../api";
import { download } from "../chrome";
import { Button } from "../ui/Button";
import { RunIcon, StopIcon } from "../ui/icons";
import { useStore } from "../store";
import { isScript } from "./file-kinds";
import PaneHeader from "./PaneHeader";
import TabStrip, { middleTruncate, type MenuItem, type StripTab } from "./TabStrip";
import { shortcut } from "../keys";

/** Fetched when somebody else turns up, which for most sessions is never.
 *  It draws nothing at all until then, so the parent decides whether to
 *  mount it and the chunk follows: `bundle.initial_kb` is measured on the
 *  entry script and this is four kilobytes of it. */
const Collaborators = lazy(() => import("./Collaborators"));

/** The source pane's header: the open files as tabs, in one PaneHeader.
 *
 *  This says what the source strip's tabs are, an open file each with its
 *  extension and its error count, and what its menu does.  How a tab is
 *  drawn, how the strip overflows and how a click on it is read belong to
 *  TabStrip, which the preview header shares.
 */
export default function SourceHeader({
  onSelect,
  onClose,
  onCloseTabs,
  onDuplicate,
  onRunScript,
  onStopScript,
  onHeaderClick,
  leading,
  trailing,
}: {
  onSelect: (path: string) => void;
  onClose: (path: string) => void;
  /** Everything the right-click menu can do to the strip.  One prop rather
   *  than one per item: it is the signature of `afterClosing`, which does
   *  the thinking, so this component has nothing left to work out. */
  onCloseTabs: (what: "others" | "all" | "right", path: string) => void;
  onDuplicate: (path: string) => void;
  /** Run the script in front, or stop it.  The control sits at the
   *  strip's end only while the tab in front is a `.py`. */
  onRunScript: (path: string) => void;
  onStopScript: (path: string) => void;
  /** A click on the tab in front or the empty run: fold, or double-click
   *  for writing mode.  Absent below 900px, where nothing folds. */
  onHeaderClick?: () => void;
  leading?: ReactNode;
  trailing?: ReactNode;
}) {
  const tabs = useStore((s) => s.tabs);
  const activePath = useStore((s) => s.activePath);
  const projectId = useStore((s) => s.projectId);
  const diagnostics = useStore((s) => s.diagnostics);
  // Whether the strip has anything to say at all. Offline counts: a writer
  // whose typing is not reaching the file has to be told, collaborators or
  // not.
  const others = useStore((s) => s.collaborators.length);
  const connection = useStore((s) => s.connection);
  const anybodyElse = others > 0 || connection === "offline";
  const script = useStore((s) => s.script);
  // The files Claude has edited in the turn that is running, for the pen
  // underline: the one place the pen appears on a strip.
  const thinking = useStore((s) => s.thinking);
  const turnEdits = useStore((s) => s.turnEdits);
  const runnable = activePath !== null && isScript(activePath);
  const runningThis = runnable && script?.path === activePath && script.running;

  const errorCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const item of diagnostics) {
      if (item.severity !== "error" || !item.file) continue;
      counts.set(item.file, (counts.get(item.file) ?? 0) + 1);
    }
    return counts;
  }, [diagnostics]);

  const strip: StripTab[] = tabs.map((tab) => {
    const name = tab.path.split("/").pop() ?? tab.path;
    const dot = name.lastIndexOf(".");
    const stem = dot > 0 ? name.slice(0, dot) : name;
    const extension = dot > 0 ? name.slice(dot) : "";
    const errors = errorCounts.get(tab.path) ?? 0;
    return {
      path: tab.path,
      label: middleTruncate(stem, 18),
      extension,
      extensionTone: errors ? "error" : "quiet",
      title: errors
        ? `${tab.path}, ${errors} ${errors === 1 ? "error" : "errors"}`
        : tab.path,
      active: tab.path === activePath,
      pen: thinking && turnEdits.includes(tab.path),
      closeLabel: `Close ${name}`,
      // A number, not a coloured dot: the count says the same thing
      // without depending on being able to see the colour.
      badge: errors ? (
        <span
          className="t-meta tnum font-medium text-error"
          title={`${errors} ${errors === 1 ? "error" : "errors"} in this file`}
        >
          {errors}
        </span>
      ) : undefined,
    };
  });

  const menuFor = (path: string): MenuItem[] => {
    const at = tabs.findIndex((tab) => tab.path === path);
    return [
      // "Close the others" with nothing else open, and "to the right" from
      // the last tab, are the two items here that can have nothing to do.
      { key: "others", label: "Close the others", off: tabs.length < 2,
        run: () => onCloseTabs("others", path) },
      { key: "right", label: "Close all to the right", off: at < 0 || at >= tabs.length - 1,
        run: () => onCloseTabs("right", path) },
      { key: "all", label: "Close all", run: () => onCloseTabs("all", path) },
      // Closing tabs and taking a copy of a file are not the same subject.
      { key: "rule:copy", rule: true },
      { key: "duplicate", label: "Duplicate", run: () => onDuplicate(path) },
      // The file as it stands on disk, the same route the tree's row menu
      // takes.  A figure's viewer has its own; this is for the files the
      // editor holds, whose only download was in the tree.
      { key: "download", label: "Download", off: !projectId,
        run: () => projectId && void download(api.downloadUrl(projectId, { path }), path.split("/").pop() ?? path) },
    ];
  };

  return (
    <PaneHeader
      testId="editor-header"
      leading={leading}
      trailing={
        anybodyElse || trailing || runnable ? (
          <>
            {/* The script in front runs from here, and from Mod-Enter in
                the editor.  Stop replaces it while the run is going. */}
            {runnable && activePath ? (
              runningThis ? (
                <Button
                  size="inline"
                  data-testid="stop-script"
                  title="Stop this script"
                  onClick={() => onStopScript(activePath)}
                >
                  <StopIcon size={13} /> Stop
                </Button>
              ) : (
                <Button
                  size="inline"
                  data-testid="run-script"
                  title={`Run this script (${shortcut("Mod-Enter").both})`}
                  onClick={() => onRunScript(activePath)}
                >
                  <RunIcon size={13} /> Run
                </Button>
              )
            ) : null}
            {/* Who else is here, at the strip's end. A project with one
                writer looks exactly as it did, and does not download this. */}
            {anybodyElse ? (
              <Suspense fallback={null}>
                <Collaborators />
              </Suspense>
            ) : null}
            {trailing}
          </>
        ) : undefined
      }
    >
      <TabStrip
        kind="source"
        tabs={strip}
        ariaLabel="Open files"
        hiddenLabel="open"
        hiddenName={(path) => path.split("/").pop() ?? path}
        onSelect={onSelect}
        onClose={onClose}
        menuFor={menuFor}
        menuTestId="tab-menu"
        onHeaderClick={onHeaderClick}
        headerTitle="Click to fold the source away, double-click to write"
      />
    </PaneHeader>
  );
}
