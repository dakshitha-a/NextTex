import { test, expect } from "../fixtures";

/** The page stays when a build fails.
 *
 *  The probe's writer journey (Q-066) left a \ref{ without its closing
 *  brace. pdfTeX stopped and deleted the PDF, and the preview lost its
 *  pages and said the document was empty, beside a strip saying "3
 *  errors". The last good PDF is kept now, and one line over it says so.
 */
test("an unclosed brace keeps the pages, and says where the build stopped", async ({ tab }) => {
  await expect(tab.locator(".cm-editor")).toBeVisible({ timeout: 30_000 });
  await expect(tab.getByTestId("status")).toHaveAttribute("data-state", "built", { timeout: 45_000 });
  await expect(tab.locator(".nx-page").first()).toBeVisible({ timeout: 30_000 });
  const pages = await tab.locator(".nx-page").count();

  // Typed the way the journey did, and nothing accepts a completion, so
  // the brace stays open.
  // On the line of \end{document}, before it: the open argument swallows
  // \end{document} and runs into the end of the file, which is the fatal
  // error the probe met. After a blank line it would not be: a paragraph
  // ends the argument, the error is not fatal and pdfTeX keeps its PDF.
  // The file ends "\end{document}" and a newline, so the last line is
  // empty and the one above it is \end{document}.
  await tab.locator(".cm-content").click();
  await tab.keyboard.press("Control+End");
  await tab.keyboard.press("ArrowUp");
  await tab.keyboard.press("Home");
  await expect(tab.locator(".cm-activeLine")).toHaveText("\\end{document}");
  await tab.keyboard.type("See Section~\\ref{sec:intr ");
  await tab.keyboard.press("Escape");

  await expect(tab.getByTestId("status")).toHaveAttribute("data-state", "errors", { timeout: 45_000 });
  await expect(tab.getByTestId("pdf-kept")).toBeVisible({ timeout: 15_000 });
  await expect(tab.getByTestId("pdf-kept")).toContainText("The last page that built");
  await expect(tab.locator(".nx-page")).toHaveCount(pages);
  await expect(tab.getByText("Nothing has been typeset yet.")).toHaveCount(0);

  await tab.getByTestId("pdf-kept").getByRole("button", { name: "Show the error" }).click();
  await expect(tab.getByTestId("build-state")).toBeVisible();
  if (process.env.NEXTTEX_SHOT) {
    await tab.getByTestId("pdf-kept").locator("xpath=..").screenshot({ path: process.env.NEXTTEX_SHOT });
  }
});
