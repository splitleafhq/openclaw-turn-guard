# AGENTS.md

Rules for working in this repo.

1. Fail open: `publish_brief` returns an error result and never throws.
2. `publish_brief` takes no path from the caller. The file name is built in code, created through OpenClaw's `root().create` (exclusive, atomic), and written only under `briefsDir`.
3. Hard-code no model name or context size. Agent ids appear only as documented config defaults.
4. Follow OpenClaw's own conventions for names and locations (camelCase keys with unit suffixes, the state directory OpenClaw resolves); where none exists, leave the setting unset rather than invent a default.
5. Keep everything setup-agnostic: no usernames, hostnames, paths, room or chat ids, persona names or research topics from any real setup, in code, tests, docs, commits, issues or pull requests. Say "the assistant" and "the reader agent".
6. Build fixtures from synthetic content; test names and characters come from R.A. Salvatore's books.
7. Ship a fix with a test you have watched fail without it.
8. Name a test for the failure it prevents.
9. Cite the OpenClaw version, and a docs page or source file, for any claim about OpenClaw behaviour, and label anything not yet checked on a live gateway as unverified in `docs/verification.md`.
10. Pin every tool and action to an exact version or commit.
11. Keep runtime dependencies to `typebox`, pinned to the version OpenClaw's plugin docs show; otherwise import only `node:` built-ins and `openclaw/plugin-sdk/*`. Use OpenClaw's helper where one exists.
12. A comment states a constraint the code can't show, never what the next line does.
13. Write terse, factual prose.
14. Commit, push and open pull requests on the user's behalf; creating a GitHub repo, merging, tagging, releasing and installing each need their own approval.
15. Keep agent-session links and session trailers out of commit messages, issues and pull request bodies.
