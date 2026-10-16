# Tooling review — October 16, 2026

Reviewed official scripts as data before execution; installed only after explicit approval.

| Component | Installed pin | Observed behavior |
| --- | --- | --- |
| Hutch | 0.27.1 | Downloads a platform release over HTTPS, validates SHA-256 and size, stages it, invokes the downloaded bootstrap engine, then installs a launcher under `~/.hutch/bin`. Versioned releases and toolchains live under `~/.hutch`. Installed with `--no-modify-path`; no shell-profile edits requested. |
| Electrobun | 2.0.2 | Project pin in `hutch.config.ts`; Hutch sync prepares the SDK under ignored `.hutch/devkit` and downloads paired runtime/toolchain assets. Uses the native macOS webview and Bun main process. |
| Namespace Devbox CLI | 0.0.204 | Official script downloads the platform archive and checks SHA-256, then runs the downloaded `devbox install` binary. Installed at `~/.local/bin/devbox`. The shell script does not expose all behavior of that binary. No sudo appears in the reviewed shell scripts. |
| Namespace skill | project only | Installed from `namespacelabs/agent-skills`, `skills/devboxes`, into `.agents/skills/devboxes`, using the built-in skill installer rather than an additional `npx skills` executable. Includes remote execution/upload/lifecycle guidance. |

Both shell installers look appropriate for normal developer use, provided the vendor binaries are trusted. Checksums are supplied by the vendors themselves; they detect mismatches but are not an independent audit or guarantee. Archive extraction and execution of downloaded native binaries are part of the trust boundary. This was a shell-script review, not a binary security audit.

The Namespace skill includes fallbacks for provisioning/expiring machines, exposing services, changing SSH configuration, and forwarding a GitHub token. Those are broader than the actions needed for this project. We reuse the user's existing macOS box, authenticate via `devbox login`, and upload only project source. We do not need to forward the local GitHub token or upload personal file collections.

## Reviewed script SHA-256 values

```text
Hutch install.sh:
9803e467afab4d795ebf506abbe94c3592b761188bd68b1b5edf02ad7955b92c

Namespace devbox install.sh:
4e91941018f5ba06a32c73be178981d321131263de4e9306cf2f2e0ca8dfb496

Namespace devboxes SKILL.md:
ea0c0bbae153ab520ed07bf9884ee77408073a68788ed6606feea7d847130f55
```

## Primary references

- [Electrobun quick start](https://framework.blackboard.sh/electrobun/guides/quick-start/)
- [Electrobun Bun main-process guide](https://framework.blackboard.sh/electrobun/guides/hello-world-bun/)
- [Hutch installer](https://hutch.blackboard.sh/hutch/install.sh)
- [Namespace Devboxes](https://namespace.so/docs/devbox)
- [Namespace installer](https://get.namespace.so/devbox/install.sh)
- [Namespace CLI installation](https://namespace.so/docs/reference/devbox-cli/installation)
- [Namespace skill source](https://github.com/namespacelabs/agent-skills/tree/main/skills/devboxes)
