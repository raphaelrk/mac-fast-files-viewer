# Fast Files

A macOS file viewer for quickly reviewing large archives of images, text, and code while collecting candidates for a personal projects gallery.

Uses a virtualized list, content thumbnails large enough to skim, and immediate hover previews. The initial desktop target is Electrobun with Bun and the native macOS webview.

## What works

- Index names, paths, dates, and sizes without reading file contents.
- Render only visible rows; prefetch thumbnails for the viewport plus about 50 files in each direction.
- Prefetch larger previews up to 20 files before and 20 after the active item, interleaved with thumbnail downloads.
- Share a bounded, prioritized work queue across thumbnail and preview generation. Skip files over 250 MiB and budget 500 MiB for estimated in-flight image work.
- Downsample JPEG, PNG, and GIF through macOS ImageIO; show bounded UTF-8 excerpts for text and code.
- Support pointer hover, stationary-pointer scrolling, keyboard navigation, filtering, and a shortlist export.
- Save a persistent shortlist and export its paths and metadata as JSON.

Embeddings, similarity groups, and peripheral-vision experiments are future work.

## Run on macOS (Apple Silicon)

Requires Xcode Command Line Tools, Bun, and Hutch. The project pins Electrobun 2.0.2; Hutch is tested at 0.27.1. Hutch's generated SDK is ignored in Git.

```sh
bun install --frozen-lockfile
~/.hutch/bin/hutch electrobun sync
~/.hutch/bin/hutch run dev
```

The build hook compiles the small ImageIO helper when needed and bundles the webview. No global Electrobun npm package is required. Hutch manages its paired Bun runtime. The current generated SDK uses a TypeScript configuration supported by the pinned TypeScript 5.9.3.

For a browser-only development session using an existing Bun installation:

```sh
bun run build:helper
bun run dev
```

Open the printed localhost URL and paste an absolute folder path. The native app also provides a macOS folder picker and Reveal in Finder. The localhost listener binds only to `127.0.0.1` and requires a per-session bearer token for file operations.

Use **↑/↓** to browse, **S** to toggle shortlist, and **⌘O** to open a folder. Hover follows the row under the pointer during scrolling. Click a row to keep it selected while moving the pointer; click it again or use the preview's **×** to clear selection and return to hover. **Space** also toggles selection. Filtering searches names and relative paths. Sorting supports name, modified date, and size.

In the desktop app, drag a row into another app to offer the original file through a native macOS file-URL dragging session. It advertises copy/link operations; it does not move or delete source files. This uses a small AppKit bridge loaded into Electrobun. Native file dragging is unavailable in the browser development preview.

Shortlists persist in `~/Library/Application Support/Fast Files/shortlist.json` for the native app, and `.cache/shortlist.json` for browser development. These contain local file paths. Generated fixtures, caches, and user selections are ignored by Git.

## Memory and preview limits

- One weighted queue serves both thumbnail and larger-preview jobs, with at most three simultaneous jobs (fewer on small machines).
- The 500 MiB admission budget estimates each image's source bytes, a worst-case 40 MP bitmap, output/encoding buffers, and helper overhead. This is **not a hard limit on total process RSS**; native codec internals and the webview can allocate additional memory.
- Images above 250 MiB or 40 megapixels are skipped. ImageIO downsamples into at most 240 px thumbnails and 1600 px previews before sending them to the webview. GIFs show the first frame.
- Server encoded assets have a 128 MiB LRU budget; browser decoded assets have a separate 256 MiB LRU budget to retain a larger warm preview window. Browser accounting includes decoded pixel size; eviction releases preload references and blob URLs. The 41-file prefetch window is best effort: unusually large decoded images can be evicted sooner.
- Native decoders run in separate short-lived processes with a 12-second CPU limit and 15-second wall timeout.
- Text reads at most 64 KiB. Binary-looking files get a placeholder. HTML and code render as plain text; they are never executed.
- Metadata indexing streams directories, skips symlinks and `.git`, `node_modules`, `.hutch`, `.cache`, and `.Trash`, and tolerates unreadable entries. Indexing is not a live filesystem watch; rescan to refresh changed files.

## Checks

```sh
bun run check
bun run build:helper
bun test
bun run benchmark 20000
~/.hutch/bin/hutch electrobun build
```

The benchmark generates 20,000 small text files under ignored `.cache/benchmark-20000`, then measures metadata indexing. It does not represent thumbnail throughput for a real image archive. A local run indexed all 20,000 files in 404 ms with 78 MiB process RSS on the development machine; this is a warm, synthetic measurement, not a universal speed claim.

The initial version also passed validation on a Namespace macOS Devbox: desktop build, type checking, seven tests (31 assertions), and a 20,000-file metadata scan in 655 ms with 58 MiB RSS. At a 1500×960 browser viewport, the UI rendered 12 rows for the 20,000-file catalog. The native app was checked with its folder picker, code/text, image previews, and switching folders. JSON download was verified in the browser development preview. The expanded preview window and native drag endpoint add coverage in the current nine-test suite.

## Namespace development

Use a Namespace macOS Devbox for remote builds and checks. Keep its name and workspace path in ignored `.notes/development.md`. Use `~/.local/bin/devbox login` for browser authentication; no API key is needed. The reviewed Namespace skill is installed only in this project's `.agents/skills/devboxes`.

Builds and checks use project source and synthetic test fixtures. Personal archives and shortlist files stay on the local Mac. See [the installer review](docs/tooling-review.md) for the installed versions and installer behavior.

## Private configuration

Keep personal machine names, absolute workspace paths, local test captures, and other private notes in the root `.notes/` folder. It is ignored by Git. Never include it in source-upload archives. Public-facing configuration uses a generic bundle identifier; avoid hardcoding personal information in source or documentation.

## Still ahead

This is an initial working prototype. Real-archive responsiveness and memory profiling, progressive indexing refinements, in-app tuning, animated GIF playback, richer format support, similarity grouping, and direct gallery integration remain future work. Desktop packaging currently produces a local development build, without distribution signing/notarization.
