import { useRef, useState } from "react";
import api from "../api";
import { get, refreshContext, set, useStore } from "../store";

const KINDS: { key: "style" | "voice" | "source"; label: string; hint: string }[] = [
  {
    key: "style",
    label: "Template and formatting",
    hint: "A handbook, a style guide, a template Claude must follow.",
  },
  {
    key: "voice",
    label: "Writing voice",
    hint: "Papers or chapters you wrote, so new prose sounds like yours.",
  },
  {
    key: "source",
    label: "Background reading",
    hint: "Sources to draw on. Never copied — read and cited.",
  },
];

export default function ContextPanel() {
  const documents = useStore((s) => s.contextDocs);
  const stale = useStore((s) => s.contextStale);
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<"style" | "voice" | "source">("style");
  const input = useRef<HTMLInputElement | null>(null);

  const upload = async (files: File[]) => {
    const projectId = get().projectId;
    if (!projectId || !files.length) return;
    try {
      await api.uploadContext(projectId, kind, "", files);
      await refreshContext(projectId);
    } catch (error: any) {
      set({ error: error.message });
    }
  };

  return (
    <div className="shrink-0 border-t border-line">
      <button
        className="flex h-[26px] w-full items-center justify-between px-[10px] hover:bg-surface-2"
        onClick={() => setOpen(!open)}
      >
        <span className="t-micro text-ink-2">
          What Claude reads {documents.length ? `(${documents.length})` : ""}
        </span>
        <span className="t-micro text-ink-3">{open ? "Hide" : "Show"}</span>
      </button>
      {open ? (
        <div className="px-[10px] pb-[8px]">
          {KINDS.map((entry) => {
            const mine = documents.filter((item) => item.kind === entry.key);
            return (
              <div key={entry.key} className="mt-2">
                <div className="flex items-center justify-between">
                  <span className="t-micro text-ink-2">{entry.label}</span>
                  <button
                    className="t-micro text-ink-3 hover:text-ink"
                    onClick={() => {
                      setKind(entry.key);
                      input.current?.click();
                    }}
                  >
                    Add
                  </button>
                </div>
                {mine.length === 0 ? (
                  <p className="t-micro text-ink-3">{entry.hint}</p>
                ) : (
                  mine.map((document) => (
                    <div
                      key={document.id}
                      className="group flex items-center gap-2"
                    >
                      <span className="t-code-sm min-w-0 flex-1 truncate text-ink">
                        {document.filename}
                      </span>
                      <button
                        className="t-micro hidden text-ink-3 hover:text-error group-hover:block"
                        onClick={async () => {
                          const projectId = get().projectId;
                          if (!projectId) return;
                          await api.removeContext(projectId, document.id);
                          refreshContext(projectId);
                        }}
                      >
                        Remove
                      </button>
                    </div>
                  ))
                )}
                {stale.includes(entry.key) ? (
                  <button
                    className="t-micro mt-1 text-pen"
                    onClick={() => {
                      const projectId = get().projectId;
                      if (projectId) api.distill(projectId, entry.key);
                    }}
                  >
                    Read these now
                  </button>
                ) : null}
              </div>
            );
          })}
          <input
            ref={input}
            type="file"
            multiple
            className="hidden"
            onChange={(event) => {
              const files = Array.from(event.target.files ?? []);
              event.target.value = "";
              upload(files);
            }}
          />
        </div>
      ) : null}
    </div>
  );
}
