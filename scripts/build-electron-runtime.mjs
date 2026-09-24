// Bundle the Node side of the runtime (src/node/electronRuntime.ts and what it imports from
// src/lib/runtime) into electron/gen/runtime.cjs for the Electron main process.
// playwright-core stays external: it is a runtime dependency packaged by electron-builder.
import { build } from "esbuild";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
await build({
  entryPoints: [path.join(root, "src/node/electronRuntime.ts")],
  outfile: path.join(root, "electron/gen/runtime.cjs"),
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node20",
  external: ["playwright-core", "electron"],
  sourcemap: false,
  legalComments: "none",
  logLevel: "warning",
});
console.log("electron/gen/runtime.cjs built");
