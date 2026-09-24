// hunspell-asm's CommonJS build, which `hunspell-speller.ts` imports by
// path because the ES build cannot be bundled; the types are the package's.
declare module "hunspell-asm/dist/cjs/index.js" {
  export * from "hunspell-asm";
}
