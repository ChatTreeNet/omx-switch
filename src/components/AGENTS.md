# COMPONENTS KNOWLEDGE BASE

**Scope:** `src/components/`

## OVERVIEW
`src/components/` contains the OMX Switch UI: the config workspace (agents,
categories, profiles) shared by OMO and OMP, the Radix model dropdown, and the
OMO upstream sync banner.

## STRUCTURE
```text
src/components/
├── config/                     # target-parameterized config workspace
│   ├── ConfigWorkspace.tsx     # agents sidebar + form, categories, profiles tabs
│   ├── AgentConfigForm.tsx     # full per-agent editing form (react-hook-form)
│   ├── categories/             # CategoriesManager/CategoryConfigForm/CategoriesList
│   └── profiles/               # ProfileManager/ProfileEditor/ProfileList/ProfileCard (OMO only)
├── ModelSelector.tsx           # Radix select: provider grouping, search, error/retry
├── SyncStatus.tsx              # /api/omo-sync warning banner (hidden when fresh)
├── QueryProvider.tsx           # TanStack Query client provider
└── ModelSelector.test.tsx
```

## WHERE TO LOOK
| Task | Location | Notes |
|------|----------|-------|
| Workspace tabs / agent sidebar | `src/components/config/ConfigWorkspace.tsx` | dynamic agent list from config; both targets get a Profiles tab |
| Per-agent save flow | `src/components/config/AgentConfigForm.tsx` | POST `{ agents: { [name]: payload } }` to `/api/{target}-config` |
| Dropdown behavior | `src/components/ModelSelector.tsx` | fetches `/api/{target}-models`; swallows Radix's spurious `onValueChange('')` |
| Sync banner | `src/components/SyncStatus.tsx` | renders only when `needsSync` is true |

## CONVENTIONS
- Components are client components (`'use client'`) and use TanStack Query for all fetches; query keys are `['config', target]` and `['models', target]`; mutations invalidate the matching key.
- `apiTarget: 'omo' | 'omp'` (exported from `ModelSelector.tsx`) is the single discriminator between the two targets; do not fork components per target.
- Profiles exist for both targets: OMO via `/api/profiles` (agents/categories payloads), OMP via `/api/omp-profiles` (modelRoles/fallbackChains payloads). Profiles components take `apiTarget` and invalidate `['config', target]`.
- UI tests are co-located (`*.test.tsx`); mock `ModelSelector` with a plain `<select>` when Radix pointer behavior is not under test.

## ANTI-PATTERNS
- Do not inline config validation in components; the API routes are the validation gate.
- Do not bypass TanStack Query with ad-hoc `useEffect` fetches.
- Do not hardcode agent lists from config files; the sidebar derives its list from the loaded config (plus well-known OMO metadata).
