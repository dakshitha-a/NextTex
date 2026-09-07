import { useEffect, useState } from "react";
import {
  APPEARANCE_CHANGED,
  type EditorTheme,
  type SyntaxMode,
} from "./appearance";

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

/** Whether control sequences are coloured by family, live.
 *
 *  Read the same way and for the same reasons as the editor's theme: it is
 *  a preference of the machine rather than of the project, `applyAppearance`
 *  stamps it before the first paint, and putting it in the store would
 *  re-render every subscriber each time it changed.
 */
export function useEditorSyntax(): SyntaxMode {
  const read = (): SyntaxMode =>
    (document.documentElement.dataset.syntax as SyntaxMode) ?? "subtle";
  const [mode, setMode] = useState(read);
  useEffect(() => {
    const onChange = () => setMode(read());
    window.addEventListener(APPEARANCE_CHANGED, onChange);
    return () => window.removeEventListener(APPEARANCE_CHANGED, onChange);
  }, []);
  return mode;
}

/** Whether the prose is spell checked, live.  Read like the other two. */
export function useSpelling(): boolean {
  const read = () => document.documentElement.dataset.spelling === "on";
  const [on, setOn] = useState(read);
  useEffect(() => {
    const onChange = () => setOn(read());
    window.addEventListener(APPEARANCE_CHANGED, onChange);
    return () => window.removeEventListener(APPEARANCE_CHANGED, onChange);
  }, []);
  return on;
}
