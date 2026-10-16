import type { FileEntry, Preview, ScanStatus } from "../shared/types";
import { neighbors, BROWSER_CACHE_BYTES } from "../shared/prefetch";
import { FileSelection } from "../shared/selection";
import { compareFiles, type SortField } from "../shared/sort";
import { DEFAULT_COLUMNS, COLUMN_LABELS, validColumns, moveColumn, columnTemplate, type ColumnId } from "../shared/columns";

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const list = $("list"), rows = $("rows"), folder = $<HTMLInputElement>("folder"), search = $<HTMLInputElement>("search");
const quicklook = $<HTMLDialogElement>("quicklook");
const about = $<HTMLDialogElement>("about"), columnSettings = $<HTMLDialogElement>("column-settings");
const columnHeader = $("column-header"), columnTrack = $("column-track"), scrollGutter = $("scroll-gutter");
const token = location.hash.slice(1) || sessionStorage.getItem("fast-files-token") || "";
sessionStorage.setItem("fast-files-token", token);
history.replaceState(null, "", location.pathname);
let rowHeight = 56;
let files: FileEntry[] = [], filtered: FileEntry[] = [], orderedIds: string[] = [], active: FileEntry | undefined;
const byId = new Map<string, FileEntry>(), selection = new FileSelection();
let root = "", parent = "", generation = "", cursor = 0;
let nativePicker = false, nativeDrag = false, finderAvailable = false;
let sortField: SortField = "modified", sortDirection: 1 | -1 = -1;
let scanSerial = 0, paintFrame = 0, windowTimer: ReturnType<typeof setTimeout>, paintFallback: ReturnType<typeof setTimeout>;
let selectionVersion = 0, pointer: { x: number; y: number } | undefined, contextFile: FileEntry | undefined;
let press: { id: string; x: number; y: number; modified: boolean; moved: boolean; selectedOnDown: boolean } | undefined;
let columnOrder: ColumnId[] = [...DEFAULT_COLUMNS], draggingColumn: ColumnId | undefined, suppressSortUntil = 0;
try { const value = JSON.parse(sessionStorage.getItem("fast-files-columns") || "null"); if (validColumns(value)) columnOrder = value; } catch { /* Use the default order for invalid saved preferences. */ }
const columnHeaders = new Map([...columnTrack.querySelectorAll<HTMLButtonElement>("[data-column]")].map(button => [button.dataset.column as ColumnId, button]));
const rendered = new Map<string, HTMLElement>(), saved = new Map<string, FileEntry>();
let saveWork = Promise.resolve();
const selectedFiles = () => [...selection.ids].map(id => byId.get(id)).filter((file): file is FileEntry => Boolean(file));

async function api<T = any>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(path, { headers: { Authorization: `Bearer ${token}`, ...(body === undefined ? {} : { "Content-Type": "application/json" }) }, method: body === undefined ? "GET" : "POST", body: body === undefined ? undefined : JSON.stringify(body) });
  const value = await response.json();
  if (!response.ok) throw new Error(value.error || response.statusText);
  return value;
}
function toast(message: string) { $("toast").textContent = message; $("toast").hidden = false; setTimeout(() => $("toast").hidden = true, 5000); }
const size = (bytes: number) => bytes < 1024 ? `${bytes} B` : bytes < 1024 ** 2 ? `${(bytes / 1024).toFixed(0)} KiB` : `${(bytes / 1024 ** 2).toFixed(1)} MiB`;
const date = (value: number | null | undefined) => value == null ? "—" : new Date(value).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
function clearTextSelection() { window.getSelection()?.removeAllRanges(); }
function message(text: string) { const element = document.createElement("p"); element.className = "preview-message"; element.textContent = text; return element; }

