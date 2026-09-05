import { useEffect, useState } from "react";
import api, { startDownload, type ProjectSummary } from "../api";

/** The project list.  Downloads live here as well as inside an open project:
 *  the moment a copy is most wanted is often before opening anything. */
export default function Projects({
  onOpen,
  onClose,
  canClose,
}: {
  onOpen: (id: string) => void;
  onClose?: () => void;
  canClose: boolean;
}) {
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [path, setPath] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = async () => {
    try {
      const result = await api.projects();
      setProjects(result.projects);
    } catch (problem: any) {
      setError(problem.message);
    }
  };

  useEffect(() => {
    refresh();
  }, []);

  const add = async () => {
    if (!path.trim()) return;
    setError(null);
    try {
      const project = await api.addProject(path.trim());
      setPath("");
      await refresh();
      if (project.id) onOpen(project.id);
    } catch (problem: any) {
      setError(problem.message);
    }
  };

  const takePdf = async (project: ProjectSummary) => {
    if (!project.id) return;
    setBusy(project.id);
    setError(null);
    try {
      // The PDF may need building first, so this is a fetch rather than a
      // plain link: a failed build should say why, not download an error.
      const response = await fetch(
        api.downloadUrl(project.id, { format: "pdf" }),
        { credentials: "same-origin" },
      );
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.detail || "the project did not typeset");
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `${project.name}.pdf`;
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (problem: any) {
      setError(`${project.name}: ${problem.message}`);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="flex h-full flex-col items-center overflow-auto bg-surround px-6 py-10">
      <div className="w-full max-w-[680px]">
        <div className="flex items-baseline justify-between">
          <h1 className="t-display">Writing projects</h1>
          {canClose ? (
            <button className="t-ui text-ink-2 hover:text-ink" onClick={onClose}>
              Back
            </button>
          ) : null}
        </div>

        <div className="mt-6 rounded-[5px] border border-line bg-surface">
          {projects.length === 0 ? (
            <p className="t-meta p-4 text-ink-3">
              No projects yet. Give NextTex the path to a folder containing a
              LaTeX document; nothing is copied or moved.
            </p>
          ) : null}
          {projects.map((project) => (
            <div
              key={project.path}
              className="group flex items-center gap-3 border-b border-line px-4 py-3 last:border-b-0"
            >
              <div className="min-w-0 flex-1">
                <button
                  className="t-ui-lg block max-w-full truncate font-serif text-ink disabled:text-ink-3"
                  disabled={project.missing || !project.id}
                  onClick={() => project.id && onOpen(project.id)}
                >
                  {project.name}
                </button>
                <div className="t-code-sm truncate text-ink-3">{project.path}</div>
                {project.missing ? (
                  <div className="t-micro mt-1 text-warn">
                    This folder is no longer there.
                  </div>
                ) : null}
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <button
                  className="h-[28px] rounded-[3px] border border-line px-2 t-micro text-ink-2 hover:text-ink disabled:opacity-40"
                  disabled={!project.id || project.missing}
                  onClick={() =>
                    project.id &&
                    startDownload(api.downloadUrl(project.id, { format: "zip" }))
                  }
                >
                  Zip
                </button>
                <button
                  className="h-[28px] rounded-[3px] border border-line px-2 t-micro text-ink-2 hover:text-ink disabled:opacity-40"
                  disabled={!project.id || project.missing || busy === project.id}
                  onClick={() => takePdf(project)}
                >
                  {busy === project.id ? "Typesetting" : "PDF"}
                </button>
                <button
                  className="h-[28px] rounded-[3px] px-2 t-micro text-ink-3 hover:text-error"
                  onClick={async () => {
                    if (!project.id) return;
                    if (!window.confirm(`Remove ${project.name} from NextTex? The files stay where they are.`)) return;
                    await api.forgetProject(project.id);
                    refresh();
                  }}
                >
                  Remove
                </button>
              </div>
            </div>
          ))}
        </div>

        <div className="mt-4 flex gap-2">
          <input
            value={path}
            placeholder="/path/to/your/writing/project"
            className="t-code-sm h-[28px] flex-1 rounded-[3px] border border-line bg-surface px-2 outline-none placeholder:text-ink-3"
            onChange={(event) => setPath(event.target.value)}
            onKeyDown={(event) => event.key === "Enter" && add()}
          />
          <button
            className="h-[28px] rounded-[3px] bg-pen px-3 t-ui font-medium text-white"
            onClick={add}
          >
            Add project
          </button>
        </div>
        {error ? <p className="t-meta mt-3 text-error">{error}</p> : null}
      </div>
    </div>
  );
}
