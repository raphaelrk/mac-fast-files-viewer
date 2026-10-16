import { opendir, lstat, realpath } from "node:fs/promises";
import { join, relative, extname, dirname } from "node:path";
import type { FileEntry, ScanStatus } from "../shared/types";
import { enrichMetadata } from "./metadata";

const IMAGES = new Set(["jpg", "jpeg", "png", "gif"]);
const IGNORED = new Set([".git", "node_modules", ".hutch", ".cache", ".notes", ".Trash"]);

export class Catalog {
  files: FileEntry[] = [];
  byId = new Map<string, FileEntry>();
  status: ScanStatus = { generation: "", root: "", parent: "", count: 0, done: true, skipped: 0 };
  constructor(readonly metadataHelper?: string) {}
  async scan(path: string, recursive = false) {
    const root = await realpath(path);
    if (!(await lstat(root)).isDirectory()) throw new Error("Choose a directory");
    const generation = crypto.randomUUID();
    this.files = []; this.byId.clear();
    this.status = { generation, root, parent: dirname(root), count: 0, done: false, skipped: 0 };
    void this.walk(root, recursive, generation);
    return this.status;
  }
  private async walk(root: string, recursive: boolean, generation: string) {
    const directories = [root];
    let batch: FileEntry[] = [];
    let nextId = 0;
    const flush = async () => {
      const entries = batch; batch = [];
      await enrichMetadata(entries, this.metadataHelper);
      if (this.status.generation !== generation) return;
      for (const file of entries) { this.files.push(file); this.byId.set(file.id, file); }
      this.status.count = this.files.length;
    };
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
              if (IGNORED.has(item.name)) continue;
              if (recursive) directories.push(full);
            }
            if (!item.isFile() && !item.isDirectory()) continue;
            try {
              const info = await lstat(full);
              if (!info.isFile() && !info.isDirectory()) continue;
              if (this.status.generation !== generation) break;
              const extension = extname(item.name).slice(1).toLowerCase();
              const file: FileEntry = {
                id: `${generation}:${nextId++}`, name: item.name,
                path: full, relativePath: relative(root, full), size: info.size,
                modified: info.mtimeMs, created: info.birthtimeMs,
                added: null, kindLabel: info.isDirectory() ? "Folder" : extension ? `${extension.toUpperCase()} file` : "File",
                kind: info.isDirectory() ? "folder" : IMAGES.has(extension) ? "image" : "text", extension,
              };
              batch.push(file);
              if (batch.length >= 512) await flush();
            } catch { this.status.skipped++; }
          }
        } catch { if (this.status.generation === generation) this.status.skipped++; }
      }
      if (batch.length) await flush();
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
    if ((file.kind === "folder" ? !current.isDirectory() : !current.isFile()) || await realpath(file.path) !== file.path) throw new Error("File path changed; rescan the folder");
    if (file.kind !== "folder" && (current.size !== file.size || current.mtimeMs !== file.modified)) throw new Error("File changed; rescan the folder");
    return file;
  }
}
