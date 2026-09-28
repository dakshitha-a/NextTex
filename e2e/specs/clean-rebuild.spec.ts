import { test, expect } from "../fixtures";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/** Rebuild everything starts from a clean build directory.
 *
 *  It was a latexmk pass over what the last build left, so an `.aux` that
 *  a cancelled pass cut short, or that two writers left full of NUL bytes,
 *  survived it: on 28 September 2026 a writer's `si.aux` held 8144 NUL
 *  bytes, the engine stopped on it at `\begin{document}` every time, and
 *  deleting the file by hand was the only way past. The button now asks
 *  for a clean build, which removes this document's own build files and
 *  nothing else, and runs the whole sequence again.
 */
test("Rebuild everything gets past a damaged .aux and clears what the last builds left", async ({
  tab, project,
}) => {
  const status = tab.getByTestId("status");
  await expect.poll(async () => status.getAttribute("data-state"), { timeout: 45_000 }).toBe("built");
  const build = join(project.root, "build");
  // Something an earlier build of this document left, and a file of
  // another document's in the same build directory.
  const leftover = join(build, "main.leftover");
  writeFileSync(leftover, "from an earlier build\n");
  const sibling = join(build, "si.aux");
  writeFileSync(sibling, "\\relax \n");

  // Plain Rebuild keeps what earlier passes left; that is what makes it quick.
  await tab.getByTestId("bar-build").click();
  const drawer = tab.getByTestId("diagnostics");
  await drawer.getByTestId("build-rebuild").click();
  await expect(status).toHaveAttribute("data-state", "compiling", { timeout: 10_000 });
  await expect(status).toHaveAttribute("data-state", "built", { timeout: 60_000 });
  expect(existsSync(leftover)).toBe(true);

  // Rebuild everything clears them, and only this document's.
  await drawer.getByTestId("build-rebuild-everything").click();
  await expect.poll(() => existsSync(leftover), { timeout: 60_000 }).toBe(false);
  await expect(status).toHaveAttribute("data-state", "built", { timeout: 60_000 });
  expect(readFileSync(sibling, "utf-8")).toBe("\\relax \n");

  // And it gets past an .aux two writers left holes in.
  const aux = join(build, "main.aux");
  const lines = readFileSync(aux).toString("latin1").split("\n");
  writeFileSync(
    aux,
    Buffer.concat([
      Buffer.from(lines.slice(0, 2).join("\n") + "\n", "latin1"),
      Buffer.alloc(8144),
      Buffer.from(lines.slice(2).join("\n"), "latin1"),
    ]),
  );
  await drawer.getByTestId("build-rebuild-everything").click();
  await expect(status).toHaveAttribute("data-state", "compiling", { timeout: 10_000 });
  await expect(status).toHaveAttribute("data-state", "built", { timeout: 60_000 });
  expect(readFileSync(aux).includes(0)).toBe(false);
});
