import { useEffect, useMemo, useRef, useState } from "react";
import { Chevron } from "../App";
import api from "../api";
import { get, set, useStore } from "../store";
import { useDismiss } from "../useDismiss";
import { collisions, keptBothName, namesIn } from "../tree";
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

  const close = () => {
    // Whatever closed this, the picked files go with it and focus comes
    // back to the control that started it -- otherwise the writer is left
    // at the top of the document with no idea where they are.
    staging.returnTo?.focus();
    onClose();
  };
  useDismiss(card, true, close);

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
      try {
        window.localStorage.setItem(`nexttex.upload.${projectId}`, directory);
      } catch {
        /* private browsing: it just will not be remembered */
      }
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
    <div
      ref={card}
      role="dialog"
      aria-labelledby="upload-heading"
      className="nx-arrive fixed z-40 w-[264px] rounded-[5px] border border-line bg-surface shadow-float"
      style={{
        left: Math.min(staging.at.x, window.innerWidth - 272),
        top: Math.min(staging.at.y, window.innerHeight - 260),
      }}
      data-testid="upload-staging"
    >
      <div id="upload-heading" className="t-ui truncate px-[10px] pt-2 text-ink">
        {heading}
      </div>

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
      ) : null}

      <div className="mt-1 border-t border-line">
        <div className="max-h-[132px] overflow-auto py-1">
          {staging.files.map((file) => {
            const clash = clashing.includes(file.name);
            const skip = skipped.has(file.name);
            return (
              <div
                key={file.name}
                className="flex h-[22px] items-center gap-2 px-[10px]"
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
                  <span className="t-micro shrink-0 text-ink-3">
                    {policy === KEEP ? "keeps both" : "replaces"}
                  </span>
                ) : null}
                <button
                  className="quiet t-micro shrink-0"
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
                  Skip
                </button>
              </div>
            );
          })}
        </div>
      </div>

      {wanted.length ? (
        <div className="border-t border-line px-[10px] py-2">
          <p className="t-meta text-ink-2">
            {wanted.length === 1
              ? "1 file is already there."
              : `${wanted.length} files are already there.`}
          </p>
          <div
            role="group"
            aria-label="What to do about files that are already there"
            className="mt-2 flex w-fit overflow-hidden rounded-[3px] border border-line"
          >
            {[
              [REPLACE, "Replace"],
              [KEEP, "Keep both"],
            ].map(([value, label]) => (
              <button
                key={value}
                aria-pressed={policy === value}
                className={`t-micro border-b-2 px-2 py-[3px] transition-colors duration-[90ms] ${
                  policy === value
                    ? "border-hint bg-surface text-ink"
                    : "border-transparent text-ink-3 hover:text-hint"
                }`}
                onClick={() => setPolicy(value as typeof REPLACE)}
              >
                {label}
              </button>
            ))}
          </div>
          <p className="t-micro mt-2 text-ink-3">
            {policy === REPLACE
              ? "What it replaces stays in that file's history."
              : wanted.length === 1
                ? `The new one comes in as ${keptBothName(
                    namesIn(tree, directory),
                    wanted[0],
                  )}.`
                : "The new ones come in numbered."}
          </p>
        </div>
      ) : null}

      <div className="flex h-[32px] items-center justify-end gap-2 border-t border-line px-[10px]">
        <button
          className="ghost-button h-[28px] px-3 t-ui"
          disabled={!sending.length || busy}
          onClick={send}
        >
          Upload
        </button>
        <button className="quiet h-[28px] px-2 t-ui" onClick={close}>
          Cancel
        </button>
      </div>
    </div>
  );
}
