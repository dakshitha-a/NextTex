import { EditorView } from "@codemirror/view";
import type { Extension } from "@codemirror/state";
import { captionOffset, figureFor, tableFromClipboard } from "../paste-table";

/** What the clipboard holds becomes what the document needs.
 *
 *  Two pastes into a `.tex` buffer are caught before CodeMirror's own:
 *  comma- or tab-separated text becomes a booktabs table at the caret,
 *  one transaction so one undo removes it, with the caret left in the
 *  caption; and an image becomes a file under `figures/`, saved through
 *  the upload route the tree's own paste uses, and an `\includegraphics`
 *  inside a figure environment written for it once the save answers.
 *  Neither applies inside a verbatim block, where what was pasted is
 *  what was meant, and neither applies in a script or a `.bib`.
 *
 *  The upload is the caller's, since it needs the project; this file
 *  knows only the clipboard and the view.
 */

const VERBATIM = /\\(begin|end)\{(verbatim|Verbatim|lstlisting|minted|comment)\*?\}/g;

/** Whether `pos` is inside a verbatim-like environment: the nearest
 *  `\begin` or `\end` of one above it is a `\begin`. */
export function insideVerbatim(text: string, pos: number): boolean {
  let open = false;
  for (const found of text.slice(0, pos).matchAll(VERBATIM)) {
    open = found[1] === "begin";
  }
  return open;
}

export function pasteExtension(options: {
  /** Whether the buffer in front is LaTeX rather than a script or a .bib. */
  isTex: () => boolean;
  /** Save the image under `figures/` and answer its project path. */
  upload: (file: File) => Promise<string>;
  /** Say what went wrong, in the corner. */
  complain: (message: string) => void;
}): Extension {
  return EditorView.domEventHandlers({
    paste(event, view) {
      const data = event.clipboardData;
      if (!data || !options.isTex()) return false;
      const head = view.state.selection.main.head;
      if (insideVerbatim(view.state.doc.toString(), head)) return false;

      const image = Array.from(data.files).find((file) => file.type.startsWith("image/"));
      if (image) {
        event.preventDefault();
        options
          .upload(image)
          .then((path) => {
            // At the caret as it is when the save answers, not as it was.
            const at = view.state.selection.main.from;
            const figure = figureFor(path);
            view.dispatch({
              changes: { from: at, to: view.state.selection.main.to, insert: figure },
              selection: { anchor: at + captionOffset(figure) },
              userEvent: "input.paste",
              scrollIntoView: true,
            });
          })
          .catch((error: unknown) => {
            options.complain(`Could not save the pasted image: ${(error as Error).message}`);
          });
        return true;
      }

      const text = data.getData("text/plain");
      if (!text) return false;
      const table = tableFromClipboard(text);
      if (!table) return false;
      event.preventDefault();
      const { from, to } = view.state.selection.main;
      view.dispatch({
        changes: { from, to, insert: table },
        selection: { anchor: from + captionOffset(table) },
        userEvent: "input.paste",
        scrollIntoView: true,
      });
      return true;
    },
  });
}
