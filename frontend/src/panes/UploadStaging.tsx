import { useEffect, useMemo, useRef, useState } from "react";
import api from "../api";
import { writeStored } from "../appearance";
import { get, set, useStore } from "../store";
import { Sheet } from "../ui/Sheet";
import { Button } from "../ui/Button";
import { Heading, Segmented } from "../ui/controls";
import { collisions, keptBothName, namesIn } from "../tree";
import { whatDidNotLand } from "../upload-report";
import FolderChooser from "./FolderChooser";

/** Where these files go, and what to do about the ones already there.
 *
 *  One surface for two questions, because they are one decision.  Asking
 *  "which folder?" before the file picker means two deliberate steps
 *  before you have chosen anything; asking after means this can be opened
 *  already knowing the filenames -- so it can answer "where" and "one of
 *  these exists" together instead of walking the writer through a wizard.
 *
 *  It therefore only appears when there is something to ask.  A file
 *  dropped on a folder has named its destination by being dropped there,
 *  and goes straight in unless a name collides.
 */

const KEEP = "keep-both";
const REPLACE = "replace";

export type Staging = {
  files: File[];
  /** Where the gesture implied, and whether that is open to question. */
  directory: string;
  askDestination: boolean;
  at: { x: number; y: number };
  /** Focus goes back here when this closes, however it closes. */
  returnTo?: HTMLElement | null;
};

