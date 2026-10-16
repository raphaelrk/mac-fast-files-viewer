import { mkdir, copyFile } from "node:fs/promises";
await mkdir("dist/web", { recursive: true });
const result = await Bun.build({ entrypoints: ["src/mainview/index.ts"], outdir: "dist/web", target: "browser", minify: true });
if (!result.success) throw new Error(result.logs.join("\n"));
await copyFile("src/mainview/index.html", "dist/web/index.html");
await copyFile("src/mainview/index.css", "dist/web/index.css");
await copyFile("icon.iconset/icon_32x32@2x.png", "dist/web/app-icon.png");
console.log("Built Fast Files webview");
