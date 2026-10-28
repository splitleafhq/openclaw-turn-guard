# openclaw-turn-guard

An [OpenClaw](https://docs.openclaw.ai) plugin (id `turn-guard`) with one tool for a research agent: **`publish_brief`** saves a finished brief to a host folder and returns the path the reader sees.

**Status:** built and unit-tested against OpenClaw 2026.10.5. Not installed anywhere, not published. What a live gateway still has to confirm is in [docs/verification.md](docs/verification.md).

## What it does

### 1. `publish_brief({ topic, text })`

Runs in the gateway process and writes `text` to `<briefsDir>/<YYYY-MM-DD>-<HHMMSS>-<6 hex>-<slug>.md` (UTC, mode 0644, folder created 0755). The file is created through OpenClaw's `root().create` (exclusive, atomic), so nothing is overwritten and a symlink at the name is refused. The slug is the topic lowercased to `[a-z0-9-]`, at most 40 characters, `brief` if nothing is left. The caller never supplies a path.

- Empty text, or text over `maxBriefChars` (60,000), returns an error result.
- A write failure returns an error result with a short message, not a throw.
- The result text is `publishedPathPrefix/<file name>`, the path as the consumer (for example a sandboxed reader) sees the folder. Without the prefix it is the host path.
- Only agents in `publishAgents` (default `["research"]`) get the tool: the factory returns `null` for the rest.

Docs relied on: tool registration and the matching `contracts.tools` entry, `docs/plugins/building-plugins.md` (Register tools); a factory may return `null`, same section.

## Install

Pinned to a tag or commit of a clone, with the gateway owner's approval:

```sh
openclaw plugins install git:file:///path/to/openclaw-turn-guard@<tag or commit> --force --accept-capabilities
openclaw plugins inspect turn-guard --runtime --json
```

OpenClaw loads the committed `dist/` through `openclaw.runtimeExtensions`, from a git install, a copy, a load path or `--link` alike (`docs/plugins/sdk-entrypoints/package-entries.md:36-38`, 2026.10.8), checked on 2026.10.8: an install runs npm without scripts, so nothing is built then, and a change to `src/` runs only after `npm run build`. `--force` confirms a source that isn't on ClawHub, and `--accept-capabilities` the `publish_brief` tool (`cli/plugins/install.md`).

Or from a checkout. The shape of the config change:

```json5
{
  plugins: {
    load: { paths: ["/path/to/openclaw-turn-guard"] },
    allow: ["turn-guard"],
    entries: {
      "turn-guard": {
        enabled: true,
        config: {
          briefsDir: "/host/path/to/briefs",
          publishedPathPrefix: "/path/the/reader/sees/briefs"
        }
      }
    }
  },
  agents: {
    entries: {
      research: {
        tools: {
          allow: ["...existing entries", "publish_brief"],
          sandbox: { tools: { allow: ["...existing entries", "publish_brief"] } }
        }
      }
    }
  }
}
```

Plugin tools are opt-in through `tools.allow` (`docs/plugins/building-plugins.md`). A sandboxed agent has a second allow gate, `tools.sandbox.tools`, which the sandbox page documents for MCP tools and says `group:plugins` covers plugin-owned tools (`docs/gateway/sandbox-vs-tool-policy-vs-elevated.md`); that a plugin tool needs the entry is unverified. Keys are `agents.entries.<id>.tools.allow` and `agents.entries.<id>.tools.sandbox.tools.allow` (same page, line 69 and the tool-policy list); the global `tools.sandbox.tools.allow` also works. Add `publish_brief` to the agent's existing lists rather than replacing them.

## Configuration

See [docs/configuration.md](docs/configuration.md).

## Development

```sh
npm ci --ignore-scripts
npm run lint
npm run typecheck
npm test
npm run build
```

Commit `dist/` with any change to `src/`; CI fails when it doesn't match a fresh build.

[docs/how-it-works.md](docs/how-it-works.md), [docs/verification.md](docs/verification.md), [docs/CHANGELOG.md](docs/CHANGELOG.md).