function orderRow(element: HTMLElement) {
  const cells = new Map([...element.children].map(cell => [(cell as HTMLElement).dataset.column, cell]));
  element.append(...columnOrder.map(id => cells.get(id)!));
}
function applyColumnOrder(announce?: ColumnId) {
  const focusedColumn = (document.activeElement as HTMLElement | null)?.dataset.column as ColumnId | undefined;
  document.documentElement.style.setProperty("--file-columns", columnTemplate(columnOrder));
  columnTrack.append(...columnOrder.map(id => columnHeaders.get(id)!));
  columnOrder.forEach((id, index) => {
    const button = columnHeaders.get(id)!;
    button.draggable = true;
    button.title = `${COLUMN_LABELS[id]} · drag to reorder, or Option + ← / →`;
    button.setAttribute("aria-describedby", "column-status");
    button.dataset.position = String(index + 1);
  });
  const pinned = columnOrder.at(-1) === "thumbnail" ? "right" : "none";
  rows.dataset.thumbnailEdge = columnTrack.dataset.thumbnailEdge = pinned;
  for (const element of rendered.values()) orderRow(element);
  columnHeader.scrollLeft = list.scrollLeft;
  sessionStorage.setItem("fast-files-columns", JSON.stringify(columnOrder));
  renderColumnControls();
  if (focusedColumn) columnHeaders.get(focusedColumn)?.focus({ preventScroll: true });
  if (announce) $("column-status").textContent = `${COLUMN_LABELS[announce]} is column ${columnOrder.indexOf(announce) + 1} of ${columnOrder.length}.`;
}
function shiftColumn(id: ColumnId, direction: number) {
  const target = columnOrder[columnOrder.indexOf(id) + direction];
  if (!target) return;
  columnOrder = moveColumn(columnOrder, id, target, direction > 0); applyColumnOrder(id);
}
function renderColumnControls() {
  const controls = columnOrder.map((id, index) => {
    const item = document.createElement("li"), label = document.createElement("span"); label.textContent = COLUMN_LABELS[id];
    item.append(label);
    for (const direction of [-1, 1]) {
      const button = document.createElement("button"); button.textContent = direction < 0 ? "←" : "→";
      button.setAttribute("aria-label", `Move ${COLUMN_LABELS[id]} ${direction < 0 ? "left" : "right"}`);
      button.disabled = index + direction < 0 || index + direction >= columnOrder.length;
      button.onclick = () => { shiftColumn(id, direction); $<HTMLButtonElement>("columns-close").focus({ preventScroll: true }); };
      item.append(button);
    }
    return item;
  });
  $("column-controls").replaceChildren(...controls);
}
function showInfo(dialog: HTMLDialogElement) {
  closeQuickLook(); $("context-menu").hidden = true;
  for (const other of [about, columnSettings]) if (other !== dialog && other.open) other.close();
  if (!dialog.open) dialog.showModal();
}
function finishColumnDrag() {
  draggingColumn = undefined; suppressSortUntil = performance.now() + 250;
  columnHeaders.forEach(header => { header.classList.remove("dragging"); delete header.dataset.dropSide; });
}
for (const [id, button] of columnHeaders) {
  button.addEventListener("keydown", event => {
    if (event.altKey && (event.key === "ArrowLeft" || event.key === "ArrowRight")) {
      event.preventDefault(); event.stopPropagation(); shiftColumn(id, event.key === "ArrowLeft" ? -1 : 1);
    }
  });
  button.addEventListener("dragstart", event => {
    draggingColumn = id; suppressSortUntil = Infinity; pointer = undefined;
    button.classList.add("dragging");
    event.dataTransfer?.setData("text/x-fast-files-column", id);
    if (event.dataTransfer) event.dataTransfer.effectAllowed = "move";
  });
  button.addEventListener("dragover", event => {
    if (!draggingColumn) return;
    event.preventDefault(); if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
    const rect = button.getBoundingClientRect();
    columnHeaders.forEach(header => delete header.dataset.dropSide);
    button.dataset.dropSide = event.clientX >= rect.left + rect.width / 2 ? "after" : "before";
  });
  button.addEventListener("drop", event => {
    if (!draggingColumn) return;
    event.preventDefault();
    const moved = draggingColumn, rect = button.getBoundingClientRect();
    columnOrder = moveColumn(columnOrder, moved, id, event.clientX >= rect.left + rect.width / 2);
    applyColumnOrder(moved); finishColumnDrag();
  });
  button.addEventListener("dragend", finishColumnDrag);
}
columnHeader.addEventListener("dragover", event => {
  if (!draggingColumn) return;
  event.preventDefault();
  const rect = columnHeader.getBoundingClientRect();
  if (event.clientX < rect.left + 24) list.scrollLeft -= 20;
  else if (event.clientX > rect.right - 24) list.scrollLeft += 20;
});
$("columns-button").onclick = () => showInfo(columnSettings);
$("columns-close").onclick = () => columnSettings.close();
$("columns-reset").onclick = () => { columnOrder = [...DEFAULT_COLUMNS]; applyColumnOrder(); };
for (const side of ["left", "right"]) $(`thumbnails-${side}`).onclick = () => {
  const rest = columnOrder.filter(id => id !== "thumbnail");
  columnOrder = side === "right" ? [...rest, "thumbnail"] : ["thumbnail", ...rest];
  applyColumnOrder("thumbnail");
};
$("about-button").onclick = () => showInfo(about);
$("about-close").onclick = () => about.close();
for (const dialog of [about, columnSettings]) dialog.addEventListener("click", event => {
  if (event.target !== dialog) return;
  const rect = dialog.getBoundingClientRect();
  if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) dialog.close();
});

