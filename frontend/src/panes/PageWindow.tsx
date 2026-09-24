import { Suspense, lazy, useEffect, useState } from "react";
import api, { captureToken, countOf, engineOf, shellEscapeOf } from "../api";
import { connect, set, useStore } from "../store";
import Boundary from "../Boundary";
import Logo from "../Logo";
import type { PageWindowRequest } from "../page-window";

/** The typeset page on its own, for a second monitor.
 *
 *  Opened from the preview tab's menu into a new browser window, on the
 *  URL `page-window.ts` builds.  It opens the project the way the main
 *  window does, subscribes to the same event stream, and mounts the PDF
 *  pane and nothing else: no rail, no editor, no agent.  A build in the
 *  other window is a `compile_done` here and the page redraws; this
 *  window's own zoom, view mode and find are the pane's own, and the
 *  `nexttex.pdf.*` preferences are shared with the main window since
 *  they live in the same browser, which is what a second monitor wants.
 *
 *  A double-click on the page has nowhere to go, since there is no
 *  editor here, and does nothing.
 */
const Pdf = lazy(() => import("./Pdf"));

export default function PageWindow({ request }: { request: PageWindowRequest }) {
  const [state, setState] = useState<"opening" | "open" | string>("opening");
  const projectName = useStore((s) => s.projectName);
  const activePreview = useStore((s) => s.activePreview);

  useEffect(() => {
    captureToken();
    let stopped = false;
    (async () => {
      try {
        const project = await api.open(request.projectId);
        if (stopped) return;
        const previewed: string[] = (project as any).previews ?? [];
        const visible: string = (project as any).visible || previewed[0] || "";
        const showing = previewed.includes(request.document) ? request.document : visible;
        set({
          projectId: request.projectId,
          projectName: project.name ?? "",
          tree: project.tree,
          previews: previewed,
          activePreview: showing,
          candidates: (project as any).candidates ?? [],
          owners: (project as any).owners ?? {},
          settings: {
            autocompile: project.autocompile !== false,
            markErrors: project.markErrors !== false,
            markWarnings: project.markWarnings === true,
            engine: engineOf(project.engine),
            shellEscape: shellEscapeOf(project.shellEscape),
            pageLimit: countOf(project.pageLimit),
            blind: project.blind === true,
            pdfa: project.pdfa === true,
            language: typeof project.language === "string" ? project.language : "",
          },
        });
        connect(request.projectId);
        document.title = `${showing.split("/").pop() || project.name} · NextTex`;
        setState("open");
        // A page that has never been built in this session is built now,
        // so the window does not open on the absence of one.
        api.compile(request.projectId, false, showing).catch(() => undefined);
      } catch (error: any) {
        if (!stopped) setState(error?.message || "That project could not be opened.");
      }
    })();
    return () => {
      stopped = true;
    };
  }, [request.projectId, request.document]);

  if (state !== "open") {
    return (
      <div className="flex h-full items-center justify-center bg-surface-2" data-testid="page-window-state">
        <p className="t-meta text-ink-2">{state === "opening" ? "Opening the page" : state}</p>
      </div>
    );
  }
  return (
    <div className="flex h-full flex-col bg-surface-2" data-testid="page-window">
      {/* The title row: 36 px on the second surface with no rule, like
          the pane headers, the mark, the project at 500 and the document
          in the third ink. */}
      <div className="flex h-[36px] shrink-0 items-center gap-3 bg-surface-2 px-3">
        <Logo />
        <span className="t-ui min-w-0 truncate font-medium text-ink">{projectName}</span>
        <span className="t-meta min-w-0 truncate text-ink-3" data-testid="page-window-document">
          {activePreview}
        </span>
      </div>
      <div className="relative min-h-0 flex-1">
        <Boundary>
          <Suspense fallback={<div className="h-full bg-surface-2" />}>
            <Pdf document={activePreview} handleRef={() => undefined} onNavigate={() => undefined} />
          </Suspense>
        </Boundary>
      </div>
    </div>
  );
}
