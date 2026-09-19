import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

/** The frontend's own tests.
 *
 *  Six thousand lines of it had none, and three of the functions covered
 *  here have already shipped a real bug: a wrong answer from any of them is
 *  silent -- a tooltip that does not appear, a diff that counts a moved
 *  line twice, a completion list that never opens.
 *
 *  The kit under src/ui/ added the first tests that render React, so the
 *  React plugin is here for their JSX and `.test.tsx` is admitted beside
 *  `.test.ts`.
 */
export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: true,
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
  },
});
