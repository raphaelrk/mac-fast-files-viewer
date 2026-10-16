import type { FileEntry, Preview, ScanStatus } from "../shared/types";

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const list = $("list"), rows = $("rows"), folder = $<HTMLInputElement>("folder"), search = $<HTMLInputElement>("search");
const token = location.hash.slice(1) || sessionStorage.getItem("fast-files-token") || "";
sessionStorage.setItem("fast-files-token", token);
history.replaceState(null, "", location.pathname);
const ROW = 92;
let files: FileEntry[] = [], filtered: FileEntry[] = [], active: FileEntry | undefined;
let root = "", generation = "", cursor = 0, pinned = false, nativePicker = false;
let scanSerial = 0, paintFrame = 0, windowTimer: ReturnType<typeof setTimeout>;
let paintFallback: ReturnType<typeof setTimeout>;
let pointer: { x: number; y: number } | undefined;
const rendered = new Map<string, HTMLElement>();
const saved = new Map<string, FileEntry>();
let saveWork = Promise.resolve();

async function api<T = any>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(path, { headers: { Authorization: `Bearer ${token}`, ...(body === undefined ? {} : { "Content-Type": "application/json" }) }, method: body === undefined ? "GET" : "POST", body: body === undefined ? undefined : JSON.stringify(body) });
  const value = await response.json();
  if (!response.ok) throw new Error(value.error || response.statusText);
  return value;
}
function toast(message: string) { $("toast").textContent = message; $("toast").hidden = false; setTimeout(() => $("toast").hidden = true, 5000); }
const size = (bytes: number) => bytes < 1024 ? `${bytes} B` : bytes < 1024 ** 2 ? `${(bytes / 1024).toFixed(0)} KiB` : `${(bytes / 1024 ** 2).toFixed(1)} MiB`;
const date = (value: number) => new Date(value).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });

