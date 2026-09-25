import { test, expect } from "../fixtures";
import type { Page } from "@playwright/test";

/** The four feet: one 28 px strip under each column, on the surround.
 *
 *  The writer asked for the source's and the preview's strips to stay
 *  where they were, segmented by pane, and for the drawer and the Claude
 *  column to get a foot each "so it's symmetric": the drawer's is the
 *  way to report a problem from inside a project, the column's is what
 *  the project's conversations have cost, with the way to the breakdown.
 */

async function ask(page: Page, script: string, question: string) {
  const composer = page.locator("textarea");
  await composer.click();
  await composer.fill(`#script:${script}\n${question}`);
  await page.getByRole("button", { name: "Send" }).click();
}

/** A token's computed colour, read off a probe painted with it. */
async function tokenColour(tab: Page, token: string) {
  return tab.evaluate((name) => {
    const probe = document.createElement("div");
    probe.style.background = `var(--${name})`;
    document.body.append(probe);
    const colour = getComputedStyle(probe).backgroundColor;
    probe.remove();
    return colour;
  }, token);
}

test("the four feet are one line across the window, on the surround", async ({ tab }) => {
  await tab.setViewportSize({ width: 1680, height: 1000 });
  const surround = await tokenColour(tab, "surround");
  const feet = ["drawer-foot", "status-strip", "preview-footer", "agent-foot"];
  const tops = new Set<number>();
  const bottoms = new Set<number>();
  for (const foot of feet) {
    const box = (await tab.getByTestId(foot).boundingBox())!;
    expect(Math.round(box.height), foot).toBe(28);
    tops.add(Math.round(box.y));
    bottoms.add(Math.round(box.y + box.height));
    const background = await tab.getByTestId(foot).evaluate((el) => getComputedStyle(el).backgroundColor);
    expect(background, foot).toBe(surround);
  }
  expect([...tops]).toHaveLength(1);
  expect([...bottoms]).toHaveLength(1);
  // Each foot is the width of its column.
  const drawer = (await tab.getByTestId("drawer").boundingBox())!;
  const drawerFoot = (await tab.getByTestId("drawer-foot").boundingBox())!;
  expect(Math.round(drawerFoot.width)).toBe(Math.round(drawer.width));
  const column = (await tab.getByTestId("chat-header").boundingBox())!;
  const agentFoot = (await tab.getByTestId("agent-foot").boundingBox())!;
  expect(Math.round(agentFoot.width)).toBe(Math.round(column.width));
});

test("every control in a foot sits on its strip's centre line", async ({ tab }) => {
  // The writer: "The buttons on the footer do not seems to be properly
  // centered either."  Measured, every control in all four feet sat 2 px
  // high: the strips had taken the drawers' own foot rule along with its
  // class name, 6 px of padding above and 10 below, and that rule's gap
  // and sides beat the strips' own utilities.  The class means one thing
  // now, and this reads every visible control against the strip's middle,
  // and the strip's padding against what its classes say.
  await tab.setViewportSize({ width: 1680, height: 1000 });
  const feet: Record<string, string> = {
    "drawer-foot": "0px 12px",
    "status-strip": "0px 12px",
    "preview-footer": "0px 12px",
    "agent-foot": "0px 12px",
  };
  for (const [foot, padding] of Object.entries(feet)) {
    const strip = tab.getByTestId(foot);
    const found = await strip.evaluate((el) => {
      const s = el.getBoundingClientRect();
      const mid = s.top + s.height / 2;
      const cs = getComputedStyle(el);
      const off: string[] = [];
      for (const n of el.querySelectorAll<HTMLElement>("button, input, span, [role=group]")) {
        const r = n.getBoundingClientRect();
        if (r.height === 0 || r.width === 0) continue;
        const centre = r.top + r.height / 2;
        if (Math.abs(centre - mid) > 0.5) {
          off.push(`${n.tagName.toLowerCase()} "${(n.textContent || "").trim().slice(0, 16)}" ${(centre - mid).toFixed(2)}`);
        }
      }
      return { off, padding: `${cs.paddingTop} ${cs.paddingRight}`, bottom: cs.paddingBottom };
    });
    expect(found.off, foot).toEqual([]);
    expect(found.padding, foot).toBe(padding);
    expect(found.bottom, foot).toBe("0px");
  }
});

test("the Claude column's foot reads what the project has cost, and opens the breakdown", async ({ tab }) => {
  // Nothing has been asked yet, so the foot says nothing about cost: a
  // "0 turns, $0.00" said nothing a writer needed. Usage is still there.
  const tally = tab.getByTestId("agent-tally");
  await expect(tab.getByTestId("usage-open")).toBeVisible({ timeout: 10_000 });
  await expect(tally).toHaveText("");
  await ask(tab, "reply", "What does a label do?");
  await expect(tab.getByText(/A label attaches a name/)).toBeVisible({ timeout: 20_000 });
  // The sum follows the end of the turn.
  await expect(tally).toHaveText(/^1 turn, \$\d+\.\d\d$/, { timeout: 10_000 });
  // Usage opens the past conversations, whose foot is the breakdown; the
  // column's header carries no Usage control of its own.
  await expect(tab.getByTestId("chat-header").getByRole("button", { name: "Usage" })).toHaveCount(0);
  await tab.getByTestId("usage-open").click();
  await expect(tab.getByTestId("usage-line")).toContainText("This project:");
  await expect(tab.getByTestId("usage-line")).toContainText("1 turn");
  await tab.getByTestId("past-back").click();
  await expect(tally).toBeVisible();
});

test("the report opens from inside a project, from the drawer's foot", async ({ tab, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await tab.route("https://github.com/**", (route) => route.abort());
  await tab.getByTestId("drawer-foot").getByTestId("report-problem").click();
  const sheet = tab.getByTestId("report-sheet");
  await expect(sheet).toBeVisible();
  await expect(sheet.getByTestId("report-card")).toBeVisible({ timeout: 15_000 });
  await expect(sheet.getByTestId("report-open")).toHaveAttribute("href", /github\.com/);
  await sheet.getByRole("button", { name: "Close" }).click();
  await expect(sheet).toHaveCount(0);
  // The document is where it was.
  await expect(tab.locator(".cm-editor")).toBeVisible();
});

test("the drawer's foot follows whichever drawer shows", async ({ tab }) => {
  await tab.getByTestId("bar-sections").click();
  await expect(tab.getByTestId("drawer")).toHaveAttribute("data-drawer", "sections");
  await expect(tab.getByTestId("drawer-foot")).toBeVisible();
  await tab.getByTestId("bar-history").click();
  await expect(tab.getByTestId("drawer")).toHaveAttribute("data-drawer", "history");
  await expect(tab.getByTestId("drawer-foot")).toBeVisible();
  // Folded, no foot.
  await tab.getByTestId("bar-history").click();
  await expect(tab.getByTestId("drawer-foot")).toHaveCount(0);
});
