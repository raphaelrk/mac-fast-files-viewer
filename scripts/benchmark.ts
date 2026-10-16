import { mkdir, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { Catalog } from "../src/server/catalog";

// Reproducible metadata benchmark. All generated files stay in ignored .cache.
const count = Number(process.argv[2] || 20000);
if (!Number.isInteger(count) || count < 1 || count > 100000) throw new Error("Choose 1–100000 files");
const root = resolve(`.cache/benchmark-${count}`);
await mkdir(root, { recursive: true });
for (let offset = 0; offset < count; offset += 64) {
  await Promise.all(Array.from({ length: Math.min(64, count - offset) }, (_, i) => {
    const index = offset + i;
    return writeFile(join(root, `project-${String(index).padStart(6, "0")}.ts`), `// Archived project ${index}\nexport const idea = "Build something worth remembering";\n`);
  }));
}
const catalog = new Catalog(), started = performance.now();
await catalog.scan(root, true);
while (!catalog.status.done) await new Promise(resolve => setTimeout(resolve, 10));
console.log(JSON.stringify({ root, count: catalog.files.length, skipped: catalog.status.skipped, scanMs: Math.round(performance.now() - started), rssMiB: Math.round(process.memoryUsage().rss / 1024 ** 2) }));
