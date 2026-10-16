import { test, expect } from "bun:test";
import { mkdtemp, writeFile, mkdir, symlink, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { WorkQueue, ByteCache } from "../src/server/queue";
import { Catalog } from "../src/server/catalog";
import { Previews, MAX_FILE_BYTES } from "../src/server/previews";
import { startServer } from "../src/server/server";
import { deflateSync } from "node:zlib";
import { MAX_PREVIEW_WINDOW, neighbors } from "../src/shared/prefetch";
import { FileSelection } from "../src/shared/selection";
import { compareFiles } from "../src/shared/sort";
import type { FileEntry } from "../src/shared/types";

const tick = () => new Promise(resolve => setTimeout(resolve, 5));
async function indexed(path: string) { const catalog = new Catalog(); await catalog.scan(path, true); while (!catalog.status.done) await tick(); return catalog; }

test("Finder selection supports command toggles, anchored ranges, collapse, and group dragging", () => {
  const selection = new FileSelection(), ids = ["a", "b", "c", "d", "e"];
  selection.click("b", ids); selection.click("d", ids, { toggle: true });
  expect([...selection.ids]).toEqual(["b", "d"]);
  expect(selection.dragIds("b", ids)).toEqual(["b", "d"]);
  expect(selection.dragIds("c", ids)).toEqual(["c"]);
  selection.click("d", ids, { toggle: true }); expect([...selection.ids]).toEqual(["b"]);
  selection.click("a", ids, { range: true }); expect([...selection.ids]).toEqual(["a", "b", "c", "d"]);
  selection.click("c", ids); expect([...selection.ids]).toEqual(["c"]);
  selection.click("e", ids, { range: true }); expect([...selection.ids]).toEqual(["c", "d", "e"]);
  selection.click("b", ids, { range: true }); expect([...selection.ids]).toEqual(["b", "c"]);
  selection.retain(new Set(["a", "b"])); expect([...selection.ids]).toEqual(["b"]); expect(selection.anchor).toBeUndefined();
  selection.clear(); expect(selection.ids.size).toBe(0); expect(selection.focus).toBeUndefined();
});

test("all Finder sort fields use their own metadata and missing added dates stay last", () => {
  const entry = (name: string, values: Partial<FileEntry>): FileEntry => ({ id: name, name, path: `/archive/${name}`, relativePath: name, kind: "text", kindLabel: "Text", extension: "txt", size: 1, modified: 1, created: 1, added: null, ...values });
  const a = entry("file2", { size: 9, modified: 8, created: 7, added: 6, kindLabel: "Image" });
  const b = entry("file10", { size: 10, modified: 9, created: 8, added: 7, kindLabel: "Text" });
  for (const field of ["name", "size", "modified", "created", "added", "kind"] as const) {
    expect(compareFiles(a, b, field, 1)).toBeLessThan(0); expect(compareFiles(a, b, field, -1)).toBeGreaterThan(0);
  }
  const missing = entry("absent", {});
  expect(compareFiles(missing, a, "added", 1)).toBeGreaterThan(0);
  expect(compareFiles(missing, a, "added", -1)).toBeGreaterThan(0);
});

test("default scans list folders without descendants; recursive scans include descendants and omit private notes", async () => {
  const root = await mkdtemp(join(tmpdir(), "fast-files-folders-"));
  try {
    await mkdir(join(root, "child")); await mkdir(join(root, ".notes"));
    await writeFile(join(root, "top.txt"), "top"); await writeFile(join(root, "child", "nested.txt"), "nested");
    await writeFile(join(root, ".notes", "private.txt"), "private");
    const catalog = new Catalog(resolve(".cache/metadata"));
    await catalog.scan(root); while (!catalog.status.done) await tick();
    expect(catalog.files.map(f => f.name).sort()).toEqual(["child", "top.txt"]);
    expect(catalog.status.parent).toBe(resolve(catalog.status.root, ".."));
    const child = catalog.files.find(f => f.name === "child")!;
    expect(child.kind).toBe("folder"); expect(child.kindLabel).not.toBe("");
    expect((await new Previews(catalog, "missing").get(child.id, 1600)).preview.type).toBe("folder");
    await writeFile(join(root, "child", "later.txt"), "new");
    expect((await catalog.validate(child.id)).path).toBe(child.path);
    const top = catalog.files.find(f => f.name === "top.txt")!;
    expect(top.added === null || Number.isFinite(top.added)).toBe(true);
    expect(top.kindLabel).not.toBe("TXT file"); // Native type description, rather than extension fallback.
    await catalog.scan(root, true); while (!catalog.status.done) await tick();
    expect(catalog.files.map(f => f.relativePath).sort()).toEqual(["child", "child/later.txt", "child/nested.txt", "top.txt"]);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("Finder actions use the current catalog folder and validated item paths", async () => {
  const root = await mkdtemp(join(tmpdir(), "fast-files-finder-"));
  let opened: string | undefined, revealed: string | undefined;
  const app = startServer({ webRoot: resolve("dist/web"), helper: "missing", openFolder: path => opened = path, reveal: path => revealed = path });
  try {
    await writeFile(join(root, "example.txt"), "test");
    await app.catalog.scan(root); while (!app.catalog.status.done) await tick();
    const base = app.url.split("#")[0], headers = { Authorization: `Bearer ${app.token}`, "Content-Type": "application/json" };
    expect((await fetch(base + "api/finder-folder", { method: "POST", headers, body: "{}" })).status).toBe(200);
    expect(opened).toBe(app.catalog.status.root);
    expect((await fetch(base + "api/reveal", { method: "POST", headers, body: JSON.stringify({ id: "foreign" }) })).status).toBe(400);
    expect(revealed).toBeUndefined();
    const file = app.catalog.files[0];
    expect((await fetch(base + "api/reveal", { method: "POST", headers, body: JSON.stringify({ id: file.id }) })).status).toBe(200);
    expect(revealed).toBe(file.path);
  } finally { app.server.stop(true); await rm(root, { recursive: true, force: true }); }
});

test("expanded preview window covers both directions without dropping boundary files", () => {
  const items = Array.from({ length: 100 }, (_, i) => i);
  expect(neighbors(items, 50)).toHaveLength(MAX_PREVIEW_WINDOW);
  expect(neighbors(items, 50).slice(0, 5)).toEqual([50, 51, 49, 52, 48]);
  expect(new Set(neighbors(items, 50)).size).toBe(MAX_PREVIEW_WINDOW);
  expect(neighbors(items, 0)).toEqual(items.slice(0, 21));
  expect(neighbors(items, 99)).toEqual(items.slice(79).reverse());
  expect(neighbors([], 0)).toEqual([]);
});

test("native drag validates the whole selection, deduplicates, and includes folders", async () => {
  const root = await mkdtemp(join(tmpdir(), "fast-files-drag-"));
  let dragged: string[] | undefined;
  const app = startServer({ webRoot: resolve("dist/web"), helper: "missing", armDrag: paths => dragged = paths });
  try {
    await writeFile(join(root, "example file.txt"), "Drop this file");
    await mkdir(join(root, "folder"));
    await app.catalog.scan(root, false); while (!app.catalog.status.done) await tick();
    const endpoint = app.url.split("#")[0] + "api/drag";
    const headers = { Authorization: `Bearer ${app.token}`, "Content-Type": "application/json" };
    const invalid = await fetch(endpoint, { method: "POST", headers, body: JSON.stringify({ id: "/etc/passwd" }) });
    expect(invalid.status).toBe(400); expect(dragged).toBeUndefined();
    const file = app.catalog.files.find(f => f.kind !== "folder")!;
    const folder = app.catalog.files.find(f => f.kind === "folder")!;
    const mixed = await fetch(endpoint, { method: "POST", headers, body: JSON.stringify({ ids: [file.id, "foreign"] }) });
    expect(mixed.status).toBe(400); expect(dragged).toBeUndefined();
    const valid = await fetch(endpoint, { method: "POST", headers, body: JSON.stringify({ id: file.id }) });
    expect(valid.status).toBe(200); expect(dragged).toEqual([file.path]);
    const multiple = await fetch(endpoint, { method: "POST", headers, body: JSON.stringify({ ids: [folder.id, file.id, folder.id] }) });
    expect(multiple.status).toBe(200); expect(dragged).toEqual([folder.path, file.path]);
  } finally { app.server.stop(true); await rm(root, { recursive: true, force: true }); }
});

test("admission obeys total bytes, deduplicates jobs, and prioritizes newly freed slots", async () => {
  const queue = new WorkQueue(100, 3); const order: string[] = [];
  let release!: () => void;
  const first = queue.submit("first", 70, 10, () => new Promise<void>(r => release = r));
  const low = queue.submit("low", 40, 20, async () => { order.push("low"); });
  const high = queue.submit("high", 40, 0, async () => { order.push("high"); });
  const same = queue.submit<void>("high", 40, 0, async () => { throw new Error("duplicate ran"); });
  expect(same).toBe(high);
  await tick(); expect(queue.activeBytes).toBe(70); expect(queue.queued).toBe(2);
  release(); await Promise.all([first, low, high]); await tick();
  expect(order).toEqual(["high", "low"]); expect(queue.activeBytes).toBe(0);
  await expect(queue.submit("too big", 101, 0, async () => {})).rejects.toThrow("budget");
});

test("canceling stale queued work releases its deduplication slot", async () => {
  const queue = new WorkQueue(100, 1); let release!: () => void;
  const running = queue.submit("running", 100, 1, () => new Promise<void>(r => release = r));
  const stale = queue.submit("stale", 50, 1, async () => "old");
  const rejected = stale.catch(error => error.message);
  queue.cancelQueued(new Set()); expect(await rejected).toBe("Superseded");
  const replacement = queue.submit("stale", 50, 0, async () => "new");
  await tick(); release(); await running; expect(await replacement).toBe("new");
});

test("LRU evicts by bytes and refreshes reads", () => {
  const cache = new ByteCache<number>(10);
  cache.set("a", 1, 4); cache.set("b", 2, 4); cache.get("a"); cache.set("c", 3, 4);
  expect(cache.get("b")).toBeUndefined(); expect(cache.get("a")).toBe(1); expect(cache.bytes).toBe(8);
  cache.set("giant", 4, 20); expect(cache.bytes).toBe(8);
});

test("catalog skips symlinks and dependency folders; text reads are bounded and binary is detected", async () => {
  const root = await mkdtemp(join(tmpdir(), "fast-files-test-"));
  try {
    await mkdir(join(root, "nested")); await mkdir(join(root, "node_modules"));
    await writeFile(join(root, "nested", "code.ts"), "const x = 1;\n".repeat(10000));
    await writeFile(join(root, "binary"), Buffer.from([0, 1, 2]));
    await writeFile(join(root, "node_modules", "ignored.txt"), "ignored");
    await symlink(join(root, "nested", "code.ts"), join(root, "link"));
    const catalog = await indexed(root); expect(catalog.files.length).toBe(3);
    const previews = new Previews(catalog, "missing");
    const text = await previews.get(catalog.files.find(f => f.name === "code.ts")!.id, 1600);
    expect(text.preview.type).toBe("text");
    if (text.preview.type === "text") { expect(text.preview.truncated).toBe(true); expect(text.preview.text.length).toBeLessThanOrEqual(65536); }
    const binary = await previews.get(catalog.files.find(f => f.name === "binary")!.id, 1600);
    expect(binary.preview.type).toBe("unavailable");
    const code = catalog.files.find(f => f.name === "code.ts")!;
    code.size = MAX_FILE_BYTES + 1;
    expect((await previews.get(code.id, 240)).preview.type).toBe("unavailable");
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("local API requires the session token and rejects foreign origins", async () => {
  const app = startServer({ webRoot: resolve("dist/web"), helper: "missing" });
  const url = app.url.split("#")[0];
  try {
    expect((await fetch(url + "api/status")).status).toBe(401);
    const headers = { Authorization: `Bearer ${app.token}` };
    expect((await fetch(url + "api/status", { headers })).status).toBe(200);
    expect((await fetch(url + "api/status", { headers: { ...headers, Origin: "https://example.com" } })).status).toBe(403);
    expect((await fetch(url + "../package.json")).status).toBe(404);
  } finally { app.server.stop(true); }
});

test("shortlist survives a new server session", async () => {
  const root = await mkdtemp(join(tmpdir(), "fast-files-shortlist-"));
  const options = { webRoot: resolve("dist/web"), helper: "missing", shortlistPath: join(root, "shortlist.json") };
  let app = startServer(options);
  try {
    const value = [{ name: "idea.ts", path: "/archive/idea.ts" }];
    const response = await fetch(app.url.split("#")[0] + "api/shortlist", { method: "POST", headers: { Authorization: `Bearer ${app.token}`, "Content-Type": "application/json" }, body: JSON.stringify(value) });
    expect(response.status).toBe(200);
    app.server.stop(true); app = startServer(options);
    const restored = await fetch(app.url.split("#")[0] + "api/shortlist", { headers: { Authorization: `Bearer ${app.token}` } });
    expect(await restored.json()).toEqual(value);
  } finally { app.server.stop(true); await rm(root, { recursive: true, force: true }); }
});

test("ImageIO helper downscales a PNG and reports a corrupt image without crashing the service", async () => {
  const root = await mkdtemp(join(tmpdir(), "fast-files-image-test-"));
  try {
    await writeFile(join(root, "image.png"), syntheticPNG(1200, 800));
    for (const format of ["jpeg", "gif"]) {
      const converted = Bun.spawn(["/usr/bin/sips", "-s", "format", format, join(root, "image.png"), "--out", join(root, `image.${format}`)], { stdout: "ignore", stderr: "ignore" });
      expect(await converted.exited).toBe(0);
    }
    await writeFile(join(root, "broken.jpg"), "not an image");
    const catalog = await indexed(root); const previews = new Previews(catalog, resolve(".cache/thumbnail"));
    const image = await previews.get(catalog.files.find(f => f.name === "image.png")!.id, 240);
    expect(image.preview.type).toBe("image");
    if (image.preview.type === "image") { expect(Math.max(image.preview.width, image.preview.height)).toBe(240); }
    for (const format of ["jpeg", "gif"]) expect((await previews.get(catalog.files.find(f => f.name === `image.${format}`)!.id, 1600)).preview.type).toBe("image");
    const broken = await previews.get(catalog.files.find(f => f.name === "broken.jpg")!.id, 240);
    expect(broken.preview.type).toBe("unavailable");
  } finally { await rm(root, { recursive: true, force: true }); }
});

function syntheticPNG(width: number, height: number) {
  function chunk(kind: string, data: Buffer) {
    const contents = Buffer.concat([Buffer.from(kind), data]); let crc = 0xffffffff;
    for (const byte of contents) { crc ^= byte; for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0); }
    const length = Buffer.alloc(4), checksum = Buffer.alloc(4);
    length.writeUInt32BE(data.length); checksum.writeUInt32BE((crc ^ 0xffffffff) >>> 0);
    return Buffer.concat([length, contents, checksum]);
  }
  const header = Buffer.alloc(13); header.writeUInt32BE(width); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 2;
  const pixels = Buffer.alloc(height * (width * 3 + 1), 160);
  for (let y = 0; y < height; y++) pixels[y * (width * 3 + 1)] = 0;
  return Buffer.concat([Buffer.from("89504e470d0a1a0a", "hex"), chunk("IHDR", header), chunk("IDAT", deflateSync(pixels)), chunk("IEND", Buffer.alloc(0))]);
}