// A byte-counted browser cache accounts for decoded pixels as well as blobs.
type Cached = { preview: Preview; blob?: string; image?: HTMLImageElement; bytes: number };
const cache = new Map<string, Cached>();
let cacheBytes = 0;
const waiting = new Map<string, Promise<Cached>>();
function clearCache() { for (const item of cache.values()) if (item.blob) URL.revokeObjectURL(item.blob); cache.clear(); cacheBytes = 0; }
function touch(key: string) { const item = cache.get(key); if (item) { cache.delete(key); cache.set(key, item); } return item; }
async function load(file: FileEntry, side: number): Promise<Cached> {
  const key = `${file.id}/${side}`;
  const hit = touch(key); if (hit) return hit;
  const existing = waiting.get(key); if (existing) return existing;
  const work = (async () => {
    const preview = await api<Preview>(`/api/preview/${encodeURIComponent(file.id)}?side=${side}`);
    let blob: string | undefined, image: HTMLImageElement | undefined, bytes = preview.type === "text" ? preview.text.length * 2 : 512;
    if (preview.type === "image") {
      const response = await fetch(preview.url, { headers: { Authorization: `Bearer ${token}` } });
      if (!response.ok) throw new Error("Image no longer available");
      const data = await response.blob(); blob = URL.createObjectURL(data);
      // Decode now, so nearby previews are already ready when selected.
      image = new Image(); image.src = blob;
      try { await image.decode(); } catch { URL.revokeObjectURL(blob); throw new Error("Could not display image"); }
      bytes = preview.width * preview.height * 4 + data.size;
    }
    const item = { preview, blob, image, bytes };
    if (file.id.startsWith(generation + ":")) {
      cache.set(key, item); cacheBytes += bytes;
      while (cacheBytes > 128 * 1024 ** 2 && cache.size > 1) {
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

function updateSaved() {
  $("shortlist-count").textContent = String(saved.size);
  $("save").textContent = active && saved.has(active.path) ? "★" : "☆";
}
function toggleSaved() {
  if (!active) return;
  if (saved.has(active.path)) saved.delete(active.path); else saved.set(active.path, active);
  const snapshot = [...saved.values()];
  saveWork = saveWork.then(() => api("/api/shortlist", snapshot)).catch(error => toast(`Could not save shortlist: ${error.message}`));
  updateSaved(); applyFilter(false);
}
function row(file: FileEntry, index: number) {
  const element = document.createElement("div"); element.className = "file-row"; element.dataset.id = file.id;
  element.setAttribute("role", "option"); element.id = `file-${file.id}`;
  element.innerHTML = '<div class="thumbnail"><span class="ext"></span></div><div class="file-info"><div class="filename"></div><div class="filepath"></div></div><div class="file-date"></div><div class="file-size"></div>';
  element.querySelector(".thumbnail")!.setAttribute("aria-hidden", "true");
  element.querySelector(".ext")!.textContent = (file.extension || "txt").slice(0, 8).toUpperCase();
  element.querySelector(".filename")!.textContent = `${saved.has(file.path) ? "★ " : ""}${file.name}`;
  element.querySelector(".filepath")!.textContent = file.relativePath;
  element.querySelector(".file-date")!.textContent = date(file.modified);
  element.querySelector(".file-size")!.textContent = size(file.size);
  element.style.top = `${index * ROW}px`;
  element.addEventListener("mouseenter", () => { if (!pinned) select(file); });
  element.addEventListener("click", () => { select(file); list.focus({ preventScroll: true }); });
  return element;
}
function paint() {
  cancelAnimationFrame(paintFrame); clearTimeout(paintFallback);
  paintFrame = 0;
  rows.style.height = `${filtered.length * ROW}px`;
  $("empty").hidden = filtered.length > 0;
  if (!filtered.length && root) { $("empty").querySelector("h1")!.textContent = "No matching files"; $("empty").querySelector("p")!.textContent = "Try changing your filter or opening another folder."; }
  const first = Math.max(0, Math.floor(list.scrollTop / ROW) - 4), last = Math.min(filtered.length, Math.ceil((list.scrollTop + list.clientHeight) / ROW) + 4);
  const visible = new Set(filtered.slice(first, last).map(file => file.id));
  for (const [id, element] of rendered) if (!visible.has(id)) { element.remove(); rendered.delete(id); }
  for (let i = first; i < last; i++) {
    const file = filtered[i]; let element = rendered.get(file.id);
    if (!element) { element = row(file, i); rendered.set(file.id, element); rows.append(element); }
    element.style.top = `${i * ROW}px`;
    element.classList.toggle("active", file.id === active?.id);
    element.setAttribute("aria-selected", String(file.id === active?.id));
    element.querySelector(".filename")!.textContent = `${saved.has(file.path) ? "★ " : ""}${file.name}`;
    const cached = touch(`${file.id}/240`);
    if (cached && element.dataset.preview !== `${file.id}/240`) {
      const thumb = element.querySelector(".thumbnail")!; thumb.replaceChildren();
      if (cached.blob) { const img = new Image(); img.src = cached.blob; img.alt = ""; thumb.append(img); }
      else if (cached.preview.type === "text") { const pre = document.createElement("pre"); pre.textContent = cached.preview.text.slice(0, 600); thumb.append(pre); }
      else { const ext = document.createElement("span"); ext.className = "ext"; ext.textContent = (file.extension || "FILE").toUpperCase(); thumb.append(ext); }
      element.dataset.preview = `${file.id}/240`;
    }
  }
}
function schedulePaint() {
  if (!paintFrame) {
    paintFrame = requestAnimationFrame(paint);
    // WKWebView can suspend animation frames for a background native window.
    paintFallback = setTimeout(paint, 80);
  }
}
function showPreview(item: Cached) {
  const container = $("preview"); container.replaceChildren();
  if (item.blob) { const image = new Image(); image.src = item.blob; image.alt = active?.name || "Preview"; container.append(image); }
  else if (item.preview.type === "text") {
    const pre = document.createElement("pre"); pre.textContent = item.preview.text + (item.preview.truncated ? "\n\n[Preview limited to the first 64 KiB]" : ""); container.append(pre);
  } else if (item.preview.type === "unavailable") {
    const message = document.createElement("p"); message.className = "preview-message"; message.textContent = item.preview.reason; container.append(message);
  }
}
let selectionVersion = 0;
function select(file: FileEntry) {
  if (active?.id === file.id) return;
  active = file; const version = ++selectionVersion;
  $("details").hidden = false; $("name").textContent = file.name; $("path").textContent = file.path;
  $("detail-kind").textContent = `${file.extension.toUpperCase() || "Unknown"} ${file.kind === "image" ? "image" : "file"}`;
  $("detail-size").textContent = size(file.size); $("detail-modified").textContent = date(file.modified); $("detail-created").textContent = date(file.created);
  updateSaved(); schedulePaint();
  const hit = touch(`${file.id}/1600`);
  if (hit) showPreview(hit); else {
    $("preview").replaceChildren(); const message = document.createElement("p"); message.className = "preview-message"; message.textContent = "Loading preview…"; $("preview").append(message);
    void load(file, 1600).then(item => { if (version === selectionVersion) showPreview(item); }).catch(error => { if (version === selectionVersion && error.message !== "Superseded") { $("preview").textContent = error.message; } });
  }
  requestWindow();
}

let workVersion = 0, desired: { file: FileEntry; side: number }[] = [], workers = 0;
function runLoads() {
  while (workers < 4 && desired.length) {
    const { file, side } = desired.shift()!;
    if (cache.has(`${file.id}/${side}`)) continue;
    workers++; const version = workVersion;
    void load(file, side).then(() => { if (version === workVersion) schedulePaint(); }).catch(() => {}).finally(() => { workers--; runLoads(); });
  }
}
function requestWindow() { clearTimeout(windowTimer); windowTimer = setTimeout(() => void prefetch(), 45); }
async function prefetch() {
  const first = Math.floor(list.scrollTop / ROW), last = Math.min(filtered.length, Math.ceil((list.scrollTop + list.clientHeight) / ROW));
  const thumbs = filtered.slice(first, last);
  for (let distance = 1; distance <= 50; distance++) {
    if (filtered[last - 1 + distance]) thumbs.push(filtered[last - 1 + distance]);
    if (filtered[first - distance]) thumbs.push(filtered[first - distance]);
  }
  const index = active ? filtered.findIndex(file => file.id === active!.id) : -1;
  const large = index >= 0 ? [filtered[index], ...[1, -1, 2, -2, 3, -3].map(offset => filtered[index + offset]).filter(Boolean)] : [];
  const version = ++workVersion;
  desired = [];
  try { await api("/api/window", { thumbnails: thumbs.map(f => f.id), large: large.map(f => f.id), active: active?.id, revision: version, generation }); }
  catch { return; }
  if (version !== workVersion) return;
  if (active) {
    const selected = active, selection = selectionVersion;
    void load(selected, 1600).then(item => { if (selection === selectionVersion) showPreview(item); }).catch(() => {});
  }
  desired = [...thumbs.map(file => ({ file, side: 240 })), ...large.map(file => ({ file, side: 1600 }))];
  runLoads();
}
function hoverUnderPointer() {
  if (!pointer || pinned) return;
  const bounds = list.getBoundingClientRect();
  if (pointer.x < bounds.left || pointer.x >= bounds.right || pointer.y < bounds.top || pointer.y >= bounds.bottom) return;
  const file = filtered[Math.floor((pointer.y - bounds.top + list.scrollTop) / ROW)];
  if (file) select(file);
}
list.addEventListener("mousemove", event => { pointer = { x: event.clientX, y: event.clientY }; hoverUnderPointer(); });
list.addEventListener("mouseleave", () => pointer = undefined);
list.addEventListener("scroll", () => { schedulePaint(); hoverUnderPointer(); requestWindow(); }, { passive: true });
new ResizeObserver(() => { schedulePaint(); requestWindow(); }).observe(list);

function applyFilter(reset = true) {
  const query = search.value.toLocaleLowerCase(), kind = $<HTMLSelectElement>("kind").value, sort = $<HTMLSelectElement>("sort").value;
  filtered = files.filter(file => (!query || file.relativePath.toLocaleLowerCase().includes(query)) && (kind === "all" || kind === file.kind || kind === "saved" && saved.has(file.path)));
  filtered.sort((a, b) => sort === "name" ? a.name.localeCompare(b.name) : sort === "size" ? b.size - a.size : sort === "oldest" ? a.modified - b.modified : b.modified - a.modified);
  if (reset) list.scrollTop = 0;
  $("file-count").textContent = `${filtered.length.toLocaleString()} of ${files.length.toLocaleString()} files`;
  if (!active || !filtered.some(file => file.id === active!.id)) {
    active = undefined; selectionVersion++;
    if (filtered.length) select(filtered[0]); else { $("details").hidden = true; $("preview").replaceChildren(); }
  }
  schedulePaint(); requestWindow();
}
let filterTimer: ReturnType<typeof setTimeout>;
search.addEventListener("input", () => { clearTimeout(filterTimer); filterTimer = setTimeout(() => applyFilter(), 100); });
$("kind").addEventListener("change", () => applyFilter()); $("sort").addEventListener("change", () => applyFilter());
async function openFolder(path: string) {
  if (!path.trim()) return;
  const serial = ++scanSerial;
  try {
    const status = await api<ScanStatus>("/api/open", { path: path.trim(), recursive: $<HTMLInputElement>("recursive").checked });
    if (serial !== scanSerial) return;
    generation = status.generation; root = status.root; folder.value = root; files = []; filtered = []; cursor = 0; active = undefined;
    selectionVersion++; workVersion++; desired = []; clearCache(); rendered.clear(); rows.replaceChildren(); list.scrollTop = 0;
    $("scan-state").textContent = "Indexing…";
    while (serial === scanSerial) {
      const page = await api<{ files: FileEntry[]; status: ScanStatus }>(`/api/files?generation=${generation}&offset=${cursor}`);
      if (serial !== scanSerial) return;
      files.push(...page.files); cursor += page.files.length; applyFilter(false);
      $("scan-state").textContent = page.status.done ? `Indexed · ${page.status.skipped} unreadable` : "Indexing…";
      if (page.status.done && cursor >= page.status.count) break;
      if (page.files.length < 4000) await new Promise(resolve => setTimeout(resolve, 150));
    }
  } catch (error) { toast((error as Error).message); $("scan-state").textContent = "Could not load folder"; }
}
$("folder-form").addEventListener("submit", event => { event.preventDefault(); void openFolder(folder.value); });
$("choose").addEventListener("click", async () => {
  if (!nativePicker) { folder.focus(); toast("Paste the absolute path of a folder, then press Enter."); return; }
  try { const { path } = await api("/api/pick", {}); if (path) await openFolder(path); } catch (error) { toast((error as Error).message); }
});
function togglePin() { pinned = !pinned; $("pin").textContent = pinned ? "◆ Preview frozen" : "◇ Live hover"; }
$("pin").addEventListener("click", togglePin); $("save").addEventListener("click", toggleSaved);
$("reveal").addEventListener("click", () => { if (active) void api("/api/reveal", { id: active.id }).catch(error => toast(error.message)); });
$("export").addEventListener("click", () => {
  const data = JSON.stringify({ exportedAt: new Date().toISOString(), files: [...saved.values()] }, null, 2);
  const url = URL.createObjectURL(new Blob([data], { type: "application/json" }));
  const anchor = document.createElement("a"); anchor.href = url; anchor.download = "fast-files-shortlist.json"; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 5000);
});
document.addEventListener("keydown", event => {
  if ((event.metaKey || event.ctrlKey) && event.key === "o") { event.preventDefault(); $("choose").click(); return; }
  if (event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement) return;
  if (event.key === "s" && !event.metaKey && !event.ctrlKey) { event.preventDefault(); toggleSaved(); }
  if (event.code === "Space") { event.preventDefault(); togglePin(); }
  const direction = event.key === "ArrowDown" ? 1 : event.key === "ArrowUp" ? -1 : 0;
  if (direction && filtered.length) {
    event.preventDefault(); pointer = undefined;
    const index = active ? filtered.findIndex(file => file.id === active!.id) : 0;
    const next = Math.max(0, Math.min(filtered.length - 1, index + direction)); select(filtered[next]);
    if (next * ROW < list.scrollTop) list.scrollTop = next * ROW;
    else if ((next + 1) * ROW > list.scrollTop + list.clientHeight) list.scrollTop = (next + 1) * ROW - list.clientHeight;
  }
});
updateSaved();
void api<FileEntry[]>("/api/shortlist").then(items => { for (const file of items) saved.set(file.path, file); updateSaved(); schedulePaint(); }).catch(() => {});
async function poll() {
  try {
    const status = await api("/api/status"); nativePicker = status.nativePicker;
    $("reveal").hidden = !nativePicker;
    $("memory").textContent = `${status.queue.active} loading · ${status.queue.queued} queued · ${size(status.queue.cached)} cached`;
  } catch { /* server may be rebuilding */ }
}
void poll(); setInterval(() => void poll(), 2000);
