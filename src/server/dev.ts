import { resolve } from "node:path";
import { startServer } from "./server";
await import("../../scripts/build-web");
const app = startServer({ webRoot: resolve("dist/web"), helper: resolve(".cache/thumbnail"), shortlistPath: resolve(".cache/shortlist.json"), port: Number(process.env.FAST_FILES_PORT) || 0 });
console.log(`Fast Files: ${app.url}`);
console.log("Paste a folder path to begin. This local development mode uses your existing Bun installation.");
