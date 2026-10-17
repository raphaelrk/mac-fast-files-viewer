import { mkdir, rename, writeFile, unlink } from "node:fs/promises";
import { dirname } from "node:path";
import type { FileEntry } from "../shared/types";

export type ShortlistSnapshot = { revision: number; files: FileEntry[] };
/** One authoritative store for all windows; mutations serialize with durable writes. */
export class ShortlistStore {
  private files = new Map<string, FileEntry>();
  private work: Promise<unknown>;
  revision = 0;
  constructor(private readonly path?: string) {
    this.work = (async () => {
      if (!path || !await Bun.file(path).exists()) return;
      const values = await Bun.file(path).json();
      if (!Array.isArray(values)) throw new Error("Invalid saved shortlist");
      for (const file of values) if (file && typeof file.path === "string") this.files.set(file.path, file);
    })();
  }
  async snapshot(): Promise<ShortlistSnapshot> {
    await this.work;
    return { revision: this.revision, files: [...this.files.values()] };
  }
  mutate(add: FileEntry[], remove: string[], replace = false): Promise<ShortlistSnapshot> {
    const operation = this.work.then(async () => {
      const files = replace ? new Map<string, FileEntry>() : new Map(this.files);
      for (const path of remove) files.delete(path);
      for (const file of add) files.set(file.path, file);
      if (files.size > 50000) throw new Error("Shortlist limit reached");
      if (this.path) {
        await mkdir(dirname(this.path), { recursive: true });
        const temporary = `${this.path}.${crypto.randomUUID()}.tmp`;
        try {
          await writeFile(temporary, JSON.stringify([...files.values()]), { mode: 0o600 });
          await rename(temporary, this.path);
        } finally { await unlink(temporary).catch(() => {}); }
      }
      this.files = files; this.revision++;
      return { revision: this.revision, files: [...files.values()] };
    });
    // A failed write must not poison subsequent operations. An unreadable initial
    // store stays rejected, preventing accidental replacement of existing data.
    const previous = this.work;
    this.work = operation.catch(() => previous);
    return operation;
  }
}
