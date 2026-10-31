# Verification

## Checked

- **Unit tests** (`npm test`, synthetic data, temp folders, no network) cover:
  - two briefs on one topic in one second; a name collision; a symlink at the chosen name; no temporary file left behind; a 10,000-character round trip; an unwritable folder; a path-like topic; empty and oversized text; the path prefix; agent gating; a relative or `~` `briefsDir`;
- **Typecheck** against the OpenClaw 2026.10.5 plugin SDK; lint with oxlint.
- The tests call the handlers through a stand-in for the plugin API. They do not run OpenClaw's plugin loader or a gateway.
- **Copy install in OpenClaw 2026.10.8:** in an isolated state directory (`OPENCLAW_STATE_DIR`, `OPENCLAW_CONFIG_PATH`), `plugins install <checkout> --force --accept-capabilities`, a `briefsDir`, then `plugins inspect turn-guard --runtime --json` reports `status: loaded` from `dist/index.js` with `toolNames: [publish_brief]`. Before `dist/` was committed, the same install failed: "requires compiled runtime output for TypeScript entry ./src/index.ts".

## Checked by reading OpenClaw 2026.10.5's code, not run

An adversarial review read the installed `dist/` (2026-10-24). Not run on a gateway.

1. **Plugin tools run in the gateway process.** `docs/plugins/architecture.md` says native plugins run in-process; the sandbox feeds only the file and exec bridges, and no path sends a plugin tool's `execute` into the container. So the brief lands in the host `briefsDir`. The "no container path" part is from absence.
2. **The sandbox gate needs the tool by name.** An explicit `tools.sandbox.tools.allow` replaces the default list, which names neither `publish_brief` nor the web tools. `optional: true` means the tool loads only when an allow list names it, its plugin id or `group:plugins`.

## Unverified

1. **How the manifest's `required: ["briefsDir"]` failure surfaces.**
2. **Time zone of the file name.** UTC by choice.
3. **No `turn-guard failed during register` line on a live gateway** after installing this fix.
4. **Whether OpenClaw expands `~` in plugin config before `register`.** Not checked. In OpenClaw 2026.10.5, `api.resolvePath` (`docs/plugins/sdk-runtime.md`) expands `~` only when a plugin calls it, and resolves a relative path against the plugin root, not a data folder. If it does not, a `~/...` `briefsDir` is refused as relative.