export default function UploadStaging({
  staging,
  onClose,
  onDone,
}: {
  staging: Staging;
  onClose: () => void;
  onDone: (written: string[]) => void;
}) {
  const tree = useStore((s) => s.tree);
  const [directory, setDirectory] = useState(staging.directory);
  const [listOpen, setListOpen] = useState(false);
  const [skipped, setSkipped] = useState<Set<string>>(new Set());
  const [policy, setPolicy] = useState<typeof REPLACE | typeof KEEP>(REPLACE);
  const [busy, setBusy] = useState(false);
  const card = useRef<HTMLDivElement | null>(null);

  const names = useMemo(
    () => staging.files.map((file) => file.name),
    [staging.files],
  );
  const clashing = useMemo(
    () => collisions(tree, directory, names),
    [tree, directory, names],
  );
  const wanted = clashing.filter((name) => !skipped.has(name));

  /** What each clashing file would be called if both are kept.
   *
   *  Worked out here rather than in the row, and in order, because the
   *  answer for one upload depends on the ones before it: uploading both
   *  `plot.png` and `plot (2).png` into a folder that already has
   *  `plot.png` gives the first of them the name the second already has,
   *  and two rows each computed against the folder alone would both
   *  promise `plot (2).png`.
   *
   *  It says this per row rather than once underneath because underneath
   *  it could only name the file when there was exactly one of them --
   *  everything else got "The new ones come in numbered", which is the
   *  question the writer was asking, answered with the fact that it has an
   *  answer. */
  const keptNames = useMemo(() => {
    const taken = new Set(namesIn(tree, directory));
    const answer = new Map<string, string>();
    for (const name of names) {
      if (!clashing.includes(name)) continue;
      const next = keptBothName(taken, name);
      answer.set(name, next);
      taken.add(next);
    }
    return answer;
  }, [tree, directory, names, clashing]);

  const close = () => {
    // Whatever closed this, the picked files go with it and focus comes
    // back to the control that started it -- otherwise the writer is left
    // at the top of the document with no idea where they are.
    staging.returnTo?.focus();
    onClose();
  };

  // The destination row is the first thing that matters, so it takes focus.
  useEffect(() => {
    card.current?.querySelector<HTMLElement>("[data-destination]")?.focus();
  }, []);

  const send = async () => {
    const projectId = get().projectId;
    if (!projectId || busy) return;
    setBusy(true);
    const decisions: Record<string, string> = {};
    for (const name of names) {
      decisions[name] = skipped.has(name) ? "skip" : policy;
    }
    try {
      const answer = await api.uploadFiles(
        projectId,
        directory,
        staging.files.filter((file) => !skipped.has(file.name)),
        decisions,
      );
      writeStored(`nexttex.upload.${projectId}`, directory);
      const trouble = whatDidNotLand(answer.results ?? []);
      if (trouble) set({ error: trouble });
      onDone(answer.written ?? []);
    } catch (error: any) {
      set({ error: error.message });
      onClose();
    }
  };

  const heading =
    staging.files.length === 1
      ? `Upload ${staging.files[0].name}`
      : `Upload ${staging.files.length} files`;
  const sending = names.filter((name) => !skipped.has(name));

  return (
    <Sheet ref={card} open onClose={close} labelledBy="upload-heading" testid="upload-staging" width={380}>
      <Heading id="upload-heading" className="truncate pb-2">
        {heading}
      </Heading>

      {staging.askDestination ? (
        <FolderChooser
          tree={tree}
          directory={directory}
          open={listOpen}
          onToggle={() => setListOpen((value) => !value)}
          onSelect={(path, confirm) => {
            setDirectory(path);
            if (confirm) setListOpen(false);
          }}
        />
      ) : (
        // Dropped on a folder, the folder is the answer and there is no
        // choice to draw; but the sheet still opens to ask about a name
        // already there, and said nothing about where (Q-061).
        <p className="t-meta -mt-1 pb-1.5 text-ink-2" data-testid="upload-into">
          Into{" "}
          {directory ? <span className="t-code-sm text-ink">{directory}</span> : "the project's top folder"}
        </p>
      )}

      <div className="mt-1">
        <div className="nx-sheet-list">
          {staging.files.map((file) => {
            const clash = clashing.includes(file.name);
            const skip = skipped.has(file.name);
            return (
              <div
                key={file.name}
                className="nx-row"
                data-upload-row={file.name}
              >
                <span
                  dir="rtl"
                  className={`t-code-sm min-w-0 flex-1 truncate text-left ${
                    skip ? "text-ink-3" : "text-ink-2"
                  }`}
                  title={file.name}
                >
                  {file.name}
                </span>
                {clash && !skip ? (
                  <span
                    className="t-micro max-w-[45%] shrink-0 truncate text-ink-3"
                    title={
                      policy === KEEP
                        ? `Comes in as ${keptNames.get(file.name)}`
                        : "Replaces the file already there, which stays in its history"
                    }
                  >
                    {policy === KEEP
                      ? `becomes ${keptNames.get(file.name)}`
                      : "replaces"}
                  </span>
                ) : null}
                <Button
                  size="inline"
                  className={`shrink-0${skip ? " text-ink" : ""}`}
                  aria-pressed={skip}
                  data-tone={skip ? "on" : undefined}
                  onClick={() =>
                    setSkipped((current) => {
                      const next = new Set(current);
                      if (next.has(file.name)) next.delete(file.name);
                      else next.add(file.name);
                      return next;
                    })
                  }
                >
                  {skip ? "Skipped" : "Skip"}
                </Button>
              </div>
            );
          })}
        </div>
      </div>

      {wanted.length ? (
        <div className="pt-2">
          <p className="t-meta text-ink-2">
            {wanted.length === 1
              ? "1 file is already there."
              : `${wanted.length} files are already there.`}
          </p>
          <Segmented
            className="mt-2"
            label="What to do about files that are already there"
            value={policy}
            options={[
              { value: REPLACE, label: "Replace" },
              { value: KEEP, label: "Keep both" },
            ]}
            onChange={(value) => setPolicy(value)}
          />
          <p className="t-micro mt-2 text-ink-3">
            {policy === REPLACE
              ? "What it replaces stays in that file's history."
              : "Each one comes in beside the file it would have replaced."}
          </p>
        </div>
      ) : null}

      <div className="nx-sheet-foot">
        <Button onClick={close}>Cancel</Button>
        <Button variant="ghost" disabled={!sending.length || busy} onClick={send}>
          Upload
        </Button>
      </div>
    </Sheet>
  );
}
