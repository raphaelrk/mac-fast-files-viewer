import { opendir, lstat, realpath } from "node:fs/promises";
import { join, relative, extname } from "node:path";
import type { FileEntry, ScanStatus } from "../shared/types";

const IMAGES = new Set(["jpg", "jpeg", "png", "gif"]);
const IGNORED = new Set([".git", "node_modules", ".hutch", ".cache", ".Trash"]);

export class Catalog {
  files: FileEntry[] = [];
  byId = new Map<string, FileEntry>();
  status: ScanStatus = { generation: "", root: "", count: 0, done: true, skipped: 0 };
  async scan(path: string, recursive: boolean) {
    const root = await realpath(path);
    if (!(await lstat(root)).isDirectory()) throw new Error("Choose a directory");
    const generation = crypto.randomUUID();
    this.files = []; this.byId.clear();
    this.status = { generation, root, count: 0, done: false, skipped: 0 };
    void this.walk(root, recursive, generation);
    return this.status;
  }
  private async walk(root: string, recursive: boolean, generation: string) {
    const directories = [root];
    try {
      while (directories.length && this.status.generation === generation) {
        const path = directories.pop()!;
        try {
          // opendir streams directory entries; never build a giant recursive glob.
          const directory = await opendir(path);
          for await (const item of directory) {
            if (this.status.generation !== generation) break;
            if (item.isSymbolicLink()) continue;
            const full = join(path, item.name);
            if (item.isDirectory()) {
              if (recursive && !IGNORED.has(item.name)) directories.push(full);
              continue;
            }
            if (!item.isFile()) continue;
            try {
              const info = await lstat(full);
              if (!info.isFile()) continue;
              if (this.status.generation !== generation) break;
              const extension = extname(item.name).slice(1).toLowerCase();
              const file: FileEntry = {
                id: `${generation}:${this.files.length}`, name: item.name,
                path: full, relativePath: relative(root, full), size: info.size,
                modified: info.mtimeMs, created: info.birthtimeMs,
                kind: IMAGES.has(extension) ? "image" : "text", extension,
              };
              this.files.push(file); this.byId.set(file.id, file); this.status.count++;
            } catch { this.status.skipped++; }
          }
        } catch { if (this.status.generation === generation) this.status.skipped++; }
      }
    } catch (error) {
      if (this.status.generation === generation) this.status.error = String(error);
    } finally {
      if (this.status.generation === generation) this.status.done = true;
    }
  }
  async validate(id: string) {
    const file = this.byId.get(id);
    if (!file) throw new Error("File is no longer in this catalog");
    const current = await lstat(file.path);
    if (!current.isFile() || await realpath(file.path) !== file.path) throw new Error("File path changed; rescan the folder");
    if (current.size !== file.size || current.mtimeMs !== file.modified) throw new Error("File changed; rescan the folder");
    return file;
  }
}
