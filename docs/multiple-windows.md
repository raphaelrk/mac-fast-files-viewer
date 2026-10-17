# Multiple windows

Each native window owns a separate loopback server and random session token, catalog, scan generation, prefetch revision, browser state, and bounded caches. Opening, rescanning, filtering, or selecting in one window does not change another window. New windows start with no folder open. Column preferences remain local to that window’s session.

**⌘N** and the **New window** button create a window. **⌘W** closes the focused window. Closing the last window keeps the application menu available; **⌘N** or clicking the Dock icon opens another. **⌘Q** quits the app. Edit commands are native menu accelerators, including **⌘C** for selected path-bar text. About and Select All target the focused window.

All windows share one weighted decoder scheduler: 500 MiB estimated in-flight work and at most three jobs. Jobs carry a window owner, so scrolling or closing one window cancels only its own queued work. Closing a window stops its server, invalidates scans, clears its encoded cache, and terminates its active image helpers. Source images above 250 MiB or 40 megapixels remain excluded.

The scheduler is not a hard total-RSS limit. Each window additionally has a 128 MiB encoded cache and a 256 MiB decoded cache, plus its catalog, webview, and native allocations. Overall memory therefore still increases with the number of windows. Shared encoded assets and adaptive per-window cache allowances could be added after profiling.

One main-process shortlist store serializes add/remove operations and atomic disk writes. Other windows poll its revision every two seconds. Full-snapshot replacement is disabled for shared native sessions. The shortlist is intentionally shared; selections are not.

Native file drags are tied to the originating window’s unique title and current mouse gesture. A delayed request from another window or an earlier gesture cannot arm a later drag.

Tabs are deferred. They can reuse this session ownership model, with additional tab UI, lifecycle management, and suspended prefetch for hidden tabs. Native Finder-style window tabbing would need a separate AppKit investigation.

Integration tests cover independent catalogs and authentication, revision isolation, cross-window drag rejection, owner-specific cancellation, window disposal, concurrent shortlist additions/removals, and persistence after reopening.
