export type FileEntry = {
  id: string;
  name: string;
  path: string;
  relativePath: string;
  size: number;
  modified: number;
  created: number;
  added: number | null;
  kindLabel: string;
  kind: "image" | "text" | "folder";
  extension: string;
};
export type Preview =
  | { type: "folder" }
  | { type: "image"; url: string; width: number; height: number }
  | { type: "text"; text: string; truncated: boolean }
  | { type: "unavailable"; reason: string };
export type ScanStatus = {
  generation: string; root: string; parent: string; count: number; done: boolean; skipped: number; error?: string;
};
