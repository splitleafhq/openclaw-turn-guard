# Contributing

Node 24.16 or later. `package.json` pins the dev tools. Checks:

```sh
npm ci --ignore-scripts
npm run lint
npm run typecheck
npm test
npm run build
```

A pre-push gate runs these checks before each push: `lefthook install` turns it on (`lefthook.yml`).

Commit `dist/` with any change to `src/`; CI fails when it doesn't match a fresh build.

`npm test` fails below 90% line or function, or 85% branch, coverage of `src/`. Run the checks in a separate clone, or delete `node_modules/` from a checkout used as a linked install: OpenClaw's loader maps `openclaw/plugin-sdk/*` to the gateway's own install.
