// `bun test` runs the *.test.ts files beside the code they cover, but Next's
// own type check skips test files entirely, so nothing checked them. The web
// tsconfig has no explicit `types` array -- adding one would stop node, react
// and react-dom being picked up automatically -- so pull Bun's globals in by
// reference instead, additively.
/// <reference types="bun-types" />
