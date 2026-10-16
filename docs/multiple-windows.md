# Multiple windows and tabs: design assessment

This is a plan, not an implemented feature. Multiple windows are a moderate refactor; tabs add view lifecycle and UI work. Electrobun already exposes [BrowserWindow and BrowserView](https://framework.blackboard.sh/electrobun/apis/browser-view/), so no framework switch is necessary. Native Finder-style window tabbing would need a separate AppKit investigation; app-managed tabs can use independent webviews.

## State isolation comes first

Each window or tab needs its own catalog, scan generation, preview-window revision, navigation state, filters, selection/hover, virtualized rows, decoded image cache, and layout preferences. The browser module state is naturally separate in independent webviews, but the current server has one catalog and one preview window: opening another view against that same session would replace the first view's folder and cancel its work.

Introduce explicit view sessions with their own tokens and catalog ownership. Route requests to the correct session and dispose of it when its view closes. Keep column order and other live view preferences separate; only share defaults when that is intentional. Associate native drag requests with the originating window and mouse gesture, rather than relying on a common window title.

The shortlist can intentionally be shared. Its current whole-list replacement API would lose concurrent edits, so shared shortlist operations should become add/remove mutations owned by the main process, with updates sent to all views.

## Memory: share expensive work, keep view caches bounded

Independent budgets would be a reasonable first prototype with a small number of windows, but memory use grows with every view. Each currently has an estimated 500 MiB decoder admission budget, a 128 MiB encoded cache, and a 256 MiB decoded cache, plus webview, catalog, and native allocations. These are not total-RSS limits.

A shared decoder budget is manageable because a weighted work queue already exists. Inject one scheduler into the per-view preview services, tag jobs with their owner, and cancel only that owner's stale work. The current `cancelQueued(keep)` cannot be used unchanged: one view would cancel another's jobs. Active previews should outrank speculative work; hidden tabs should suspend prefetching, and background windows should not starve indefinitely.

Keep the shared decoder estimate configurable—perhaps modestly above the current single-view budget after profiling—rather than multiplying it by the window count. A shared encoded cache can deduplicate assets by validated file identity, modification time, and preview size. Per-webview decoded caches still need limits; an app-wide scheduler alone cannot cap their combined RSS. A later coordinator can distribute smaller cache allowances to background views.

## Suggested sequence

1. Isolated view sessions and two independent windows; shared decoder scheduler and authoritative shortlist store.
2. Cleanup, owner-aware cancellation, window-specific native dragging, and foreground/background priorities.
3. App-managed tabs using the same session abstraction; suspend hidden tab prefetching.
4. Profile real archives before tuning global and per-view cache allowances.

Verify simultaneous scans in different folders, independent selection and layouts, concurrent shortlist edits, closing a view during decoding, shared-file cache hits, and correct native dragging from each window. Cmd-W should close a window/tab; Cmd-Q should quit the application.
