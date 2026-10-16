import { stat, mkdir } from "node:fs/promises";
await mkdir(".cache", { recursive: true });
const source = await stat("native/Thumbnail.swift");
const binary = await stat(".cache/thumbnail").catch(() => undefined);
if (!binary || binary.mtimeMs < source.mtimeMs) {
  const result = Bun.spawnSync(["xcrun", "swiftc", "-O", "-module-cache-path", ".cache/swift-modules", "native/Thumbnail.swift", "-o", ".cache/thumbnail"], { stdout: "inherit", stderr: "inherit" });
  if (result.exitCode !== 0) throw new Error("Image helper compilation failed");
}
const dragSource = await stat("native/FileDrag.swift");
const dragLibrary = await stat(".cache/file-drag.dylib").catch(() => undefined);
if (!dragLibrary || dragLibrary.mtimeMs < dragSource.mtimeMs) {
  const result = Bun.spawnSync(["xcrun", "swiftc", "-O", "-emit-library", "-module-cache-path", ".cache/swift-modules", "native/FileDrag.swift", "-o", ".cache/file-drag.dylib"], { stdout: "inherit", stderr: "inherit" });
  if (result.exitCode !== 0) throw new Error("Native file drag bridge compilation failed");
}
await import("./build-web");
const metadataSource = await stat("native/Metadata.swift");
const metadataBinary = await stat(".cache/metadata").catch(() => undefined);
if (!metadataBinary || metadataBinary.mtimeMs < metadataSource.mtimeMs) {
  const result = Bun.spawnSync(["xcrun", "swiftc", "-O", "-module-cache-path", ".cache/swift-modules", "native/Metadata.swift", "-o", ".cache/metadata"], { stdout: "inherit", stderr: "inherit" });
  if (result.exitCode !== 0) throw new Error("Filesystem metadata helper compilation failed");
}
