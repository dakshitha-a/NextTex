import { test, expect } from "../fixtures";
import type { Page } from "@playwright/test";

/** Text that is cut off without saying so, and boxes wider than the window.
 *
 *  The sweep photographs every surface and a person goes through the
 *  images, which is how the design faults get found.  What that misses is
 *  the fault that only appears with somebody's real content in it: a
 *  project named after a grant, a collaborator called Wilhelmina, a LaTeX
 *  package with a long name.  Those clip in the same pixel-perfect way in
 *  every screenshot taken with the sample project's short names.
 *
 *  So this asks the browser instead.  For every element that holds text:
 *  is its content wider than its box, and if so, does anything say so --
 *  an ellipsis, a scrollbar, a wrap?  A clip with none of those is text
 *  the writer cannot read and is not told about.
 */

type Fault = { text: string; tag: string; cls: string; over: number };

async function clipped(page: Page): Promise<Fault[]> {
  return page.evaluate(() => {
    const faults: Fault[] = [];
    for (const el of document.querySelectorAll<HTMLElement>("body *")) {
      // Only leaves that carry their own words.  A container whose child
      // is the thing overflowing reports the same fault twice.
      const own = [...el.childNodes].some(
        (n) => n.nodeType === Node.TEXT_NODE && n.textContent!.trim().length > 1,
      );
      if (!own) continue;
      const style = getComputedStyle(el);
      if (style.visibility === "hidden" || style.display === "none") continue;
      const over = el.scrollWidth - el.clientWidth;
      if (over <= 1) continue;
      // Every honest way of being wider than your box.
      if (style.textOverflow === "ellipsis") continue;
      if (style.overflowX === "auto" || style.overflowX === "scroll") continue;
      if (style.whiteSpace !== "nowrap" && style.whiteSpace !== "pre") continue;
      faults.push({
        text: (el.textContent ?? "").trim().slice(0, 60),
        tag: el.tagName.toLowerCase(),
        cls: el.className?.toString().slice(0, 80) ?? "",
        over,
      });
    }
    return faults;
  });
}

/** Nothing may make the page itself scroll sideways. */
async function sideways(page: Page): Promise<number> {
  return page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
}

const WIDTHS = [1600, 1100, 800];

/** The names this is actually looking for.  A thesis is not called
 *  `main.tex` in a folder called `chapters`; it is called something with a
 *  grant number in it, in a folder named after the experiment. */
const LONG = [
  "chapters/04_time_resolved_photoelectron_spectroscopy_of_nitrophenol.tex",
  "figures/supplementary/absorption_cross_sections_at_298K_and_1atm.tex",
];

/** The surfaces that only exist while something is open.
 *
 *  Each one says how to get to it and how to leave, and is skipped rather
 *  than failed when it is not reachable at this width -- the agent column
 *  is an overlay below 1400 and the row menu needs the tree, which is not
 *  on screen below 1100.  A width where a surface cannot be opened is not
 *  a width where it is broken. */
const OPENED: {
  name: string;
  open: (tab: Page) => Promise<boolean>;
  close: (tab: Page) => Promise<void>;
}[] = [
  {
    name: "settings",
    open: async (tab) => {
      await tab.getByTestId("appearance").first().click();
      return tab
        .getByTestId("settings-sheet")
        .isVisible()
        .catch(() => false);
    },
    close: async (tab) => {
      await tab.getByTestId("settings-close").click().catch(() => undefined);
    },
  },
  {
    name: "row-menu",
    open: async (tab) => {
      const row = tab.getByLabel(/^Actions for /).first();
      if (!(await row.count())) return false;
      await row.click({ force: true }).catch(() => undefined);
      return true;
    },
    close: async (tab) => {
      await tab.keyboard.press("Escape");
    },
  },
  {
    name: "download-menu",
    open: async (tab) => {
      const button = tab.getByTestId("open-download");
      if (!(await button.count()) || !(await button.isVisible())) return false;
      await button.click();
      return true;
    },
    close: async (tab) => {
      await tab.keyboard.press("Escape");
    },
  },
  {
    name: "diagnostics",
    open: async (tab) => {
      const drawer = tab.getByTestId("status");
      if (!(await drawer.count()) || !(await drawer.isVisible())) return false;
      // An error first. The control is disabled in the four states where
      // it opens nothing, so on a build that worked there is no drawer to
      // open and clicking waits for a button that will never be enabled.
      // Skipping instead would be worse: the list below exists so that a
      // surface which stops opening is caught rather than quietly missed.
      if (!(await drawer.isEnabled())) {
        const editor = tab.locator(".cm-content");
        await editor.click();
        await tab.keyboard.press("End");
        await tab.keyboard.type("\n\\badcommand{x}\n");
        await expect(drawer).toHaveAttribute("data-state", /error|warn/, {
          timeout: 30_000,
        });
      }
      await drawer.click();
      return true;
    },
    close: async (tab) => {
      await tab.getByTestId("status").click().catch(() => undefined);
    },
  },
];

