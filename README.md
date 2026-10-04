# opencode-release-on-quit

[![npm version](https://img.shields.io/npm/v/opencode-release-on-quit)](https://www.npmjs.com/package/opencode-release-on-quit)
[![CI](https://github.com/angeloper86/opencode-release-on-quit/actions/workflows/ci.yml/badge.svg)](https://github.com/angeloper86/opencode-release-on-quit/actions/workflows/ci.yml)
[![license](https://img.shields.io/github/license/angeloper86/opencode-release-on-quit)](LICENSE)

An OpenCode **TUI plugin** that shuts down what a project keeps running after you leave: when you quit a window it releases that project's cached services (MCP, LSP), and when the last OpenCode client exits it sweeps every loaded location — so no MCP processes stay alive overnight.

> **Community plugin.** Not built by, endorsed by, or affiliated with the OpenCode team.

## Why

OpenCode v2 keeps per-project MCP servers and LSPs warm inside its shared background service. Closing a session with `/exit` only closes the client: the project's cached services are not released at that point — they wait for an inactivity timer (the location layer currently uses a 60-minute idle TTL) or for a capacity/dispose mechanism, regardless of whether any client still has that project open. Over a day of opening several projects this can add up to gigabytes of processes you are no longer using.

This plugin makes `/exit` mean what you thought it meant: the project you leave is released once its client is gone, and when the last client exits nothing stays behind.

## How it works

1. When a TUI exits, the plugin spawns a small detached helper (`evict-deferred.mjs`).
2. The helper waits until the TUI process is really gone — a dying client's last data syncs can undo an immediate release.
3. It then disposes the cached services of that window's project via the server's location eviction API.
4. If **no other OpenCode client is running**, it sweeps every loaded location.

Locations with a turn executing are never touched. Everything boots lazily again the next time you use it.

## Requirements

- OpenCode `>= 2.0.0`
- macOS or Linux (the helper uses `ps` to detect the last client)
- Node.js available in `PATH` (the deferred helper runs on it)

## Install

Add it to your CLI configuration (`~/.config/opencode/cli.json`):

```json
{
  "plugins": ["opencode-release-on-quit"]
}
```

Or from the CLI:

```sh
opencode plugin add opencode-release-on-quit
```

## Activity log

The helper appends a small log to `~/.local/share/opencode/release-on-quit.log`:

```text
2026-10-02T23:27:26.136Z start ppid=1 dirs=1
2026-10-02T23:27:26.204Z parent already gone at start
2026-10-02T23:27:27.800Z no other clients; sweeping all loaded locations
2026-10-02T23:27:27.900Z evicted: /Users/me/projects/app
2026-10-02T23:27:27.901Z done
```

## Compatibility

- Uses the server's experimental `debug.location.evict` endpoint. If a future OpenCode release removes or changes it, the helper logs the failure and nothing else happens — it fails soft. Known quirks of that endpoint are tracked upstream (for example, [anomalyco/opencode#51198](https://github.com/anomalyco/opencode/issues/51198)).
- While other OpenCode clients stay open, a released location can be revived on demand by them. That is expected: the plugin never fights a live client.

## Upstream

The permanent fix belongs in the service, not in a client plugin:

- [anomalyco/opencode#53068](https://github.com/anomalyco/opencode/issues/53068) — feature request to release a project's cached services when its last client exits. This plugin is cited there as prior art; if it helps you, your experience in that thread is useful evidence.
- [anomalyco/opencode#52946](https://github.com/anomalyco/opencode/issues/52946) — in-flight core work that caps the per-directory MCP instance cache (LRU).

## Development

The package ships TypeScript source (`src/`); OpenCode's plugin runtime loads it directly.

```sh
npm install
npm run typecheck
npm run check:helper
```

To test locally through the plugin discovery directory, create a bridge at `~/.config/opencode/plugins/release-on-quit/tui.ts`:

```ts
export { default } from "/absolute/path/to/opencode-release-on-quit/src/tui.ts"
```

Remove the bridge before switching to the published package, so the plugin does not load twice.

## License

MIT
