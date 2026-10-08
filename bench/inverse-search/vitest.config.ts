/** The census runs in Node, outside the frontend's own suite. It is a
 *  plain object because `vitest/config` is installed under frontend/ and
 *  does not resolve from here. */
export default {
  test: {
    root: new URL(".", import.meta.url).pathname,
    environment: "node",
    globals: true,
    include: ["*.test.ts"],
    testTimeout: 600_000,
  },
};
