import { mkdir } from "node:fs/promises";

// Preserve the generated artwork's alpha while producing macOS icon sizes.
const source = "assets/icons/tailwind.png";
await mkdir("icon.iconset", { recursive: true });
for (const points of [16, 32, 128, 256, 512]) {
  for (const scale of [1, 2]) {
    const pixels = points * scale;
    const output = `icon.iconset/icon_${points}x${points}${scale === 2 ? "@2x" : ""}.png`;
    const result = Bun.spawnSync(["/usr/bin/sips", "--resampleHeightWidth", String(pixels), String(pixels), source, "--out", output], { stdout: "ignore", stderr: "pipe" });
    if (result.exitCode !== 0) throw new Error(`Icon conversion failed: ${result.stderr.toString()}`);
  }
}
console.log("Built macOS Tailwind icon set (16–1024 px)");
