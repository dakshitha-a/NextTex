import { useMemo } from "react";
import api from "../api";
import { startDownload } from "../api";
import { useStore } from "../store";
import { isRenderable } from "./file-kinds";

/** A file the editor cannot open, shown rather than refused.
 *
 *  This exists because of history, not in spite of it.  A replaced figure
 *  now keeps its previous versions, and the only route to a file's history
 *  is to make it the active document -- which, for a PNG, meant asking the
 *  editor to read bytes as text and failing.  Byte-safe history without
 *  this is history nobody can reach.
 *
 *  Deliberately not a viewer: no zoom, no pan, no page controls.  It says
 *  what the file is and offers the two things worth doing to it.
 */


export function readableSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export default function FileView({ path, size }: { path: string; size?: number }) {
  const projectId = useStore((s) => s.projectId);
  const stamp = useStore((s) => s.pdfStamp);
  const name = path.split("/").pop() ?? path;
  const source = useMemo(
    () =>
      projectId
        ? `${api.downloadUrl(projectId, { path })}&at=${stamp}`
        : "",
    [projectId, path, stamp],
  );

  return (
    <div
      className="flex h-full min-h-0 flex-col items-center justify-center bg-surface-2 p-4"
      data-testid="file-view"
    >
      {isRenderable(path) && source ? (
        <img
          src={source}
          alt={name}
          className="max-h-full max-w-full object-contain"
        />
      ) : (
        <>
          <p className="t-meta text-ink-3">
            {name}
            {size ? ` · ${readableSize(size)}` : ""}
          </p>
          <button
            className="ghost-button mt-3 h-[28px] px-3 t-ui"
            onClick={() =>
              projectId && startDownload(api.downloadUrl(projectId, { path }))
            }
          >
            Download
          </button>
        </>
      )}
    </div>
  );
}
