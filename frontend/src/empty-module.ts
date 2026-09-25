// What `fs` is in the browser build. harper.js imports it in the branch of
// its loader that runs under Node; Vite already replaced it with an empty
// module and said so on every build (Q-036). Named here, the build is
// quiet and the next warning it prints is news.
export default {};
