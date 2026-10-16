import type { FileEntry } from "../shared/types";

export async function enrichMetadata(files: FileEntry[], helper?: string) {
  if (!helper || !files.length || !await Bun.file(helper).exists()) return;
  const process = Bun.spawn([helper], { stdin: "pipe", stdout: "pipe", stderr: "ignore" });
  process.stdin.write(JSON.stringify(files.map(file => file.path)));
  process.stdin.end();
  const timeout = setTimeout(() => process.kill(), 10_000);
  try {
    const [output, code] = await Promise.all([new Response(process.stdout).text(), process.exited]);
    if (code !== 0) return;
    const values = JSON.parse(output) as { added: number | null; kindLabel: string | null }[];
    files.forEach((file, i) => {
      if (Number.isFinite(values[i]?.added)) file.added = values[i].added;
      if (values[i]?.kindLabel) file.kindLabel = values[i].kindLabel!;
    });
  } catch { /* Metadata unavailable on this volume: retain honest empty dates. */ }
  finally { clearTimeout(timeout); }
}
