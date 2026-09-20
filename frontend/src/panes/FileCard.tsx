import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { TreeNode } from "../api";
import { useStore } from "../store";
import { sizeOf } from "../size";
import { FloatingCard } from "../ui/FloatingCard";
import { thumbnail, type Thumbnail } from "./thumbnails";

/** The card that opens beside a tree row for a file the editor cannot
 *  edit: a thumbnail, the file's name, and one line with its pixel size,
 *  its byte size and its folder, as the direction page draws it.
 *
 *  Fixed rather than absolute, because the tree scrolls and a card inside
 *  a scrolling box is clipped at its edge; placed under the row's left
 *  edge and moved above it when there is no room beneath. It takes no
 *  pointer events, since it has no controls and must never sit between
 *  the pointer and the row it describes. Loaded only when a hover has
 *  armed, so the tree, which is in the entry chunk, carries none of it.
 */

const WIDTH = 232;
const GAP = 2;

export default function FileCard({
  node,
  anchor,
}: {
  node: TreeNode;
  /** The row's box, in viewport pixels. */
  anchor: { left: number; top: number; bottom: number; width: number };
}) {
  const projectId = useStore((s) => s.projectId);
  const [thumb, setThumb] = useState<Thumbnail | null>(null);
  const [top, setTop] = useState<number>(anchor.bottom + GAP);
  const el = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let live = true;
    setThumb(null);
    if (projectId) {
      void thumbnail(projectId, node.path, node.mtime ?? node.size ?? 0).then((made) => {
        if (live) setThumb(made);
      });
    }
    return () => {
      live = false;
    };
  }, [projectId, node.path, node.mtime, node.size]);

  // Above the row when the card would run off the bottom of the window.
  useLayoutEffect(() => {
    const box = el.current?.getBoundingClientRect();
    if (!box) return;
    const below = anchor.bottom + GAP;
    if (below + box.height > window.innerHeight - 8) {
      setTop(Math.max(8, anchor.top - GAP - box.height));
    } else {
      setTop(below);
    }
  }, [anchor, thumb]);

  const folder = node.path.includes("/") ? node.path.slice(0, node.path.lastIndexOf("/")) : "";
  const facts = [
    thumb && thumb.width ? `${thumb.width} × ${thumb.height}${thumb.unit === "pt" ? " pt" : ""}` : "",
    node.size !== undefined ? sizeOf(node.size) : "",
    folder ? `in ${folder}` : "at the root",
  ].filter(Boolean);

  return (
    <FloatingCard
      ref={el}
      testid="file-card"
      className="pointer-events-none fixed z-40 p-[10px_12px]"
      style={{ left: anchor.left + 48, top, width: Math.min(WIDTH, Math.max(160, anchor.width - 56)) }}
      role="tooltip"
    >
      {thumb?.url ? (
        <div className="nx-thumb">
          <img src={thumb.url} alt="" />
        </div>
      ) : null}
      <p className="text-[13px] leading-[18px] font-medium text-ink">{node.name}</p>
      <p className="t-meta text-ink-3">{facts.join(", ")}</p>
    </FloatingCard>
  );
}