// Cache costs include decoded pixels, and retained images are decoded in advance.
type Cached = { preview: Preview; blob?: string; image?: HTMLImageElement; bytes: number };
const cache = new Map<string, Cached>(), waiting = new Map<string, Promise<Cached>>();
let cacheBytes = 0;
function clearCache() { for (const item of cache.values()) if (item.blob) URL.revokeObjectURL(item.blob); cache.clear(); cacheBytes = 0; }
function touch(key: string) { const item = cache.get(key); if (item) { cache.delete(key); cache.set(key, item); } return item; }
async function load(file: FileEntry, side: number): Promise<Cached> {
  const key = `${file.id}/${side}`, hit = touch(key); if (hit) return hit;
  const existing = waiting.get(key); if (existing) return existing;
  const work = (async () => {
    const preview = await api<Preview>(`/api/preview/${encodeURIComponent(file.id)}?side=${side}`);
    let blob: string | undefined, image: HTMLImageElement | undefined, bytes = preview.type === "text" ? preview.text.length * 2 : 512;
    if (preview.type === "image") {
      const response = await fetch(preview.url, { headers: { Authorization: `Bearer ${token}` } });
      if (!response.ok) throw new Error("Image no longer available");
      const data = await response.blob(); blob = URL.createObjectURL(data);
      image = new Image(); image.src = blob;
      try { await image.decode(); } catch { URL.revokeObjectURL(blob); throw new Error("Could not display image"); }
      bytes = preview.width * preview.height * 4 + data.size;
    }
    const item = { preview, blob, image, bytes };
    if (file.id.startsWith(generation + ":")) {
      cache.set(key, item); cacheBytes += bytes;
      while (cacheBytes > BROWSER_CACHE_BYTES && cache.size > 1) {
        const oldest = cache.keys().next().value!, removed = cache.get(oldest)!;
        cache.delete(oldest); cacheBytes -= removed.bytes;
        if (removed.blob) URL.revokeObjectURL(removed.blob);
      }
    } else if (blob) URL.revokeObjectURL(blob);
    return item;
  })();
  waiting.set(key, work);
  try { return await work; } finally { waiting.delete(key); }
}
function previewElement(item: Cached, file: FileEntry): HTMLElement {
  if (item.blob) { const image = new Image(); image.src = item.blob; image.alt = file.name; image.draggable = false; return image; }
  if (item.preview.type === "text") { const pre = document.createElement("pre"); pre.textContent = item.preview.text + (item.preview.truncated ? "\n\n[Preview limited to the first 64 KiB]" : ""); return pre; }
  if (item.preview.type === "folder") {
    const card = document.createElement("div"); card.className = "folder-preview";
    const icon = document.createElement("span"); icon.textContent = "📁";
    const button = document.createElement("button"); button.textContent = "Open folder"; button.onclick = () => void openFolder(file.path);
    card.append(icon, button); return card;
  }
  return message(item.preview.type === "unavailable" ? item.preview.reason : "Preview unavailable");
}
function thumbnail(file: FileEntry) {
  const item = touch(`${file.id}/240`), element = document.createElement("div"); element.className = "thumbnail";
  element.setAttribute("aria-hidden", "true");
  if (file.kind === "folder") { const icon = document.createElement("span"); icon.className = "folder-icon-large"; icon.textContent = "📁"; element.append(icon); }
  else if (item?.blob) { const image = new Image(); image.src = item.blob; image.alt = ""; image.draggable = false; element.append(image); }
  else if (item?.preview.type === "text") { const pre = document.createElement("pre"); pre.textContent = item.preview.text.slice(0, 600); element.append(pre); }
  else { const ext = document.createElement("span"); ext.className = "ext"; ext.textContent = (file.extension || "FILE").slice(0, 8).toUpperCase(); element.append(ext); }
  return element;
}
function updateSaved() {
  $("shortlist-count").textContent = String(saved.size);
  const targets = selection.ids.size ? selectedFiles() : active ? [active] : [];
  $("save").textContent = targets.length && targets.every(file => saved.has(file.path)) ? "★" : "☆";
}
function toggleSaved() {
  const targets = selection.ids.size ? selectedFiles() : active ? [active] : [];
  if (!targets.length) return;
  const remove = targets.every(file => saved.has(file.path));
  for (const file of targets) { if (remove) saved.delete(file.path); else saved.set(file.path, file); }
  const snapshot = [...saved.values()];
  saveWork = saveWork.then(() => api("/api/shortlist", snapshot)).catch(error => toast(`Could not save shortlist: ${error.message}`));
  updateSaved(); applyFilter(false);
}
function selectionChanged(preferred?: FileEntry) {
  if (selection.ids.size && (!preferred || !selection.ids.has(preferred.id))) preferred = selectedFiles().at(-1);
  if (preferred) setActive(preferred, true); else refreshInspector();
  schedulePaint(); requestWindow();
}
function clickFile(file: FileEntry, modifiers: { toggle?: boolean; range?: boolean; toggleSingle?: boolean } = {}) {
  if (modifiers.range && !selection.anchor && active) selection.anchor = active.id;
  selection.click(file.id, orderedIds, modifiers); selectionChanged(file);
}
function row(file: FileEntry, index: number) {
  const element = document.createElement("div"); element.className = "file-row"; element.dataset.id = file.id;
  element.setAttribute("role", "option"); element.id = `file-${file.id}`;
  const info = document.createElement("div"); info.className = "file-info"; info.dataset.column = "name";
  const name = document.createElement("div"); name.className = "filename";
  const path = document.createElement("div"); path.className = "filepath"; path.textContent = file.relativePath;
  info.append(name);
  if ($<HTMLInputElement>("recursive").checked) info.append(path);
  const thumb = document.createElement("div"); thumb.className = "file-thumbnail"; thumb.dataset.column = "thumbnail"; thumb.append(thumbnail(file));
  element.append(thumb, info);
  for (const [field, value] of [["modified", date(file.modified)], ["created", date(file.created)], ["added", date(file.added)], ["size", file.kind === "folder" ? "—" : size(file.size)], ["kind", file.kindLabel]] as const) {
    const cell = document.createElement("div"); cell.className = `file-${field}`; cell.dataset.column = field; cell.textContent = value; cell.title = value; element.append(cell);
  }
  orderRow(element);
  element.style.top = `${index * rowHeight}px`;
  element.addEventListener("mouseenter", () => { if (!selection.ids.size && !quicklook.open && !draggingColumn) setActive(file); });
  element.addEventListener("pointerdown", event => {
    if (event.button !== 0) return;
    clearTextSelection();
    list.focus({ preventScroll: true });
    const modified = event.metaKey || event.ctrlKey || event.shiftKey;
    press = { id: file.id, x: event.clientX, y: event.clientY, modified, moved: false, selectedOnDown: selection.ids.has(file.id) };
    if (modified) clickFile(file, { toggle: event.metaKey || event.ctrlKey, range: event.shiftKey });
    else if (!selection.ids.has(file.id)) clickFile(file);
    // Preserve a selected group until mouse-up, so any selected row drags it.
    if (nativeDrag) void api("/api/drag", { ids: selection.dragIds(file.id, orderedIds) }).catch(error => toast(error.message));
  });
  element.addEventListener("mousedown", event => { if (event.button === 0) event.preventDefault(); });
  element.addEventListener("click", event => {
    const previous = press; press = undefined;
    list.focus({ preventScroll: true });
    if (previous?.id === file.id && (previous.modified || previous.moved)) return;
    if (previous?.id === file.id && !previous.selectedOnDown) return;
    clickFile(file, { toggle: event.metaKey || event.ctrlKey, range: event.shiftKey, toggleSingle: true });
  });
  element.addEventListener("dblclick", event => { event.preventDefault(); clearTextSelection(); if (file.kind === "folder") void openFolder(file.path); });
  element.addEventListener("dragstart", event => event.preventDefault());
  element.addEventListener("contextmenu", event => {
    event.preventDefault(); clearTextSelection();
    if (!selection.ids.has(file.id)) clickFile(file);
    contextFile = file;
    const menu = $("context-menu"); menu.hidden = false;
    menu.style.left = `${Math.min(event.clientX, innerWidth - 195)}px`; menu.style.top = `${Math.min(event.clientY, innerHeight - 55)}px`;
    $<HTMLButtonElement>("context-reveal").disabled = !finderAvailable;
    $("context-reveal").focus({ preventScroll: true });
  });
  element.title = "Click to select; click the selected row again to release. ⌘-click to toggle; Shift-click for a range. Drag selected items to another app.";
  return element;
}
function paint() {
  cancelAnimationFrame(paintFrame); clearTimeout(paintFallback); paintFrame = 0;
  rows.style.height = `${filtered.length * rowHeight}px`;
  $("empty").hidden = filtered.length > 0;
  if (!filtered.length && root) { $("empty").querySelector("h1")!.textContent = "No matching items"; $("empty").querySelector("p")!.textContent = "Try changing your filter or opening another folder."; }
  const first = Math.max(0, Math.floor(list.scrollTop / rowHeight) - 4), last = Math.min(filtered.length, Math.ceil((list.scrollTop + list.clientHeight) / rowHeight) + 4);
  const visible = new Set(filtered.slice(first, last).map(file => file.id));
  for (const [id, element] of rendered) if (!visible.has(id)) { element.remove(); rendered.delete(id); }
  for (let i = first; i < last; i++) {
    const file = filtered[i]; let element = rendered.get(file.id);
    if (!element) { element = row(file, i); rendered.set(file.id, element); rows.append(element); }
    element.style.top = `${i * rowHeight}px`;
    element.classList.toggle("active", file.id === active?.id);
    element.classList.toggle("locked", selection.ids.has(file.id));
    element.setAttribute("aria-selected", String(selection.ids.has(file.id)));
    element.querySelector(".filename")!.textContent = `${saved.has(file.path) ? "★ " : ""}${file.name}`;
    const cached = touch(`${file.id}/240`);
    if (cached && element.dataset.preview !== `${file.id}/240`) { element.querySelector(".file-thumbnail")!.replaceChildren(thumbnail(file)); element.dataset.preview = `${file.id}/240`; }
  }
  if (selection.ids.size > 1) renderGroup();
}
function schedulePaint() { if (!paintFrame) { paintFrame = requestAnimationFrame(paint); paintFallback = setTimeout(paint, 80); } }
function renderGroup() {
  const group = selectedFiles(), container = $("preview"); container.classList.add("multi-preview");
  const grid = document.createElement("div"); grid.className = "selection-grid";
  for (const file of group.slice(0, 24)) {
    const card = document.createElement("button"); card.className = "selection-card"; card.title = file.name;
    const label = document.createElement("span"); label.textContent = file.name;
    card.append(thumbnail(file), label); card.onclick = () => { setActive(file); if (quicklook.open) renderQuickLook(); };
    grid.append(card);
  }
  container.replaceChildren(grid);
  if (group.length > 24) container.append(message(`Showing 24 of ${group.length.toLocaleString()} selected items. All selected items are included when dragging.`));
}
function refreshInspector() {
  const group = selectedFiles(), multi = group.length > 1;
  $("selection-status").textContent = group.length ? `${group.length.toLocaleString()} selected` : "Hover preview";
  $("clear-selection").hidden = !active && !group.length;
  $("details").hidden = !active && !group.length;
  updateSaved();
  if (!active) { $("preview").classList.remove("multi-preview"); $("preview").replaceChildren(message("Hover to preview. Click to select; ⌘-click or Shift-click for more.")); return; }
  $("name").textContent = multi ? `${group.length.toLocaleString()} items selected` : active.name;
  $("path").textContent = multi ? "Drag any selected row to use the entire selection." : active.path;
  $("detail-kind").textContent = multi ? `${group.filter(file => file.kind === "folder").length} folders · ${group.filter(file => file.kind !== "folder").length} files` : active.kindLabel;
  $("detail-size").textContent = multi ? size(group.reduce((total, file) => total + (file.kind === "folder" ? 0 : file.size), 0)) : active.kind === "folder" ? "—" : size(active.size);
  for (const field of ["modified", "created", "added"] as const) $(`detail-${field}`).textContent = multi ? "—" : date(active[field]);
  if (multi) renderGroup();
  else {
    const file = active, version = selectionVersion;
    $("preview").classList.remove("multi-preview");
    const cached = touch(`${file.id}/1600`) || touch(`${file.id}/240`);
    $("preview").replaceChildren(cached ? previewElement(cached, file) : file.kind === "folder" ? previewElement({ preview: { type: "folder" }, bytes: 0 }, file) : message("Loading preview…"));
    void load(file, 1600).then(item => { if (version === selectionVersion && selection.ids.size <= 1) $("preview").replaceChildren(previewElement(item, file)); if (version === selectionVersion && quicklook.open) renderQuickLook(); }).catch(error => { if (version === selectionVersion && error.message !== "Superseded") $("preview").replaceChildren(message(error.message)); });
  }
  if (quicklook.open) renderQuickLook();
}
function setActive(file: FileEntry, force = false) {
  if (!force && active?.id === file.id) return;
  active = file; selectionVersion++; refreshInspector(); schedulePaint(); requestWindow();
}
function clearSelection() {
  selection.clear(); active = undefined; selectionVersion++; clearTextSelection();
  refreshInspector(); schedulePaint(); requestWindow(); closeQuickLook();
}
function renderQuickLook() {
  if (!active || !quicklook.open) return;
  const file = active, version = selectionVersion, sequence = selection.ids.size > 1 ? selectedFiles() : filtered;
  $("quicklook-title").textContent = file.name;
  $("quicklook-count").textContent = `${Math.max(0, sequence.findIndex(item => item.id === file.id)) + 1} of ${sequence.length.toLocaleString()}`;
  const item = touch(`${file.id}/1600`) || touch(`${file.id}/240`);
  $("quicklook-content").replaceChildren(item ? previewElement(item, file) : file.kind === "folder" ? previewElement({ preview: { type: "folder" }, bytes: 0 }, file) : message("Loading preview…"));
  if (!touch(`${file.id}/1600`)) void load(file, 1600).then(item => { if (quicklook.open && selectionVersion === version) $("quicklook-content").replaceChildren(previewElement(item, file)); }).catch(() => {});
}
function toggleQuickLook() {
  if (quicklook.open) { closeQuickLook(); return; }
  if (!active && filtered.length) setActive(filtered[0]);
  if (!active) return;
  // Open synchronously, then reuse the decoded cache or thumbnail immediately.
  quicklook.showModal(); renderQuickLook();
}
function closeQuickLook() { if (quicklook.open) { quicklook.close(); list.focus({ preventScroll: true }); } }
function stepQuickLook(direction: number) {
  const sequence = selection.ids.size > 1 ? selectedFiles() : filtered;
  const index = sequence.findIndex(file => file.id === active?.id);
  const file = sequence[Math.max(0, Math.min(sequence.length - 1, index + direction))];
  if (file) { if (selection.ids.size === 1) selection.click(file.id, orderedIds); setActive(file, true); }
}

