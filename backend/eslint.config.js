import js from "@eslint/js";
import tseslint from "typescript-eslint";
import globals from "globals";

// Deliberately a CORRECTNESS linter, not a style one. Formatting is not
// enforced here at all: nothing in this repo has ever run a formatter, so a
// style rule set would report thousands of findings on code that is already
// consistent by hand, and the signal that matters -- an unawaited promise, a
// variable nobody reads -- would be buried in it on day one.
//
// `tsc` already owns types. What it does NOT own is the class of mistake that
// type-checks cleanly, which is the whole reason this exists:
//   * a floating promise (the backend is full of async store calls)
//   * an unused variable or import left behind by an edit
//   * `catch (e) {}` swallowing an error silently
export default tseslint.config(
  { ignores: ["dist/**", "coverage/**", "node_modules/**"] },
  // Config and script files sit outside tsconfig.json's `include`, so the
  // type-aware parser below cannot resolve them and reports a parsing error
  // for each. They get the untyped rules instead of being skipped -- an unused
  // import in a config file is still worth knowing about.
  {
    files: ["*.config.js", "*.config.ts", "scripts/**/*.mjs"],
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    languageOptions: { globals: { ...globals.node }, parserOptions: { project: null } },
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["src/**/*.ts"],
    languageOptions: {
      globals: { ...globals.node },
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    rules: {
      // An unused ARGUMENT is usually deliberate here (a callback that only
      // wants its second parameter), so only trailing ones are reported, and
      // an underscore prefix opts out -- the convention already used in the
      // codebase.
      // `ignoreRestSiblings` is load-bearing, not a loosening: the codebase
      // omits fields by destructuring them away
      // (`const { timer, turnTimer, botTimer, ...serializable } = round`, which
      // is how a round is stripped of its Node timers before it crosses the
      // wire). Without it, every one of those reads as three unused variables
      // and the only way to quiet it is to stop using the idiom.
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          args: "after-used",
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          ignoreRestSiblings: true,
        },
      ],
      // The valuable one. Every `await`-less store/db call is a silently
      // dropped rejection, and an unhandled rejection kills the process on
      // Node 22.
      "@typescript-eslint/no-floating-promises": "error",
      // `payload as any` is a documented, deliberate pattern at the WS
      // boundary (payload.ts validates before the cast -- see TASKS.md), so
      // banning `any` outright would mean 27 inline disables for something
      // that is already handled. Warn so a NEW one is visible without the
      // existing ones sitting red.
      "@typescript-eslint/no-explicit-any": "warn",
      // Off by design. Every finding for this rule in this codebase is a
      // sanitizer deliberately matching control characters in order to STRIP
      // them (`about.ts`, `contact.ts`, `disclaimer.ts`, `bot-names.ts`,
      // `client-errors.ts`, `family-profiles.ts` -- six of them). The rule
      // exists to catch a control character typed into a pattern by accident,
      // which is the opposite of what these are.
      "no-control-regex": "off",
    },
  },
  {
    // Tests reach into internals on purpose and use non-null assertions
    // constantly to keep assertions readable.
    files: ["src/__tests__/**"],
    rules: { "@typescript-eslint/no-non-null-assertion": "off" },
  }
);
