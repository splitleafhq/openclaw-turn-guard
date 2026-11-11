# Verification

## Checked

- **Unit tests** (`npm test`, synthetic data, temp folders, no network) cover:
  - two briefs on one topic in one second; a name collision; a symlink at the chosen name; no temporary file left behind; a 10,000-character round trip; an unwritable folder, reported by its OS error code (skipped as root, which ignores directory permissions); a path-like topic; empty and oversized text; the path prefix; agent gating, including `publishAgents` ids with spaces or capitals; a relative or `~` `briefsDir`;
- **Typecheck** against the OpenClaw 2026.10.5 plugin SDK; lint with oxlint.
- The tests call the handlers through a stand-in for the plugin API. They do not run OpenClaw's plugin loader or a gateway.
- **Copy install in OpenClaw 2026.10.8:** in an isolated state directory (`OPENCLAW_STATE_DIR`, `OPENCLAW_CONFIG_PATH`), `plugins install <checkout> --force --accept-capabilities`, a `briefsDir`, then `plugins inspect turn-guard --runtime --json` reports `status: loaded` from `dist/index.js` with `toolNames: [publish_brief]`. Before `dist/` was committed, the same install failed: "requires compiled runtime output for TypeScript entry ./src/index.ts".

- **Queue unit tests** cover: a second and third turn waiting and running in order; unlisted agents, non-agent keys and a follow-up in the running session passing through; the busy reply at `maxWaitMs` and at a full line; a redelivered message keeping one place; the slot freeing itself at `maxHoldMs`; an end from a session that does not hold the slot; the rest, with a fake clock; config fallbacks.
- **Queue on a live gateway, OpenClaw 2026.11.2, Discord (2026-11-10), with a throwaway plugin holding the same queue logic:** two mentions eight seconds apart for one agent, each its own thread and session. The first started at once (24.9 s run); the second waited 20.0 s, started when the first ended (21.1 s run). `agent_end` freed the slot both times, so its `ctx.sessionKey` matched the key seen in `before_dispatch`. No stalled-claim or stuck-session log lines for either.
- **A hold longer than OpenClaw allows, same gateway and day:** one message held 360 s in `reply_dispatch` after `turnAdoption.adopt()`. No "claim→adoption stalled" line, but stuck-session recovery aborted it at 370 s ("stopped making progress"). This is why the queue holds in `before_dispatch` and stops at `maxWaitMs`.

## Checked by reading OpenClaw 2026.10.5's code, not run

An adversarial review read the installed `dist/` (2026-10-24). Not run on a gateway.

1. **Plugin tools run in the gateway process.** `docs/plugins/architecture.md` says native plugins run in-process; the sandbox feeds only the file and exec bridges, and no path sends a plugin tool's `execute` into the container. So the brief lands in the host `briefsDir`. The "no container path" part is from absence.
2. **The sandbox gate needs the tool by name.** An explicit `tools.sandbox.tools.allow` replaces the default list, which names neither `publish_brief` nor the web tools. `optional: true` means the tool loads only when an allow list names it, its plugin id or `group:plugins`.
3. **Agent-id normalization.** `normalizeAgentIdStrict`, exported from `openclaw/plugin-sdk/routing` (`dist/plugin-sdk/routing.js`, `dist/agent-id-D1-Q6vR4.mjs`), trims, lowercases, replaces runs of characters outside `[a-z0-9_-]` with `-`, strips leading and trailing dashes, cuts to 64 characters, and fails when nothing is left. Read 2026-10-30.

## Unverified

1. **How the manifest's `required: ["briefsDir"]` failure surfaces.**
2. **Time zone of the file name.** UTC by choice.
3. **`ctx.agentId` reaches the tool factory already normalized.** The plugin normalizes it again, so matching does not depend on it.
4. **No `turn-guard failed during register` line on a live gateway** after installing this fix.
5. **Whether OpenClaw expands `~` in plugin config before `register`.** Not checked. In OpenClaw 2026.10.5, `api.resolvePath` (`docs/plugins/sdk-runtime.md`) expands `~` only when a plugin calls it, and resolves a relative path against the plugin root, not a data folder. If it does not, a `~/...` `briefsDir` is refused as relative.
6. **ENOSPC and EROFS reach the result by their code.** `@openclaw/fs-safe` 0.25.0 (OpenClaw 2026.10.5's dependency), `docs/errors.md` and `dist/root-errors.js`, wraps them as `invalid-path` with the OS error in `cause`; only EACCES is tested. A disk-space failure combined with a cleanup failure has a `SuppressedError` as its `cause` and is still reported as `invalid-path`.
7. **The queue's busy reply on a live gateway.** `{ handled: true, text }` from `before_dispatch` is sent as a final reply in OpenClaw 2026.11.2's `dist/dispatch-from-config-*.mjs` (read 2026-11-10); not yet seen in a chat.
8. **The queue built from this repository on a live gateway.** The live checks above ran the same logic from a throwaway plugin, not this package's `dist/`.
9. **A second message in one channel while the first is held.** Discord's ingress lane is per channel and stays occupied until adoption (read in the Discord plugin 2026.11.2, `message-handler-*.mjs`), so it likely waits in ingress before it reaches the hook. In the live check the first message was not held, so this path did not run.
10. **Whether `agent_end` fires once per run or once per model attempt.** If per attempt, a retried turn frees the slot early.
11. **A plugin reload with turns waiting.** Expected: the held hooks never return and OpenClaw's 300 s watchdog redelivers the messages. Not run.
