import { Catalog } from "./catalog";
import { Previews } from "./previews";
import { resolve } from "node:path";
import { mkdir, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { MAX_PREVIEW_WINDOW } from "../shared/prefetch";

export function startServer(options: { webRoot: string; helper: string; metadataHelper?: string; shortlistPath?: string; pickFolder?: () => Promise<string | undefined>; reveal?: (path: string) => void; openFolder?: (path: string) => void; armDrag?: (paths: string[]) => void; port?: number }) {
  const catalog = new Catalog(options.metadataHelper);
  const previews = new Previews(catalog, options.helper);
  const token = crypto.randomUUID();
  let windowRevision = 0;
  const json = (value: unknown, status = 200) => Response.json(value, { status, headers: { "Cache-Control": "no-store" } });
  const server = Bun.serve({
    hostname: "127.0.0.1", port: options.port ?? 0, idleTimeout: 30,
    async fetch(request): Promise<Response> {
      const url = new URL(request.url);
      // No CORS; a random bearer token also protects against other local sites.
      if (request.headers.get("host") !== `127.0.0.1:${server.port}`) return new Response("Invalid host", { status: 403 });
      const origin = request.headers.get("origin");
      if (origin && origin !== url.origin) return new Response("Invalid origin", { status: 403 });
      if (!url.pathname.startsWith("/api/")) {
        const assets: Record<string, string> = { "/": "index.html", "/index.js": "index.js", "/index.css": "index.css" };
        const name = assets[url.pathname];
        if (!name) return new Response("Not found", { status: 404 });
        return new Response(Bun.file(resolve(options.webRoot, name)), { headers: {
          "Content-Security-Policy": "default-src 'self'; img-src 'self' blob:; style-src 'self' 'unsafe-inline'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
          "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff",
        } });
      }
      if (request.headers.get("authorization") !== `Bearer ${token}`) return json({ error: "Unauthorized" }, 401);
      try {
        if (url.pathname === "/api/shortlist" && options.shortlistPath) {
          if (request.method === "GET") {
            const file = Bun.file(options.shortlistPath);
            return json(await file.exists() ? await file.json() : []);
          }
          if (request.method === "POST") {
            const values = await request.json();
            if (!Array.isArray(values) || values.length > 50000) throw new Error("Invalid shortlist");
            await mkdir(dirname(options.shortlistPath), { recursive: true });
            const temporary = `${options.shortlistPath}.${crypto.randomUUID()}.tmp`;
            await writeFile(temporary, JSON.stringify(values), { mode: 0o600 });
            await rename(temporary, options.shortlistPath);
            return json({ ok: true });
          }
        }
        if (url.pathname === "/api/status") return json({ ...catalog.status, queue: { active: previews.queue.active, queued: previews.queue.queued, bytes: previews.queue.activeBytes, cached: previews.cache.bytes }, nativePicker: Boolean(options.pickFolder), nativeDrag: Boolean(options.armDrag), finder: Boolean(options.reveal && options.openFolder) });
        if (request.method === "POST" && url.pathname === "/api/open") {
          const { path, recursive } = await request.json();
          const result = await catalog.scan(String(path), Boolean(recursive));
          windowRevision = 0;
          previews.queue.cancelQueued(new Set()); previews.cache.clear();
          return json(result);
        }
        if (request.method === "POST" && url.pathname === "/api/pick") return json({ path: await options.pickFolder?.() });
        if (url.pathname === "/api/files") {
          if (url.searchParams.get("generation") !== catalog.status.generation) return json({ error: "Catalog changed" }, 409);
          const offset = Math.max(0, Number(url.searchParams.get("offset")) || 0);
          return json({ files: catalog.files.slice(offset, offset + 4000), status: catalog.status });
        }
        if (request.method === "POST" && url.pathname === "/api/window") {
          const { thumbnails, large, active, revision, generation } = await request.json();
          if (generation !== catalog.status.generation || !Number.isInteger(revision) || revision <= windowRevision) return json({ ok: true });
          windowRevision = revision;
          const ids = (items: unknown): string[] => Array.isArray(items) ? items.filter((id): id is string => typeof id === "string" && catalog.byId.has(id)).slice(0, 200) : [];
          previews.window(ids(thumbnails), ids(large).slice(0, MAX_PREVIEW_WINDOW), typeof active === "string" && catalog.byId.has(active) ? active : undefined);
          return json({ ok: true });
        }
        const match = url.pathname.match(/^\/api\/(preview|media)\/(.+)$/);
        if (match) {
          const id = decodeURIComponent(match[2]);
          const side = url.searchParams.get("side") === "240" ? 240 : 1600;
          const asset = await previews.get(id, side);
          if (match[1] === "preview") return json(asset.preview);
          if (!asset.data) return json({ error: "No image available" }, 404);
          return new Response(asset.data, { headers: { "Content-Type": "image/png", "Cache-Control": "no-store" } });
        }
        if (request.method === "POST" && url.pathname === "/api/reveal") {
          if (!options.reveal) throw new Error("Finder actions are available in the desktop app");
          const { id } = await request.json();
          const file = await catalog.validate(id);
          options.reveal?.(file.path); return json({ ok: true });
        }
        if (request.method === "POST" && url.pathname === "/api/finder-folder") {
          if (!options.openFolder || !catalog.status.root) throw new Error("Open a folder in the desktop app first");
          options.openFolder(catalog.status.root); return json({ ok: true });
        }
        if (request.method === "POST" && url.pathname === "/api/drag") {
          if (!options.armDrag) return json({ error: "File dragging is available in the native desktop app" }, 400);
          const { ids, id } = await request.json();
          const values: unknown[] = Array.isArray(ids) ? [...new Set(ids)] : [id];
          if (!values.length || values.some(value => typeof value !== "string")) throw new Error("Choose catalog items to drag");
          const paths: string[] = [];
          // Bound filesystem concurrency even when thousands of items are selected.
          for (let i = 0; i < values.length; i += 32) {
            const files = await Promise.all(values.slice(i, i + 32).map(value => catalog.validate(value as string)));
            paths.push(...files.map(file => file.path));
          }
          options.armDrag(paths); return json({ ok: true });
        }
        return json({ error: "Not found" }, 404);
      } catch (error) {
        return json({ error: error instanceof Error ? error.message : String(error) }, 400);
      }
    },
  });
  return { server, catalog, previews, token, url: `http://127.0.0.1:${server.port}/#${token}` };
}