let workVersion = 0, desired: { file: FileEntry; side: number }[] = [], workers = 0;
function runLoads() {
  while (workers < 4 && desired.length) {
    const { file, side } = desired.shift()!; if (cache.has(`${file.id}/${side}`)) continue;
    workers++; const version = workVersion;
    void load(file, side).then(() => { if (version === workVersion) schedulePaint(); }).catch(() => {}).finally(() => { workers--; runLoads(); });
  }
}
function requestWindow() { clearTimeout(windowTimer); windowTimer = setTimeout(() => void prefetch(), 45); }
async function prefetch() {
  const first = Math.floor(list.scrollTop / rowHeight), last = Math.min(filtered.length, Math.ceil((list.scrollTop + list.clientHeight) / rowHeight));
  const thumbs = [...filtered.slice(first, last), ...selectedFiles().slice(0, 24)];
  for (let distance = 1; distance <= 50; distance++) { if (filtered[last - 1 + distance]) thumbs.push(filtered[last - 1 + distance]); if (filtered[first - distance]) thumbs.push(filtered[first - distance]); }
  const thumbnails = [...new Map(thumbs.filter(file => file.kind !== "folder").map(file => [file.id, file])).values()];
  const large = neighbors(filtered, active ? filtered.findIndex(file => file.id === active!.id) : first).filter(file => file.kind !== "folder");
  const version = ++workVersion; desired = [];
  try { await api("/api/window", { thumbnails: thumbnails.map(f => f.id), large: large.map(f => f.id), active: active?.kind !== "folder" ? active?.id : undefined, revision: version, generation }); } catch { return; }
  if (version !== workVersion) return;
  if (active && selection.ids.size <= 1) {
    const file = active, selectedVersion = selectionVersion;
    void load(file, 1600).then(item => { if (selectedVersion === selectionVersion && selection.ids.size <= 1) { $("preview").replaceChildren(previewElement(item, file)); if (quicklook.open) renderQuickLook(); } }).catch(() => {});
  }
  for (let i = 0; i < Math.max(thumbnails.length, large.length); i++) { if (large[i]) desired.push({ file: large[i], side: 1600 }); if (thumbnails[i]) desired.push({ file: thumbnails[i], side: 240 }); }
  runLoads();
}
function hoverUnderPointer() {
  if (!pointer || selection.ids.size || quicklook.open || draggingColumn) return;
  const bounds = list.getBoundingClientRect();
  if (pointer.x < bounds.left || pointer.x >= bounds.right || pointer.y < bounds.top || pointer.y >= bounds.bottom) return;
  const file = filtered[Math.floor((pointer.y - bounds.top + list.scrollTop) / rowHeight)]; if (file) setActive(file);
}
list.addEventListener("mousemove", event => { pointer = { x: event.clientX, y: event.clientY }; hoverUnderPointer(); });
list.addEventListener("mouseleave", () => pointer = undefined);
list.addEventListener("scroll", () => { columnHeader.scrollLeft = list.scrollLeft; $("context-menu").hidden = true; schedulePaint(); hoverUnderPointer(); requestWindow(); }, { passive: true });
scrollGutter.addEventListener("mouseenter", () => pointer = undefined);
scrollGutter.addEventListener("wheel", event => {
  event.preventDefault(); pointer = undefined;
  const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? list.clientHeight : 1;
  list.scrollBy({ top: event.shiftKey ? 0 : event.deltaY * unit, left: (event.deltaX || (event.shiftKey ? event.deltaY : 0)) * unit });
}, { passive: false });
scrollGutter.addEventListener("keydown", event => {
  if (event.metaKey || event.ctrlKey || event.altKey) return;
  const distance = event.key === "ArrowDown" ? rowHeight : event.key === "ArrowUp" ? -rowHeight : event.key === "PageDown" ? list.clientHeight : event.key === "PageUp" ? -list.clientHeight : 0;
  if (!distance && event.key !== "Home" && event.key !== "End") return;
  event.preventDefault(); event.stopPropagation(); pointer = undefined;
  if (event.key === "Home") list.scrollTop = 0;
  else if (event.key === "End") list.scrollTop = list.scrollHeight;
  else list.scrollTop += distance;
});
new ResizeObserver(() => { schedulePaint(); requestWindow(); }).observe(list);
$("row-height").addEventListener("input", () => {
  const position = list.scrollTop / rowHeight;
  rowHeight = Math.max(36, Math.min(120, $<HTMLInputElement>("row-height").valueAsNumber || 56));
  document.documentElement.style.setProperty("--row", `${rowHeight}px`);
  $("row-height-value").textContent = `${rowHeight} px`;
  // Update the scroll extent before restoring the same fractional row position.
  rows.style.height = `${filtered.length * rowHeight}px`;
  list.scrollTop = position * rowHeight;
  pointer = undefined;
  paint(); requestWindow();
});
document.addEventListener("pointermove", event => { if (press && Math.hypot(event.clientX - press.x, event.clientY - press.y) > 5) press.moved = true; }, { passive: true });
document.addEventListener("mousedown", event => {
  const target = event.target as HTMLElement;
  if (!target.closest("input,textarea,[contenteditable=true],#preview,#details,#quicklook-content,#quicklook-title")) clearTextSelection();
  if (!target.closest("#context-menu")) $("context-menu").hidden = true;
});
function applyFilter(reset = true) {
  const query = search.value.toLocaleLowerCase(), kind = $<HTMLSelectElement>("kind").value;
  filtered = files.filter(file => (!query || file.relativePath.toLocaleLowerCase().includes(query)) && (kind === "all" || kind === file.kind || kind === "saved" && saved.has(file.path)));
  filtered.sort((a, b) => compareFiles(a, b, sortField, sortDirection)); orderedIds = filtered.map(file => file.id);
  selection.retain(new Set(orderedIds));
  if (reset) list.scrollTop = 0;
  $("file-count").textContent = `${filtered.length.toLocaleString()} of ${files.length.toLocaleString()} items`;
  if (!active || !filtered.some(file => file.id === active!.id)) { active = undefined; selectionVersion++; if (selection.ids.size) setActive(selectedFiles().at(-1)!, true); else if (filtered.length) setActive(filtered[0]); else refreshInspector(); }
  else refreshInspector();
  schedulePaint(); requestWindow();
}
function changeSort(field: SortField, reverse = false) {
  sortDirection = reverse ? sortDirection === 1 ? -1 : 1 : field === "name" || field === "kind" ? 1 : -1;
  sortField = field; $<HTMLSelectElement>("sort").value = field;
  $("sort-direction").textContent = sortDirection === 1 ? "↑" : "↓";
  document.querySelectorAll<HTMLButtonElement>("[data-sort]").forEach(button => button.setAttribute("aria-pressed", String(button.dataset.sort === field)));
  applyFilter();
}
let filterTimer: ReturnType<typeof setTimeout>;
search.addEventListener("input", () => { clearTimeout(filterTimer); filterTimer = setTimeout(() => applyFilter(), 100); });
$("kind").addEventListener("change", () => applyFilter());
$("sort").addEventListener("change", () => changeSort($<HTMLSelectElement>("sort").value as SortField));
$("sort-direction").addEventListener("click", () => changeSort(sortField, true));
document.querySelectorAll<HTMLButtonElement>("[data-sort]").forEach(button => button.onclick = () => {
  if (performance.now() >= suppressSortUntil) changeSort(button.dataset.sort as SortField, button.dataset.sort === sortField);
});
async function openFolder(path: string, focusPath?: string) {
  if (!path.trim()) return;
  const serial = ++scanSerial;
  try {
    const status = await api<ScanStatus>("/api/open", { path: path.trim(), recursive: $<HTMLInputElement>("recursive").checked });
    if (serial !== scanSerial) return;
    closeQuickLook(); clearTextSelection(); $("context-menu").hidden = true;
    if (status.root !== root) search.value = "";
    generation = status.generation; root = status.root; parent = status.parent; folder.value = root;
    files = []; filtered = []; orderedIds = []; byId.clear(); selection.clear(); cursor = 0; active = undefined;
    selectionVersion++; workVersion++; desired = []; clearCache(); rendered.clear(); rows.replaceChildren(); list.scrollTop = list.scrollLeft = 0;
    $<HTMLButtonElement>("up").disabled = root === parent; $<HTMLButtonElement>("finder-folder").disabled = !finderAvailable;
    $("scan-state").textContent = "Indexing…";
    while (serial === scanSerial) {
      const page = await api<{ files: FileEntry[]; status: ScanStatus }>(`/api/files?generation=${generation}&offset=${cursor}`);
      if (serial !== scanSerial) return;
      files.push(...page.files); page.files.forEach(file => byId.set(file.id, file)); cursor += page.files.length; applyFilter(false);
      $("scan-state").textContent = page.status.done ? `Indexed · ${page.status.skipped} unreadable` : "Indexing…";
      if (page.status.done && cursor >= page.status.count) break;
      if (page.files.length < 4000) await new Promise(resolve => setTimeout(resolve, 150));
    }
    if (focusPath && serial === scanSerial) { const file = filtered.find(file => file.path === focusPath); if (file) { clickFile(file); ensureVisible(file); } }
  } catch (error) { toast((error as Error).message); $("scan-state").textContent = "Could not load folder"; }
}
function goUp() { if (root && parent && parent !== root) void openFolder(parent, root); }
function ensureVisible(file: FileEntry) {
  const index = filtered.findIndex(item => item.id === file.id);
  if (index < 0) return;
  if (index * rowHeight < list.scrollTop) list.scrollTop = index * rowHeight;
  else if ((index + 1) * rowHeight > list.scrollTop + list.clientHeight) list.scrollTop = (index + 1) * rowHeight - list.clientHeight;
}
$("folder-form").addEventListener("submit", event => { event.preventDefault(); void openFolder(folder.value); });
$("recursive").addEventListener("change", () => { if (root) void openFolder(root); });
$("up").addEventListener("click", goUp);
$("finder-folder").addEventListener("click", () => void api("/api/finder-folder", {}).catch(error => toast(error.message)));
$("choose").addEventListener("click", async () => {
  if (!nativePicker) { folder.focus(); toast("Paste the absolute path of a folder, then press Enter."); return; }
  try { const { path } = await api("/api/pick", {}); if (path) await openFolder(path); } catch (error) { toast((error as Error).message); }
});
$("save").addEventListener("click", toggleSaved); $("clear-selection").addEventListener("click", clearSelection);
$("reveal").addEventListener("click", () => { if (active) void api("/api/reveal", { id: active.id }).catch(error => toast(error.message)); });
$("context-reveal").addEventListener("click", () => { $("context-menu").hidden = true; if (contextFile) void api("/api/reveal", { id: contextFile.id }).catch(error => toast(error.message)); });
$("quicklook-close").addEventListener("click", closeQuickLook);
$("quicklook-prev").addEventListener("click", () => stepQuickLook(-1)); $("quicklook-next").addEventListener("click", () => stepQuickLook(1));
quicklook.addEventListener("click", event => { if (event.target === quicklook) { const rect = quicklook.getBoundingClientRect(); if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) closeQuickLook(); } });
$("export").addEventListener("click", () => {
  const url = URL.createObjectURL(new Blob([JSON.stringify({ exportedAt: new Date().toISOString(), files: [...saved.values()] }, null, 2)], { type: "application/json" }));
  const anchor = document.createElement("a"); anchor.href = url; anchor.download = "fast-files-shortlist.json"; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 5000);
});
document.addEventListener("keydown", event => {
  if (about.open || columnSettings.open) {
    if (event.key === "Escape") { event.preventDefault(); (about.open ? about : columnSettings).close(); }
    return;
  }
  const target = event.target as HTMLElement, editable = target.matches("input,textarea,select") || target.isContentEditable;
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "o") { event.preventDefault(); $("choose").click(); return; }
  if (editable) return;
  if ((event.metaKey || event.ctrlKey) && event.key === "ArrowUp") { event.preventDefault(); goUp(); return; }
  if (event.key === "Escape") { if (quicklook.open) { event.preventDefault(); closeQuickLook(); } else if (!$("context-menu").hidden) $("context-menu").hidden = true; else clearSelection(); return; }
  if (event.code === "Space") { event.preventDefault(); if (!event.repeat) toggleQuickLook(); return; }
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "a" && (target === list || target.closest("#rows"))) { event.preventDefault(); selection.ids = new Set(orderedIds); selection.anchor = orderedIds[0]; selectionChanged(active || filtered[0]); return; }
  if (event.key === "s" && !event.metaKey && !event.ctrlKey) { event.preventDefault(); toggleSaved(); }
  if (event.key === "Enter" && active?.kind === "folder") { event.preventDefault(); void openFolder(active.path); return; }
  if (quicklook.open && (event.key === "ArrowLeft" || event.key === "ArrowRight")) { event.preventDefault(); stepQuickLook(event.key === "ArrowLeft" ? -1 : 1); return; }
  const direction = event.key === "ArrowDown" ? 1 : event.key === "ArrowUp" ? -1 : 0;
  if (direction && filtered.length) {
    event.preventDefault(); pointer = undefined;
    const index = active ? filtered.findIndex(file => file.id === active!.id) : direction > 0 ? -1 : filtered.length;
    const file = filtered[Math.max(0, Math.min(filtered.length - 1, index + direction))];
    if (event.shiftKey && !selection.anchor && active) selection.anchor = active.id;
    selection.click(file.id, orderedIds, { range: event.shiftKey }); setActive(file, true); ensureVisible(file);
  }
});
applyColumnOrder(); updateSaved();
void api<FileEntry[]>("/api/shortlist").then(items => { for (const file of items) saved.set(file.path, file); updateSaved(); schedulePaint(); }).catch(() => {});
async function poll() {
  try {
    const status = await api("/api/status"); nativePicker = status.nativePicker; nativeDrag = status.nativeDrag; finderAvailable = status.finder;
    $<HTMLButtonElement>("finder-folder").disabled = !finderAvailable || !root;
    $<HTMLButtonElement>("reveal").disabled = !finderAvailable;
    $("memory").textContent = `${status.queue.active} loading · ${status.queue.queued} queued · ${size(status.queue.cached)} cached`;
  } catch { /* server may be rebuilding */ }
}
void poll(); setInterval(() => void poll(), 2000);
