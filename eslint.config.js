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
      "demo-przempol",
      "*.config.*",
      "public",
      "ios",
      "android",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["src/**/*.{ts,tsx}", "tests/**/*.ts"],
    plugins: { "react-hooks": reactHooks },
    languageOptions: {
      globals: { ...globals.browser, ...globals.worker },
    },
    rules: {
      // Realne bugi:
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",
      "no-constant-condition": ["error", { checkLoops: false }],
      // Polski format liczb używa NBSP (np. „15 000 zł") — celowy w stringach/regexach.
      "no-irregular-whitespace": ["error", { skipStrings: true, skipTemplates: true, skipRegExps: true }],
      // Tolerancja dla wzorców tego repo:
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-empty-object-type": "off",
      "@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrors: "none" }],
      "@typescript-eslint/no-this-alias": "off",
      "no-empty": ["warn", { allowEmptyCatch: true }],
      "prefer-const": "warn",
    },
  },
  // --- Node (CommonJS): powłoka desktopowa Electron + skrypty .cjs ---
  {
    files: ["electron/**/*.cjs", "scripts/**/*.cjs"],
    languageOptions: { sourceType: "commonjs", globals: { ...globals.node } },
    rules: {
      "@typescript-eslint/no-require-imports": "off",
      "@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrors: "none" }],
      "no-empty": ["warn", { allowEmptyCatch: true }],
      "no-constant-condition": ["error", { checkLoops: false }],
      "prefer-const": "warn",
    },
  },
  // --- Node (ESM): skrypty .mjs/.js + setup proxy ---
  {
    files: ["scripts/**/*.{mjs,js}", "proxy/setup.mjs"],
    languageOptions: { sourceType: "module", globals: { ...globals.node } },
    rules: {
      "@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrors: "none" }],
      "no-empty": ["warn", { allowEmptyCatch: true }],
      "prefer-const": "warn",
    },
  },
  // --- Cloudflare Worker (BFF): środowisko service-worker + Web API ---
  {
    files: ["proxy/worker.js"],
    languageOptions: {
      sourceType: "module",
      globals: { ...globals.serviceworker, ...globals.worker, ...globals.browser },
    },
    rules: {
      "@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrors: "none" }],
      "no-empty": ["warn", { allowEmptyCatch: true }],
      "no-constant-condition": ["error", { checkLoops: false }],
      "prefer-const": "warn",
    },
  },
);
