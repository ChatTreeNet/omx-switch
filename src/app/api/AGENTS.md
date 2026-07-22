# API KNOWLEDGE BASE

**Scope:** `src/app/api/`

## OVERVIEW
`src/app/api/` hosts the OMX Switch route handlers: OMO/OMP config read/update,
OMO/OMP CLI model listing, and the OMO upstream staleness check.

## STRUCTURE
```text
src/app/api/
├── omo-config/    # GET/POST ~/.config/opencode/oh-my-openagent.jsonc (secret-filtered)
├── omp-config/    # GET/POST ~/.omp/agent/config.yml modelRoles (secret-filtered)
├── omo-models/    # GET model list from `opencode models`
├── omp-models/    # GET model list from `omp models --json`
├── omp-profiles/  # OMP profile CRUD, apply, import/export (~/.omp/agent/profiles)
└── omo-sync/      # GET staleness of github.com/code-yeongyu/oh-my-openagent (60-day threshold)
```

## WHERE TO LOOK
| Task | Location | Notes |
|------|----------|-------|
| OMO config validation gate | `src/app/api/omo-config/route.ts` | field validators + sensitive-field rejection |
| OMP config validation gate | `src/app/api/omp-config/route.ts` | mirror of omo-config on the OMP file |
| Shared validators | `src/lib/configValidation.ts` | secret patterns, field validators, merge helpers |
| CLI exec plumbing | `src/lib/cliModels.ts` | timeout env vars, ENOENT handling, parse hooks |
| Upstream sync check | `src/app/api/omo-sync/route.ts` | GitHub `pushed_at` vs 60-day threshold |

## CONVENTIONS
- Route shape is file-based: one handler module per `route.ts`.
- Error responses consistently use structured JSON with explicit HTTP statuses (`400` validation, `403` forbidden fields, `503` service unavailable).
- API tests are co-located with handlers (`route.test.ts` next to `route.ts`); config routes mock `@/lib/omoConfig` / `@/lib/ompConfig`, model routes inject a fake exec via `setExecFn`.
- `omp models` output is parsed via `omp models --json` (`selector` field); the plain-text line filter is only for `opencode models`.

## ANTI-PATTERNS
- Do not accept secret-like config keys in `/api/omo-config` or `/api/omp-config`; sensitive field names are explicitly blocked.
- Do not add unknown config fields for agents/categories/vibepulse; handlers enforce per-field validators.
- Do not parse the human `omp models` table output; always use `--json`.
