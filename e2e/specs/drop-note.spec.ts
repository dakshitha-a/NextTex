import { test, expect } from "../fixtures";

/** The Files drawer's drop sentence waits for a drag.
 *
 *  "Drop files here to add them to the project." sat at the drawer's foot
 *  in every project for good, a lesson for the first day.  It shows now
 *  while files from outside are dragged over the window, and the tree
 *  lights in the hint as the place they will land; a drop or the drag
 *  leaving the window puts both away.  A drop target is the hint's wash,
 *  not the pen's, since the pen means the agent.
 */

test("the drop sentence and the lit tree come with a drag of files and go with it", async ({ tab }) => {
  const tree = tab.getByRole("tree");
  await expect(tree).toBeVisible({ timeout: 20_000 });
  const note = tab.getByTestId("drop-note");
  await expect(note).toHaveCount(0);
  await expect(tab.getByText("Drop files here to add them to the project.")).toHaveCount(0);

  const files = await tab.evaluateHandle(() => {
    const data = new DataTransfer();
    data.items.add(new File(["x"], "figure.png", { type: "image/png" }));
    return data;
  });
  await tab.dispatchEvent("body", "dragenter", { dataTransfer: files });
  await expect(note).toHaveText("Drop to add them to the project, or onto a folder to put them there.");
  await expect(tree).toHaveAttribute("data-dropping", "true");
  const hintWash = await tab.evaluate(() => {
    const probe = document.createElement("div");
    probe.style.background = "var(--hint-wash)";
    document.body.append(probe);
    const colour = getComputedStyle(probe).backgroundColor;
    probe.remove();
    return colour;
  });
  await expect(tree).toHaveCSS("background-color", hintWash);

  // Crossing into a child and back out is not leaving the window.
  await tab.dispatchEvent("[role=tree]", "dragenter", { dataTransfer: files });
  await tab.dispatchEvent("[role=tree]", "dragleave", { dataTransfer: files });
  await expect(note).toBeVisible();
  await tab.dispatchEvent("body", "dragleave", { dataTransfer: files });
  await expect(note).toHaveCount(0);
  await expect(tree).not.toHaveAttribute("data-dropping", "true");

  // A drag of the tree's own rows is not files from outside.
  const internal = await tab.evaluateHandle(() => {
    const data = new DataTransfer();
    data.setData("application/x-nexttex-path", "main.tex");
    return data;
  });
  await tab.dispatchEvent("body", "dragenter", { dataTransfer: internal });
  await expect(note).toHaveCount(0);
});
