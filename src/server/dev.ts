import { resolve } from "node:path";
import { startServer } from "./server";
await import("../../scripts/prebuild");
const app = startServer({
  webRoot: resolve("dist/web"), helper: resolve(".cache/thumbnail"), metadataHelper: resolve(".cache/metadata"),
  shortlistPath: resolve(".cache/shortlist.json"), port: Number(process.env.FAST_FILES_PORT) || 0,
  ...(process.platform === "darwin" ? {
    reveal: (path: string) => { Bun.spawn(["/usr/bin/open", "-R", path]); },
    openFolder: (path: string) => { Bun.spawn(["/usr/bin/open", path]); },
  } : {}),
});
console.log(`Fast Files: ${app.url}`);
console.log("Paste a folder path to begin. This local development mode uses your existing Bun installation.");
