import type { FileEntry } from "./types";
export type SortField = "name" | "modified" | "created" | "added" | "size" | "kind";
export function compareFiles(a: FileEntry, b: FileEntry, field: SortField, direction: 1 | -1) {
  if (field === "added") {
    // Missing filesystem dates stay last in either direction; never invent one.
    if (a.added == null || b.added == null) return a.added == null ? b.added == null ? a.name.localeCompare(b.name) : 1 : -1;
  }
  const order = field === "name" ? a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" })
    : field === "kind" ? a.kindLabel.localeCompare(b.kindLabel)
    : Number(a[field]) - Number(b[field]);
  return order * direction || a.name.localeCompare(b.name, undefined, { numeric: true }) || a.path.localeCompare(b.path);
}
