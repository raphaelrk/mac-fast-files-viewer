# Fast Files

A macOS file viewer for quickly reviewing large archives of images, text, and code while collecting candidates for a personal projects gallery.

Uses a virtualized list, content thumbnails large enough to skim, and immediate hover previews. The initial desktop target is Electrobun with Bun and the native macOS webview.

## What works

- Index files and folders with names, paths, sizes, modified/created/added dates, and Finder kind descriptions without reading file contents. Start in the current folder; optionally include all subfolders.
- Render only visible rows; prefetch thumbnails for the viewport plus about 50 files in each direction.
- Prefetch larger previews up to 20 files before and 20 after the active item, interleaved with thumbnail downloads.
- Share a bounded, prioritized work queue across thumbnail and preview generation. Skip files over 250 MiB and budget 500 MiB for estimated in-flight image work.
- Downsample JPEG, PNG, and GIF through macOS ImageIO; show bounded UTF-8 excerpts for text and code.
- Support pointer hover, stationary-pointer scrolling, keyboard navigation, filtering, and a shortlist export.
- Save a persistent shortlist and export its paths and metadata as JSON.
- Select one or many items using normal click, ⌘-click, or Shift-click, then drag the originals into other apps. Keep text selection available in previews, metadata, and inputs.
- Navigate folders, open them in Finder, and toggle an immediate, cached Quick Look overlay with Space.

Embeddings, similarity groups, and peripheral-vision experiments are future work.

## Run on macOS (Apple Silicon)

Requires Xcode Command Line Tools, Bun, and Hutch. The project pins Electrobun 2.0.2; Hutch is tested at 0.27.1. Hutch's generated SDK is ignored in Git.

```sh
bun install --frozen-lockfile
~/.hutch/bin/hutch electrobun sync
~/.hutch/bin/hutch run dev
```

The build hook compiles the ImageIO, filesystem metadata, and AppKit drag helpers when needed and bundles the webview. No global Electrobun npm package is required. Hutch manages its paired Bun runtime. The current generated SDK uses a TypeScript configuration supported by the pinned TypeScript 5.9.3.

For a browser-only development session using an existing Bun installation:

```sh
bun run build:helper
bun run dev
```

Open the printed localhost URL and paste an absolute folder path. The native app also provides a macOS folder picker and Reveal in Finder. The localhost listener binds only to `127.0.0.1` and requires a per-session bearer token for file operations.

Use **↑/↓** to browse from the current preview, **S** to toggle shortlist, **⌘O** to open a folder, and **⌘↑** to go to its parent. Double-click a folder or press Enter to enter it. **Include subfolders** switches between the default current-folder listing and a recursive scan.

Hover follows the row under the pointer during scrolling until items are selected. A normal click selects one item, **⌘-click** toggles individual items, and **Shift-click** selects a range. Another normal click collapses a group to one item. Use the preview's **×** or Escape to clear all selection and resume hover. **⌘A** selects the filtered list when it has keyboard focus.

**Space** immediately opens or closes an in-app Quick Look overlay, reusing the cached image or thumbnail while a larger preview loads. Use its arrows to browse; Escape also dismisses it. This overlay uses the app's supported image/text previews rather than macOS Quick Look plugins.

Filter names and relative paths; sort using the header buttons or menu by **name, modified, created, added, size, or kind**. Scroll the list horizontally to see additional metadata columns. Date Added and Kind come from native filesystem resource values; unavailable added dates display **—** and sort last. The toolbar opens the current folder in Finder, and each row's context menu offers **Open in Finder** to reveal that item.

In the desktop app, drag from anywhere on a row to offer the original file or folder through a native macOS file-URL dragging session. Dragging an already-selected row includes the entire selection. It advertises copy/link operations; it does not move or delete source files. This uses a small AppKit bridge loaded into Electrobun. Native file dragging is unavailable in the browser development preview.

Shortlists persist in `~/Library/Application Support/Fast Files/shortlist.json` for the native app, and `.cache/shortlist.json` for browser development. These contain local file paths. Generated fixtures, caches, and user selections are ignored by Git.

## Memory and preview limits

- One weighted queue serves both thumbnail and larger-preview jobs, with at most three simultaneous jobs (fewer on small machines).
- The 500 MiB admission budget estimates each image's source bytes, a worst-case 40 MP bitmap, output/encoding buffers, and helper overhead. This is **not a hard limit on total process RSS**; native codec internals and the webview can allocate additional memory.
- Images above 250 MiB or 40 megapixels are skipped. ImageIO downsamples into at most 240 px thumbnails and 1600 px previews before sending them to the webview. GIFs show the first frame.
- Server encoded assets have a 128 MiB LRU budget; browser decoded assets have a separate 256 MiB LRU budget to retain a larger warm preview window. Browser accounting includes decoded pixel size; eviction releases preload references and blob URLs. The 41-file prefetch window is best effort: unusually large decoded images can be evicted sooner.
- Native decoders run in separate short-lived processes with a 12-second CPU limit and 15-second wall timeout.
- Text reads at most 64 KiB. Binary-looking files get a placeholder. HTML and code render as plain text; they are never executed.
- Metadata indexing streams directories, skips symlinks and `.git`, `node_modules`, `.hutch`, `.cache`, `.notes`, and `.Trash`, and tolerates unreadable entries. Native metadata queries run in batches of at most 512 entries. Indexing is not a live filesystem watch; rescan to refresh changed files.

## Checks

```sh
bun run check
bun run build:helper
bun test
bun run benchmark 20000
~/.hutch/bin/hutch electrobun build
```

The benchmark generates 20,000 small text files under ignored `.cache/benchmark-20000`, then measures basic filesystem indexing, excluding native Date Added/Kind enrichment. It does not represent thumbnail throughput for a real image archive. An earlier local run indexed all 20,000 files in 404 ms with 78 MiB process RSS on the development machine; this is a warm, synthetic measurement, not a universal speed claim.

The test suite covers bounded preview work and caching, image formats, folder scope, native metadata, Finder actions, sorting, selection ranges, and validated multi-file drag requests. Browser UI checks cover selection, folder navigation, the recursive toggle, context menus, and Quick Look. Actual outbound drag gestures require a manual desktop check. Namespace macOS Devbox checks repeat type checking, the tests, and desktop packaging against uploaded source and synthetic fixtures.

## Namespace development

Use a Namespace macOS Devbox for remote builds and checks. Keep its name and workspace path in ignored `.notes/development.md`. Use `~/.local/bin/devbox login` for browser authentication; no API key is needed. The reviewed Namespace skill is installed only in this project's `.agents/skills/devboxes`.

Builds and checks use project source and synthetic test fixtures. Personal archives and shortlist files stay on the local Mac. See [the installer review](docs/tooling-review.md) for the installed versions and installer behavior.

## Private configuration

Keep personal machine names, absolute workspace paths, local test captures, and other private notes in the root `.notes/` folder. It is ignored by Git. Never include it in source-upload archives. Public-facing configuration uses a generic bundle identifier; avoid hardcoding personal information in source or documentation.

## Still ahead

This is an initial working prototype. Real-archive responsiveness and memory profiling, progressive indexing refinements, in-app tuning, animated GIF playback, richer format support, similarity grouping, and direct gallery integration remain future work. Desktop packaging currently produces a local development build, without distribution signing/notarization.
