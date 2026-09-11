import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";

/** Whether every face the app asks for is a face the app has loaded.
 *
 *  Written after finding that the editor had set every LaTeX comment in
 *  italic since the highlighting was authored, on a family whose italics
 *  were never imported.  The browser answers a request like that by
 *  shearing the upright outline, which is not a failure anybody sees: it is
 *  a slightly worse glyph, for years, and the only symptom is that the
 *  source looks soft on a bright page.
 *
 *  So the pairing is asserted rather than watched for.  `font-synthesis:
 *  none` on `.cm-editor` is the other half: with the faces present it
 *  changes nothing, and if one is ever dropped the text stops rather than
 *  degrades.
 */

const here = dirname(fileURLToPath(import.meta.url));
const read = (name: string) => readFileSync(join(here, name), "utf-8");

const CSS = read("styles.css");
const HIGHLIGHT = read("panes/editor-setup.ts");

/** The weights imported for one family, upright or italic.
 *
 *  `400.css` cannot match the italic pattern and `400-italic.css` cannot
 *  match the upright one, because the hyphen sits where the dot is
 *  required, so the two passes do not have to exclude each other. */
function imported(family: string, italic: boolean): number[] {
  const pattern = new RegExp(
    `@import "@fontsource/${family}/(\\d+)${italic ? "-italic" : ""}\\.css"`,
    "g",
  );
  const found = [...CSS.matchAll(pattern)].map(([, weight]) => Number(weight));
  return [...new Set(found)].sort((a, b) => a - b);
}

describe("the editor's faces", () => {
  test("the highlighting really does ask for italics", () => {
    // If this ever stops being true the assertion below is measuring
    // nothing, and the imports it protects could be dropped.
    expect(HIGHLIGHT).toContain('fontStyle: "italic"');
  });

  test("Source Code Pro is imported at the same weights upright and italic", () => {
    const upright = imported("source-code-pro", false);
    expect(upright.length).toBeGreaterThan(0);
    expect(imported("source-code-pro", true)).toEqual(upright);
  });

  test("nothing in the editor is allowed to be synthesised", () => {
    const editor = CSS.slice(CSS.indexOf(".cm-editor {"));
    expect(editor.slice(0, editor.indexOf("}"))).toContain(
      "font-synthesis: none",
    );
  });

  test("the chat's serif italic is imported, since its prose uses one", () => {
    // `prose.tsx` renders <em> and a blockquote inside `.t-prose`, which is
    // Source Serif 4.  This one was already right; it is asserted so it
    // stays right.
    expect(read("panes/prose.tsx")).toContain('className="italic"');
    expect(CSS).toContain('@import "@fontsource/source-serif-4/400-italic.css"');
  });
});
