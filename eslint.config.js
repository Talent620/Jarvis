import js from "@eslint/js";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";

// Konfiguracja pragmatyczna: łapiemy REALNE błędy (hooki Reacta, nieosiągalny kod,
// puste bloki bez intencji), a stylowe drobiazgi to ostrzeżenia — żeby `lint` był
// bramką na bugi, nie na estetykę. `tsc` pilnuje typów.
export default tseslint.config(
  {
    ignores: [
      "dist",
      "node_modules",
      "sales-os",
      "server",
      "electron",
      "demo-przempol",
      "**/*.cjs",
      "*.config.*",
      "scripts",
      "public",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["src/**/*.{ts,tsx}"],
    plugins: { "react-hooks": reactHooks },
    languageOptions: {
      globals: { ...globals.browser, ...globals.worker },
    },
    rules: {
      // Realne bugi:
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",
      "no-constant-condition": ["error", { checkLoops: false }],
      // Tolerancja dla wzorców tego repo:
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-empty-object-type": "off",
      "@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrors: "none" }],
      "@typescript-eslint/no-this-alias": "off",
      "no-empty": ["warn", { allowEmptyCatch: true }],
      "prefer-const": "warn",
    },
  },
);
