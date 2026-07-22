# OMX Switch

A small Next.js GUI for configuring the models of two OpenCode-ecosystem tools:

- **OMO (Oh My OpenAgent)** — reads/writes `~/.config/opencode/oh-my-openagent.jsonc`
  and lists models via the `opencode models` CLI. Full workspace: per-agent forms,
  categories, and profiles (apply/import/export).
- **OMP (Oh My Pi)** — reads/writes `~/.omp/agent/config.yml` (YAML) and lists models
  via the `omp models --json` CLI. Model switching is role-based: the `modelRoles`
  map (`default`, `smol`, `slow`, `plan`, `vision`, `designer`, `commit`, `task`,
  `advisor`, `tiny`, plus custom roles). Retry fallback chains
  (`retry.fallbackChains`, ordered selectors per role/model/wildcard) and the
  `retry.modelFallback` master toggle are editable too.

The page also shows a warning banner when the upstream OMO repository
(`code-yeongyu/oh-my-openagent`) has not been pushed to in over 60 days.

## Develop

```bash
npm install
npm run dev        # http://localhost:3457
```

## Build & run

```bash
npm run build
npm start          # serves on port 3457
```

## Tests & lint

```bash
npm run lint
npm run test:run
```

## Config paths

| Target | Config file | Models command |
| ------ | ----------- | -------------- |
| OMO | `~/.config/opencode/oh-my-openagent.jsonc` | `opencode models` |
| OMP | `~/.omp/agent/config.yml` | `omp models --json` |

OMO config uses an `agents` map; OMP config uses a `modelRoles` map. The GUI
edits agent/category fields (OMO) or role assignments (OMP) when you hit **Save**.
Secret-like fields (`apiKey`, tokens, passwords, …) are never accepted by the API
and are stripped from responses.
