# Fast Files

A macOS file viewer for quickly reviewing large archives of images, text, and code while collecting candidates for a personal projects gallery.

Inspired by a fast hover-based catalog browser: a virtualized list, content thumbnails large enough to skim, and immediate hover previews. The initial desktop target is Electrobun with Bun and the native macOS webview.

## Initial direction

- Index names, paths, dates, and sizes without reading file contents.
- Render only visible rows; prefetch thumbnails for the viewport plus about 50 files in each direction.
- Prefetch larger previews a few files around the active item.
- Share a bounded, prioritized work queue across thumbnail and preview generation. Skip files over 250 MiB and budget 500 MiB for estimated in-flight image work.
- Downsample JPEG, PNG, and GIF through macOS ImageIO; show bounded UTF-8 excerpts for text and code.
- Support pointer hover, stationary-pointer scrolling, keyboard navigation, filtering, and a shortlist export.
- Use an existing Namespace macOS Devbox for remote builds and checks once authenticated.

Embeddings, similarity groups, and peripheral-vision experiments are future work.

## Status

Initial implementation in progress. Tool installers are being reviewed before installation; no archive files are copied to GitHub or Namespace.
