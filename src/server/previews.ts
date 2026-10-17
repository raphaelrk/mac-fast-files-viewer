import { open } from "node:fs/promises";
import { availableParallelism } from "node:os";
import type { FileEntry, Preview } from "../shared/types";
import { ByteCache, WorkQueue } from "./queue";
import { Catalog } from "./catalog";

const MiB = 1024 ** 2;
export const MAX_FILE_BYTES = 250 * MiB;
export const TEXT_BYTES = 64 * 1024;
type Asset = { preview: Preview; data?: Uint8Array<ArrayBuffer> };
export class Previews {
  cache = new ByteCache<Asset>(128 * MiB);
  private readonly owner = crypto.randomUUID();
  private disposed = false;
  private processes = new Set<ReturnType<typeof Bun.spawn>>();
  constructor(readonly catalog: Catalog, readonly helper: string,
    readonly queue = new WorkQueue(500 * MiB, Math.min(3, Math.max(1, availableParallelism() - 1)))) {}
  reset() { this.queue.cancelQueued(new Set(), this.owner); this.cache.clear(); }
  dispose() {
    this.disposed = true; this.reset();
    for (const process of this.processes) process.kill();
  }
  key(id: string, side: number) { return `${id}/${side}`; }
  async get(id: string, side: number, priority = 0): Promise<Asset> {
    if (this.disposed) throw new Error("Window closed");
    const file = this.catalog.byId.get(id);
    if (!file) throw new Error("File no longer available");
    if (file.kind === "folder") return { preview: { type: "folder" } };
    const key = this.key(id, side);
    const cached = this.cache.get(key);
    if (cached) return cached;
    if (file.size > MAX_FILE_BYTES) return { preview: { type: "unavailable", reason: "Skipped: file exceeds 250 MiB" } };
    // Conservative admission estimate includes a full 40 MP bitmap even though
    // ImageIO normally downsamples without decoding a full-sized source bitmap.
    const bytes = file.kind === "image" ? file.size + 40_000_000 * 4 + side * side * 12 + 32 * MiB : TEXT_BYTES * 4;
    return this.queue.submit(key, bytes, priority, async () => {
      if (this.disposed) throw new Error("Window closed");
      await this.catalog.validate(id);
      let asset: Asset;
      try { asset = file.kind === "image" ? await this.image(file, side) : await this.text(file); }
      catch (error) { asset = { preview: { type: "unavailable", reason: error instanceof Error ? error.message : "Preview failed" } }; }
      if (!this.disposed && this.catalog.byId.has(id)) this.cache.set(key, asset, asset.data?.byteLength ?? (asset.preview.type === "text" ? asset.preview.text.length * 2 + 128 : 512));
      return asset;
    }, this.owner);
  }
  window(thumbnails: string[], previews: string[], active?: string) {
    const keep = new Set([
      ...thumbnails.map(id => this.key(id, 240)), ...previews.map(id => this.key(id, 1600)),
    ]);
    this.queue.cancelQueued(keep, this.owner);
    // Submit current preview before speculative work.
    const large = active ? [active, ...previews.filter(id => id !== active)] : previews;
    if (active) void this.get(active, 1600, 0).catch(() => {});
    thumbnails.slice(0, 4).forEach((id, i) => void this.get(id, 240, 2 + i).catch(() => {}));
    large.filter(id => id !== active).forEach((id, i) => void this.get(id, 1600, 5 + i).catch(() => {}));
    thumbnails.slice(4).forEach((id, i) => void this.get(id, 240, 12 + i).catch(() => {}));
  }
  private async image(file: FileEntry, side: number): Promise<Asset> {
    if (!await Bun.file(this.helper).exists()) throw new Error("Image helper missing. Run bun run build:helper first.");
    if (this.disposed) throw new Error("Window closed");
    const process = Bun.spawn([this.helper, file.path, String(side)], { stdout: "pipe", stderr: "pipe" });
    this.processes.add(process);
    const timeout = setTimeout(() => process.kill(), 15_000);
    try {
      const [data, error, code] = await Promise.all([
        new Response(process.stdout).arrayBuffer(), new Response(process.stderr).text(), process.exited,
      ]);
      if (code !== 0) throw new Error(error || "Image decoding timed out");
      const view = new DataView(data);
      return { data: new Uint8Array(data), preview: {
        type: "image", url: `/api/media/${encodeURIComponent(file.id)}?side=${side}`,
        width: view.getUint32(16), height: view.getUint32(20),
      } };
    } finally { clearTimeout(timeout); this.processes.delete(process); }
  }
  private async text(file: FileEntry): Promise<Asset> {
    const handle = await open(file.path, "r");
    try {
      const buffer = Buffer.alloc(TEXT_BYTES);
      const { bytesRead } = await handle.read(buffer, 0, TEXT_BYTES, 0);
      const chunk = buffer.subarray(0, bytesRead);
      if (chunk.includes(0)) return { preview: { type: "unavailable", reason: "Binary file — no text preview" } };
      const text = new TextDecoder().decode(chunk);
      const invalid = text.split("�").length - 1;
      if (invalid > Math.max(4, text.length / 100)) return { preview: { type: "unavailable", reason: "File does not look like UTF-8 text" } };
      return { preview: { type: "text", text, truncated: file.size > bytesRead } };
    } finally { await handle.close(); }
  }
}
