import { expect, type Page, type APIRequestContext } from "@playwright/test";
import type { Instance } from "./server";

/** Share a project the short way, for a spec that is about something else.
 *
 *  The drawer's own Start sharing is exercised by `share-panel.spec.ts`;
 *  every other spec that needs a shared project wants it shared, not
 *  clicked, so it posts to the route. */
export async function shareProject(
  request: APIRequestContext,
  app: Instance,
  projectId: string,
  name = "Wilhelmina",
): Promise<void> {
  const response = await request.post(
    `${app.base}/api/projects/${projectId}/collab/share`,
    { data: { name } },
  );
  expect(response.ok(), "the project would not share").toBeTruthy();
}

/** Wait until this tab knows the project is shared.
 *
 *  Two waits, in order, because they answer two different questions and a
 *  failure should say which one it is. `share-panel`'s `data-state` comes
 *  from the drawer's own fetch of the share, so it fails when sharing did
 *  not take. `make-invite` is gated on the store's `share`, which only the
 *  `collab_peers` frame writes, so it fails when this browser was never
 *  told. The second was what `kit.spec.ts` was really waiting for when it
 *  asked for the button's bounding box and waited out the whole test
 *  timeout twice under load: `boundingBox()` does not auto-wait, where an
 *  expectation does.
 */
export async function waitShared(tab: Page): Promise<void> {
  await expect(tab.getByTestId("share-panel")).toHaveAttribute(
    "data-state", "shared", { timeout: 15_000 },
  );
  await expect(tab.getByTestId("make-invite")).toBeVisible({ timeout: 15_000 });
}

/** Open the People drawer, whether or not it is already open.
 *
 *  The bar's button is a toggle and the drawer's remembered choice is
 *  restored from storage after the page has drawn, so neither "click it"
 *  nor "click it if the panel is not there yet" is enough on its own: a
 *  click can land before the restore and close the drawer the restore is
 *  about to open. Under the full tier this failed exactly that way, with
 *  the panel never appearing at all.
 *
 *  So it presses and checks, up to three times. A toggle that is out of
 *  phase comes back into phase on the next press, and a drawer that is
 *  simply slow is caught by the wait rather than by another press. */
export async function openPeople(tab: Page): Promise<void> {
  const panel = tab.getByTestId("share-panel");
  for (let attempt = 0; attempt < 3; attempt += 1) {
    if (await panel.isVisible()) return;
    await tab.getByTestId("bar-people").click();
    try {
      await expect(panel).toBeVisible({ timeout: 5_000 });
      return;
    } catch {
      /* the remembered drawer raced the press; press again */
    }
  }
  await expect(panel).toBeVisible({ timeout: 10_000 });
}
