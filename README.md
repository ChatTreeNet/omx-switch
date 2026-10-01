# OMX Switch

A small Next.js GUI for configuring the models of two OpenCode-ecosystem tools:

- **OMO (Oh My OpenAgent)** — reads/writes `~/.config/opencode/oh-my-openagent.jsonc`
  and lists models via the `opencode models` CLI. Full workspace: per-agent forms,
  categories, and profiles (apply/import/export).
- **OMP (Oh My Pi)** — reads/writes the active global/profile YAML config and lists
  every model kind via `omp models --json --kind all`. Model switching uses the
  `modelRoles` map: chat roles (`default`, `smol`, `slow`, `plan`, `vision`,
  `commit`, `task`, `advisor`, `tiny`, `memory`) and runner roles (`image`, `web`,
  `speech`, `dictation`, `judge`). Configured custom roles remain editable.
  Retry fallback chains (`retry.fallbackChains`, ordered selectors per
  role/model/wildcard) and the `retry.modelFallback` master toggle are editable too.

The page also shows a warning banner when the upstream OMO repository
(`code-yeongyu/oh-my-openagent`) has not been pushed to in over 60 days.

## Run with npx

```bash
npx omx-switch
```

Then open [http://localhost:3457](http://localhost:3457). Press `Ctrl+C` to stop
the server.

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
| OMP | Active agent directory's `config.yml` (existing `config.yaml` is updated in place) | `omp models --json --kind all` |

OMO config uses an `agents` map; OMP config uses a `modelRoles` map. The GUI
edits agent/category fields (OMO) or role assignments (OMP) when you hit **Save**.
Secret-like fields (`apiKey`, tokens, passwords, …) are never accepted by the API
and are stripped from responses.

OMP compatibility is verified against [18.4.8](https://github.com/can1357/oh-my-pi/releases/tag/v18.4.8).
The default agent directory is `~/.omp/agent`. Path resolution follows OMP:

- `OMP_PROFILE=work` selects `~/.omp/profiles/work/agent`; `PI_PROFILE` is used
  only when `OMP_PROFILE` is absent. Empty or `default` selects the default profile.
- `PI_CODING_AGENT_DIR` overrides the default profile's agent directory, but is
  ignored for named profiles. `PI_CONFIG_DIR` overrides the `.omp` root name.
- `config.yml` takes precedence over `config.yaml`; if neither exists, saves
  create `config.yml`. The workspace displays the actual file being edited.
- OMX's saved model profiles are kept in the active agent directory's `profiles/`
  folder. They are separate from OMP's native profiles and `modelPresets`.
- OMX edits the global/profile file only. Project `.omp/config.yml`, CLI
  overlays, or runtime overrides can take precedence in OMP; they are not rewritten.

Launch OMX with the same profile environment as OMP, for example:

```bash
OMP_PROFILE=work npx omx-switch
```

Model choices are filtered by catalog kind; existing unavailable selectors are
preserved. Web accepts search runners and chat candidates; OMP's JSON catalog
does not expose the chat model's web-search capability, so select a chat model
with provider-side search support. Runner roles do not receive thinking suffixes.
Switching chat models clears a thinking override unsupported by the new model.
Other config settings, including native presets, are preserved on save.

See upstream [settings](https://github.com/can1357/oh-my-pi/blob/v18.4.8/docs/settings.md)
and [model roles](https://github.com/can1357/oh-my-pi/blob/v18.4.8/packages/coding-agent/src/config/model-roles.ts).