test("no surface clips text without saying so, at any width", async ({
  tab, app, project,
}) => {
  for (const path of LONG) {
    await tab.evaluate(
      async ({ base, token, id, path }) => {
        await fetch(`${base}/api/projects/${id}/file`, {
          method: "PUT",
          headers: { "content-type": "application/json", "x-nexttex-token": token },
          body: JSON.stringify({
            path,
            text: "\\section{A section with a title nobody would call short}\n",
            compile: false,
            create: true,
          }),
        });
      },
      { base: app.base, token: app.token, id: project.id, path },
    );
  }
  // Every folder open, so the long names are on screen rather than behind
  // a chevron.
  await tab.waitForTimeout(600);
  for (const folder of ["chapters", "figures", "supplementary"]) {
    const row = tab.getByRole("treeitem", { name: new RegExp(folder) }).first();
    if (await row.count()) await row.click().catch(() => undefined);
    await tab.waitForTimeout(200);
  }

  // Before trusting a pass: plant exactly the fault this is looking for
  // and require it to be seen.  A scan that finds nothing is worth having
  // only once it has been shown to find something.
  await tab.evaluate(() => {
    const bait = document.createElement("div");
    bait.id = "nx-clip-bait";
    bait.style.cssText =
      "position:fixed;left:0;top:0;width:40px;white-space:nowrap;overflow:hidden";
    bait.textContent = "a sentence far too long for forty pixels of anything";
    document.body.appendChild(bait);
  });
  const bait = await clipped(tab);
  expect(
    bait.some((f) => f.text.startsWith("a sentence far too long")),
    "the scan did not notice a deliberately clipped element",
  ).toBe(true);
  await tab.evaluate(() => document.getElementById("nx-clip-bait")?.remove());

  const found: string[] = [];
  const visited = new Set<string>();
  for (const width of WIDTHS) {
    await tab.setViewportSize({ width, height: 900 });
    await tab.waitForTimeout(400);

    expect(await sideways(tab), `the page scrolls sideways at ${width}px`).toBeLessThanOrEqual(1);

    for (const fault of await clipped(tab)) {
      found.push(`${width}px  ${fault.tag}.${fault.cls}  +${fault.over}px  "${fault.text}"`);
    }

    // And the surfaces that are only on screen while something is open.
    // A menu is where a long name is most likely to be cut: it is sized to
    // its own contents in a column sized to the pane.
    for (const surface of OPENED) {
      const opened = await surface.open(tab);
      if (!opened) continue;
      visited.add(surface.name);
      await tab.waitForTimeout(300);
      for (const fault of await clipped(tab)) {
        found.push(
          `${width}px ${surface.name}  ${fault.tag}.${fault.cls}  ` +
            `+${fault.over}px  "${fault.text}"`,
        );
      }
      await surface.close(tab);
      await tab.waitForTimeout(200);
    }
  }
  expect(found, found.join("\n")).toEqual([]);
  // A scan of nothing passes.  These four are reachable at 1600 in every
  // run, so if one stops opening the locator has rotted rather than the
  // surface having become clean.
  expect([...visited].sort()).toEqual([
    "diagnostics", "download-menu", "row-menu", "settings",
  ]);
});
