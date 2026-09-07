import { useEffect, useState } from "react";
import { APPEARANCE_CHANGED, type EditorTheme } from "./appearance";

/** Whether the editor has been lit on its own terms, live.
 *
 *  Read off the root's `data-editor-theme`, which `applyAppearance` sets
 *  before the first paint, rather than held in the store: it is a
 *  preference of the machine rather than of the project, and routing it
 *  through the store would re-render every subscriber whenever it changed.
 */
export function useEditorTheme(): EditorTheme {
  const read = (): EditorTheme =>
    (document.documentElement.dataset.editorTheme as EditorTheme) ?? "match";
  const [theme, setTheme] = useState(read);
  useEffect(() => {
    const onChange = () => setTheme(read());
    window.addEventListener(APPEARANCE_CHANGED, onChange);
    return () => window.removeEventListener(APPEARANCE_CHANGED, onChange);
  }, []);
  return theme;
}
