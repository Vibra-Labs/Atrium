// Lint exists here for the checks tsc cannot make. The headline ones are the
// promise rules: an unawaited async call is invisible to the compiler, and in
// a Nest + Prisma codebase that is how a write silently goes missing and a
// rejection goes unlogged. Style rules are deliberately left out.
import tseslint from "typescript-eslint";
import nextPlugin from "@next/eslint-plugin-next";
import reactHooks from "eslint-plugin-react-hooks";

export default tseslint.config(
  {
    ignores: [
      "**/dist/**",
      "**/.next/**",
      "**/node_modules/**",
      "**/*.d.ts",
    ],
  },
  {
    files: ["**/*.ts", "**/*.tsx"],
    extends: [tseslint.configs.base],
    languageOptions: {
      parserOptions: {
        projectService: { allowDefaultProject: ["*.mjs"] },
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // Warn, not error, for now: every one of these inspected so far is a
      // deliberate fire-and-forget that handles its own failures, and marking
      // ~105 call sites with `void` on a sweep would assert an intent nobody
      // has reviewed. Ratchet to error per directory as they are marked.
      "@typescript-eslint/no-floating-promises": "warn",
      // `onClick={async () => ...}` is the idiomatic React spelling and the
      // repo uses it throughout; flagging it would be 232 findings of noise.
      // The valuable half of this rule stays on: an async callback handed to
      // something expecting a sync answer, such as Array#filter, always
      // misbehaves.
      "@typescript-eslint/no-misused-promises": [
        "error",
        { checksVoidReturn: { attributes: false } },
      ],
      "@typescript-eslint/await-thenable": "error",
      // 64 of the 70 are in specs, where a cast to any is usually standing in
      // for a mock. Warn until the specs are worked through.
      "@typescript-eslint/no-explicit-any": "warn",
    },
  },
  {
    // apps/web already carried eslint-disable comments for these two rules,
    // written for a `next lint` that never ran. Registering the plugins makes
    // those directives mean something instead of erroring as unknown rules.
    files: ["apps/web/**/*.ts", "apps/web/**/*.tsx"],
    plugins: { "@next/next": nextPlugin, "react-hooks": reactHooks },
    rules: {
      ...nextPlugin.configs.recommended.rules,
      "react-hooks/exhaustive-deps": "warn",
    },
  },
  {
    // Bun types `expect(...).rejects` as the same synchronous `Matchers`, so
    // `.rejects.toThrow()` is declared to return void when it actually returns
    // a promise. `await expect(...).rejects.toThrow()` is both correct and
    // required -- dropping the await makes the assertion silently vacuous --
    // but await-thenable reads the declared type and flags all 258 of them.
    // Jest solves this with a separate AsyncMatchers type; bun-types does not.
    files: ["**/*.spec.ts", "**/*.test.ts", "**/*.test.tsx", "e2e/**/*.ts"],
    rules: { "@typescript-eslint/await-thenable": "off" },
  },
);
