export const DEFAULT_COLUMNS = ["thumbnail", "name", "modified", "created", "added", "size", "kind"] as const;
export type ColumnId = typeof DEFAULT_COLUMNS[number];
export const COLUMN_LABELS: Record<ColumnId, string> = { thumbnail: "Thumbnails", name: "Name", modified: "Date modified", created: "Date created", added: "Date added", size: "Size", kind: "Kind" };
const widths: Record<ColumnId, string> = { thumbnail: "var(--thumb-column)", name: "minmax(180px,1fr)", modified: "144px", created: "144px", added: "144px", size: "64px", kind: "112px" };
export function validColumns(value: unknown): value is ColumnId[] {
  return Array.isArray(value) && value.length === DEFAULT_COLUMNS.length && new Set(value).size === DEFAULT_COLUMNS.length && value.every(id => DEFAULT_COLUMNS.includes(id));
}
export function columnTemplate(order: ColumnId[]) { return order.map(id => widths[id]).join(" "); }
export function moveColumn(order: ColumnId[], id: ColumnId, target: ColumnId, after = false) {
  if (id === target || !order.includes(id) || !order.includes(target)) return [...order];
  const next = order.filter(column => column !== id), index = next.indexOf(target);
  next.splice(index + (after ? 1 : 0), 0, id);
  return next;
}
