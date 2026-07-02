import js from "@eslint/js";
import tseslint from "typescript-eslint";

// Lint KOMPAS-a: łapiemy realne błędy; styl pilnuje tsc + prettier-nawyki.
export default tseslint.config(
  { ignores: ["dist", "node_modules", "test-results", "playwright-report", "EVIDENCE"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
    },
  }
);
