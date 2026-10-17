import { test, expect } from "bun:test";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { startServer } from "../src/server/server";
import { WorkQueue } from "../src/server/queue";
import { ShortlistStore } from "../src/server/shortlist";

const tick = () => new Promise(resolve => setTimeout(resolve, 5));
const options = { webRoot: resolve("dist/web"), helper: "missing" };
function client(app: ReturnType<typeof startServer>) {
  return async (path: string, body?: unknown) => {
    const response = await fetch(app.url.split("#")[0] + `api/${path}`, {
      headers: { Authorization: `Bearer ${app.token}`, "Content-Type": "application/json" },
      method: body === undefined ? "GET" : "POST", body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: response.status, value: await response.json() };
  };
}

test("window sessions isolate catalogs, tokens, prefetch revisions, dragging, and disposal", async () => {
  const root = await mkdtemp(join(tmpdir(), "fast-files-windows-"));
  const queue = new WorkQueue(1024 ** 2, 1);
  let release!: () => void;
  const blocker = queue.submit("blocker", queue.budget, 0, () => new Promise<void>(r => release = r));
  let aDrag: string[] = [], bDrag: string[] = [], newWindows = 0;
  const a = startServer({ ...options, queue, armDrag: paths => aDrag = paths, newWindow: () => newWindows++ });
  const b = startServer({ ...options, queue, armDrag: paths => bDrag = paths });
  const ca = client(a), cb = client(b);
  try {
    await mkdir(join(root, "a")); await mkdir(join(root, "b"));
    await writeFile(join(root, "a", "a.ts"), "const a = 1"); await writeFile(join(root, "b", "b.ts"), "const b = 2");
    await Promise.all([ca("open", { path: join(root, "a") }), cb("open", { path: join(root, "b") })]);
    while (!a.catalog.status.done || !b.catalog.status.done) await tick();
    expect(a.catalog.files.map(f => f.name)).toEqual(["a.ts"]);
    expect(b.catalog.files.map(f => f.name)).toEqual(["b.ts"]);
    expect(a.token).not.toBe(b.token);
    expect((await fetch(b.url.split("#")[0] + "api/status", { headers: { Authorization: `Bearer ${a.token}` } })).status).toBe(401);
    const af = a.catalog.files[0], bf = b.catalog.files[0];
    expect((await ca("drag", { ids: [bf.id] })).status).toBe(400); expect(aDrag).toEqual([]);
    expect((await cb("drag", { ids: [bf.id], startedAt: Date.now() })).status).toBe(200);
    expect(bDrag).toEqual([bf.path]); expect(aDrag).toEqual([]);
    expect((await ca("new-window", {})).status).toBe(200); expect(newWindows).toBe(1);
    expect((await cb("new-window", {})).status).toBe(400); expect(newWindows).toBe(1);
    await ca("window", { generation: a.catalog.status.generation, revision: 100, thumbnails: [af.id], large: [] });
    await cb("window", { generation: b.catalog.status.generation, revision: 1, thumbnails: [bf.id], large: [] });
    expect(queue.queued).toBe(2); // B's revision and cancellation cannot affect A.
    await ca("open", { path: join(root, "a") });
    expect(queue.queued).toBe(1); // Rescanning A keeps B's queued thumbnail.
    a.dispose(); a.dispose();
    expect(a.catalog.byId.size).toBe(0); expect(queue.queued).toBe(1);
    release(); await blocker;
    while (queue.active || queue.queued) await tick();
    expect(b.previews.cache.get(b.previews.key(bf.id, 240))?.preview.type).toBe("text");
    expect((await cb("status")).value.root).toBe(b.catalog.status.root);
    expect((await cb(`preview/${bf.id}?side=240`)).value.text).toBe("const b = 2");
    await expect(a.catalog.scan(root)).rejects.toThrow("closed");
  } finally { release?.(); a.dispose(); b.dispose(); await blocker; await rm(root, { recursive: true, force: true }); }
});

test("closing a window cancels only its queued requests and releases its caches", async () => {
  const root = await mkdtemp(join(tmpdir(), "fast-files-close-"));
  const queue = new WorkQueue(1024 ** 2, 1);
  let release!: () => void;
  const blocker = queue.submit("blocker", queue.budget, 0, () => new Promise<void>(r => release = r));
  const a = startServer({ ...options, queue }), b = startServer({ ...options, queue });
  try {
    await writeFile(join(root, "test.txt"), "preview");
    await Promise.all([a.catalog.scan(root), b.catalog.scan(root)]);
    while (!a.catalog.status.done || !b.catalog.status.done) await tick();
    const canceled = a.previews.get(a.catalog.files[0].id, 240).catch(error => error.message);
    const kept = b.previews.get(b.catalog.files[0].id, 240);
    expect(queue.queued).toBe(2);
    a.dispose(); expect(await canceled).toBe("Superseded"); expect(queue.queued).toBe(1);
    release(); await blocker; expect((await kept).preview.type).toBe("text");
    b.dispose(); expect(b.previews.cache.bytes).toBe(0);
    await expect(b.previews.get("anything", 240)).rejects.toThrow("closed");
  } finally { release?.(); a.dispose(); b.dispose(); await blocker; await rm(root, { recursive: true, force: true }); }
});

test("concurrent shortlist mutations from different windows survive closing and reopening", async () => {
  const root = await mkdtemp(join(tmpdir(), "fast-files-shared-shortlist-"));
  const path = join(root, "saved.json"), shortlist = new ShortlistStore(path);
  const a = startServer({ ...options, shortlist }), b = startServer({ ...options, shortlist });
  const ca = client(a), cb = client(b);
  try {
    await writeFile(join(root, "one.ts"), "one"); await writeFile(join(root, "two.ts"), "two");
    await Promise.all([a.catalog.scan(root), b.catalog.scan(root)]);
    while (!a.catalog.status.done || !b.catalog.status.done) await tick();
    const one = a.catalog.files.find(f => f.name === "one.ts")!, two = b.catalog.files.find(f => f.name === "two.ts")!;
    const updates = await Promise.all([ca("shortlist/mutate", { add: [one.id] }), cb("shortlist/mutate", { add: [two.id] })]);
    expect(updates.map(r => r.status)).toEqual([200, 200]);
    expect((await ca("shortlist/state")).value.files.map((f: { name: string }) => f.name).sort()).toEqual(["one.ts", "two.ts"]);
    expect((await ca("shortlist", [])).status).toBe(404); // No stale snapshot replacements in native sessions.
    expect((await ca("shortlist/mutate", { add: [two.id] })).status).toBe(400); // Foreign catalog IDs rejected.
    await Promise.all([ca("shortlist/mutate", { remove: [one.path] }), cb("shortlist/mutate", { add: [two.id] })]);
    a.dispose(); b.dispose();
    const restored = await new ShortlistStore(path).snapshot();
    expect(restored.files.map(f => f.name)).toEqual(["two.ts"]);
    expect((await shortlist.snapshot()).revision).toBe(4);
    // A rejected operation does not block subsequent durable mutations.
    await expect(shortlist.mutate(Array.from({ length: 50001 }, (_, i) => ({ ...one, path: `file-${i}` })), [])).rejects.toThrow("limit");
    expect((await shortlist.mutate([one], [])).files.map(f => f.name).sort()).toEqual(["one.ts", "two.ts"]);
  } finally { a.dispose(); b.dispose(); await rm(root, { recursive: true, force: true }); }
});
