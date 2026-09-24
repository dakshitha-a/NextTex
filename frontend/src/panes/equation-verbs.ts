import { ApiError, saveBlob } from "../api";
import type { OnEquation } from "./math-hover";

/** Copy as SVG and Save as PNG under the maths, and one line under them
 *  that says what happened: the card stays while the pointer is on it,
 *  so the answer is read where the question was asked. */
export function equationVerbs(dom: HTMLElement, body: string, onEquation: OnEquation) {
  const verbs = document.createElement("div");
  verbs.className = "nx-link-verbs";
  const said = document.createElement("div");
  said.className = "nx-link-hint";
  said.dataset.testid = "equation-said";
  said.hidden = true;
  const buttons: HTMLButtonElement[] = [];
  for (const [label, format] of [["Copy as SVG", "svg"], ["Save as PNG", "png"]] as const) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "nx-button";
    button.dataset.variant = "quiet";
    button.dataset.size = "inline";
    button.textContent = label;
    button.dataset.testid = `equation-${format}`;
    button.dataset.keepsCard = "";
    button.addEventListener("click", () => {
      for (const each of buttons) each.disabled = true;
      said.hidden = false;
      said.textContent = "Typesetting with your preamble…";
      onEquation(body, format)
        .then((sentence) => { said.textContent = sentence; })
        .catch((error: any) => { said.textContent = error?.message || "That did not work."; })
        .finally(() => { for (const each of buttons) each.disabled = false; });
    });
    buttons.push(button);
    verbs.append(button);
  }
  dom.append(verbs, said);
}

/** An equation typeset by the project's own TeX with the document's
 *  preamble: the SVG's text, or the PNG's bytes.  A refusal carries the
 *  server's sentence, which names the missing tool or what TeX said. */
async function equationFetch(id: string, body: string, format: "svg" | "png"): Promise<Blob> {
  const response = await fetch(`/api/projects/${id}/equation`, {
    credentials: "same-origin",
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ body, format }),
  });
  if (!response.ok) {
    const answer = await response.json().catch(() => ({}));
    throw new ApiError(response.status, answer.detail || response.statusText);
  }
  return response.blob();
}

/** The formula card's two verbs, done: an SVG goes on the clipboard as
 *  text, which is what a slide editor or a message box takes, and a PNG
 *  is saved.  Where the page may not write the clipboard, over plain HTTP
 *  away from localhost, the SVG is saved instead and the card says so. */
export async function equationImage(id: string, body: string, format: "svg" | "png"): Promise<string> {
  const blob = await equationFetch(id, body, format);
  if (format === "png") {
    saveBlob(blob, "equation.png");
    return "Saved as equation.png, at 300 dpi.";
  }
  try {
    await navigator.clipboard.writeText(await blob.text());
    return "Copied. An SVG of this equation, set with your preamble, is on the clipboard.";
  } catch {
    saveBlob(blob, "equation.svg");
    return "The clipboard is closed to this page, so it was saved as equation.svg.";
  }
}
