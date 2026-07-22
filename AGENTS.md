# PROJECT KNOWLEDGE BASE

## OVERVIEW
OMX Switch is a small Next.js App Router GUI for configuring the models of two
OpenCode-ecosystem tools.

- **OMO (Oh My OpenAgent)** — config at `~/.config/opencode/oh-my-openagent.jsonc`,
  models from the `opencode models` CLI. Full workspace: per-agent forms,
  categories, and profiles (apply/import/export).
- **OMP (Oh My Pi)** — config at `~/.omp/agent/config.yml` (YAML), models from the
  `omp models --json` CLI. Model switching is role-based (`modelRoles` map:
  default, smol, slow, plan, vision, designer, commit, task, advisor, tiny).

The page also warns when the upstream OMO repository
(`code-yeongyu/oh-my-openagent`) has not been pushed to in over 60 days.
Session monitoring, kanban board, and host management were removed; this
repository is no longer a library — only the app and its CLI launcher remain.

## STRUCTURE
```text
omx-switch/
├── src/app/                 # page shell + API routes
│   └── api/                 # omo-config, omp-config, omo-models, omp-models, omo-sync
├── src/components/          # config workspace, ModelSelector, SyncStatus
├── src/lib/                 # omoConfig, ompConfig, configValidation, cliModels
├── src/types/               # omoConfig.ts config contracts
├── bin/vibepulse.js         # CLI entry: standalone server -> next start fallback
├── bin/dev-runtime.js       # dev launcher: next dev on port 3457
└── .github/workflows/       # CI and release automation
```

## WHERE TO LOOK
| Task | Location | Notes |
|---|---|---|
| Page shell | `src/app/page.tsx` | OMO/OMP target tabs + SyncStatus + ConfigWorkspace |
| Config workspace | `src/components/config/ConfigWorkspace.tsx` | agents sidebar + form, categories, profiles tabs |
| Model dropdown | `src/components/ModelSelector.tsx` | Radix select grouped by provider; swallows spurious `onValueChange('')` |
| OMO config IO | `src/lib/omoConfig.ts` | read/write/merge + legacy migration |
| OMP config IO | `src/lib/ompConfig.ts` | `~/.omp/agent/config.yml` (YAML), modelRoles |
| Shared validation | `src/lib/configValidation.ts` | secret filtering + field validators |
| CLI model listing | `src/lib/cliModels.ts` | exec plumbing, timeout env vars, parse hooks |
| Upstream sync check | `src/app/api/omo-sync/route.ts` | GitHub pushed_at vs 60-day threshold |

## CONVENTIONS
- Runtime port is pinned to `3457` for `dev` and `start` scripts.
- Tests are co-located with source (`*.test.ts`, `*.test.tsx`).
- Path alias `@/*` maps to `src/*` in both TypeScript and Vitest.
- OMO and OMP API routes are mirrors; shared logic lives in `src/lib/configValidation.ts` and `src/lib/cliModels.ts`.
- `omp models` is consumed via `omp models --json` (`selector` field); `opencode models` uses the plain line filter.

## ANTI-PATTERNS (THIS PROJECT)
- Do not send secret-like keys (`api*`, `*token*`, `*secret*`, `*password*`, etc.) to `/api/omo-config` or `/api/omp-config`; requests are rejected with 403.
- Do not add unsupported agent/category fields in config update payloads; validators enforce per-field rules.
- Do not reintroduce session monitoring, kanban, or host-management features. Profiles are OMO-only.
- Do not parse the human `omp models` table output; use `--json`.

## COMMANDS
```bash
npm run dev
npm run lint
npm run test
npm run test:run
npm run build
```

## SCOPED GUIDES
- `src/AGENTS.md`
- `src/app/api/AGENTS.md`
- `src/components/AGENTS.md`

## NOTES
- CI pipeline: lint -> test:run -> build on pushes/PRs to `main` and `master`.
- Release pipeline is tag-driven (`v*.*.*` and prerelease variants) with npm provenance publish.
