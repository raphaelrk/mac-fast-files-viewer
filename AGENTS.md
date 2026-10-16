# Fast Files development

- This is a macOS Apple Silicon Electrobun 2.0.2 app with a Bun main process and native webview. Hutch 0.27.1 prepares the SDK. `scripts/prebuild.ts` builds the webview and Swift ImageIO helper.
- Machine names, workspace paths, and other personal configuration belong only in ignored `.notes/`. Read `.notes/development.md` when present before remote work. The project-scoped Namespace skill is under `.agents/skills/devboxes`.
- Transfer project source and synthetic fixtures for remote checks. Keep personal archives, shortlist files, screenshots supplied by the user, and `.cache` contents local unless the user explicitly authorizes their transfer.
- Do not use skill fallbacks to forward the GitHub token, expire machines, or expose services without task-specific authorization. The existing box can build and test uploaded source without GitHub credentials.
- Preserve bounded text reads, ImageIO downsampling, shared admission control, stale-work cancellation, and byte-counted caches. Describe the 500 MiB budget as an estimate for in-flight work, not a hard total-RSS guarantee.
- Run `bun run check`, `bun run build:helper`, and `bun test` for backend/decoder changes. Run `~/.hutch/bin/hutch electrobun build` for packaging changes. Check UI changes in the native app or browser preview. Avoid downloading or indexing the user's real archive just to create test data.
- Hutch's managed Bun is at `~/.hutch/toolchains/bun/1.4.0/macos-arm64/bun` if no Bun is on PATH. Put its containing directory on PATH for scripts that invoke `bun` themselves.
