# SOURCE KNOWLEDGE BASE

**Scope:** `src/`

## OVERVIEW
`src/` contains the OMX Switch runtime: a single-page Next.js App Router GUI that
switches the `default` agent model for OMO (Oh My OpenAgent) and OMP (Oh My Pi),
plus the API routes that read/write their config files and list CLI models.

## STRUCTURE
```text
src/
├── app/                 # page/layout + API routes
├── components/          # config workspace, ModelSelector, SyncStatus, QueryProvider
├── lib/                 # config file IO (omoConfig/ompConfig), validation, CLI models, profiles
├── test/                # test bootstrap (`setup.ts`)
├── types/               # config domain contracts (omoConfig.ts)
└── index.ts             # empty; no library surface
```

## WHERE TO LOOK
| Task | Location | Notes |
|------|----------|-------|
| Page shell | `src/app/page.tsx` | OMO/OMP target tabs + SyncStatus + ConfigWorkspace |
| Config workspace | `src/components/config/ConfigWorkspace.tsx` | agents sidebar + form, categories, profiles tabs |
| Model dropdown | `src/components/ModelSelector.tsx` | Radix select, provider grouping, search |
| OMO config IO | `src/lib/omoConfig.ts` | `~/.config/opencode/oh-my-openagent.jsonc` |
| OMP config IO | `src/lib/ompConfig.ts` | `~/.omp/agent/config.yml` (YAML) |
| Shared field validation | `src/lib/configValidation.ts` | secret filtering + agent/category validators |
| CLI model listing | `src/lib/cliModels.ts` | exec plumbing for `opencode models` / `omp models --json` |

## CONVENTIONS
- Keep Next.js route handlers under `src/app/api/**/route.ts`; avoid ad-hoc API helper entrypoints.
- Keep tests co-located (`*.test.ts`, `*.test.tsx`); shared test runtime setup stays in `src/test/setup.ts`.
- Keep cross-module imports on the `@/` alias.
- Keep config persistence logic in `src/lib/omoConfig.ts` / `src/lib/ompConfig.ts`, not in UI components.
- OMO and OMP API routes are structural mirrors; shared behavior lives in `src/lib/configValidation.ts` and `src/lib/cliModels.ts`, not in copy-pasted route code.

## ANTI-PATTERNS
- Do not accept secret-like config keys in `/api/omo-config` or `/api/omp-config`; sensitive field names are explicitly blocked.
- Do not add unknown agent/category fields to config update payloads; validators enforce per-field rules.
- Do not reintroduce session monitoring, kanban, or host-management code; this app is an OMO/OMP model configuration GUI.
- Do not move tests to a separate global test tree; this codebase relies on co-location for context.
