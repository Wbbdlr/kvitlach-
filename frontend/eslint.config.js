import js from "@eslint/js";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";

// See backend/eslint.config.js for why this is a correctness linter and not a
// style one. The frontend adds one rule set that matters more here than
// anything else in it: react-hooks.
//
// `exhaustive-deps` is the reason this exists on this side. Stage geometry is
// measured in effects and memoised (useStageScale, computeFit), and a missing
// dependency there does not throw -- it renders a table sized from a previous
// render's numbers, which is exactly the class of bug v14.5 and v14.7 both
// were. A stale-closure bug looks like a layout bug and gets chased through
// CSS for an hour.
//
// ORDER MATTERS, and not in the obvious way: a config block with no `files`
// key applies to every file, so the two bare recommended sets below would undo
// any rule a narrower block had turned off if they came after it. Globals
// first, narrow overrides last.
export default tseslint.config(
  { ignores: ["dist/**", "coverage/**", "node_modules/**"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["src/**/*.ts", "src/**/*.tsx"],
    plugins: { "react-hooks": reactHooks },
    languageOptions: {
      globals: { ...globals.browser },
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          args: "after-used",
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          ignoreRestSiblings: true,
        },
      ],
      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/no-explicit-any": "warn",
      "no-control-regex": "off",
    },
  },
  {
    files: ["src/**/*.test.ts", "src/**/*.test.tsx", "src/setupTests.ts", "src/testing/**"],
    rules: { "@typescript-eslint/no-non-null-assertion": "off" },
  },
  {
    // Build config, outside tsconfig and outside the bundle.
    files: ["*.config.js", "*.config.ts", "*.cjs"],
    languageOptions: { globals: { ...globals.node }, parserOptions: { project: null } },
    // tailwind.config.cjs is CommonJS on purpose (Tailwind loads it itself),
    // so require() is the correct call there, not a leftover.
    rules: { "@typescript-eslint/no-require-imports": "off" },
  },
  {
    // Hand-written scripts served as-is, outside the bundle and outside
    // tsconfig: the service worker and the pre-paint theme script. `self` and
    // `caches` are not window globals, and without these every reference to
    // them reads as undefined.
    files: ["public/**/*.js"],
    languageOptions: {
      globals: { ...globals.browser, ...globals.serviceworker },
      parserOptions: { project: null },
    },
  }
);
