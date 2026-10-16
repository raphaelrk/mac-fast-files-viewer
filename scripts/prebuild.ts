import { stat, mkdir } from "node:fs/promises";
await mkdir(".cache", { recursive: true });
const source = await stat("native/Thumbnail.swift");
const binary = await stat(".cache/thumbnail").catch(() => undefined);
if (!binary || binary.mtimeMs < source.mtimeMs) {
  const result = Bun.spawnSync(["xcrun", "swiftc", "-O", "-module-cache-path", ".cache/swift-modules", "native/Thumbnail.swift", "-o", ".cache/thumbnail"], { stdout: "inherit", stderr: "inherit" });
  if (result.exitCode !== 0) throw new Error("Image helper compilation failed");
}
await import("./build-web");
