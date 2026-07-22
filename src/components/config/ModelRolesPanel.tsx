'use client';

import * as React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertCircle, CheckCircle2, ChevronDown, ChevronRight, Loader2, Plus, RotateCcw, X } from 'lucide-react';
import { ModelSelector } from '../ModelSelector';

interface OmpConfigResponse {
  modelRoles?: Record<string, string>;
  modelFallback?: boolean;
  fallbackChains?: Record<string, string[]>;
  [key: string]: unknown;
}

interface ModelsResponse {
  models: string[];
  source: string;
  error?: string;
}

interface RoleDefinition {
  key: string;
  name: string;
  description: string;
}

// Built-in roles from @oh-my-pi/pi-coding-agent model-roles; custom roles
// found in config.yml are appended below these.
const BUILT_IN_ROLES: RoleDefinition[] = [
  { key: 'default', name: 'Default', description: 'Primary model for the main agent' },
  { key: 'smol', name: 'Smol', description: 'Fast/cheap model for lightweight tasks' },
  { key: 'slow', name: 'Slow', description: 'Reasoning model for thorough analysis' },
  { key: 'plan', name: 'Plan', description: 'Model for architectural planning' },
  { key: 'vision', name: 'Vision', description: 'Model for image analysis' },
  { key: 'designer', name: 'Designer', description: 'Model for design work' },
  { key: 'commit', name: 'Commit', description: 'Model for commit message generation' },
  { key: 'task', name: 'Task', description: 'Model for spawned subagents' },
  { key: 'advisor', name: 'Advisor', description: 'Passive reviewer that injects notes' },
  { key: 'tiny', name: 'Tiny', description: 'Smallest model for trivial operations' },
];

export function ModelRolesPanel() {
  const queryClient = useQueryClient();
  const [selections, setSelections] = React.useState<Record<string, string>>({});
  const [dirtyRoles, setDirtyRoles] = React.useState<Record<string, true>>({});
  const [clearedRoles, setClearedRoles] = React.useState<Record<string, true>>({});
  const [chainDrafts, setChainDrafts] = React.useState<Record<string, string[]>>({});
  const [dirtyChains, setDirtyChains] = React.useState<Record<string, true>>({});
  const [expandedChains, setExpandedChains] = React.useState<Record<string, boolean>>({});
  const [fallbackEnabled, setFallbackEnabled] = React.useState<boolean | null>(null);

  const configQuery = useQuery<OmpConfigResponse>({
    queryKey: ['config', 'omp'],
    queryFn: async () => {
      const res = await fetch('/api/omp-config');
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to load OMP config');
      }
      return data;
    },
    retry: false,
  });

  const modelsQuery = useQuery<ModelsResponse>({
    queryKey: ['models', 'omp'],
    queryFn: async () => {
      const res = await fetch('/api/omp-models');
      const data = await res.json();
      if (!res.ok || data.error) {
        throw new Error(data.error || 'Failed to fetch models');
      }
      return data;
    },
    retry: false,
  });

  // Memoized: a fresh `?? {}` literal every render would retrigger the sync
  // effects below forever (setState -> render -> effect -> setState...)
  const configuredRoles = React.useMemo(
    () => configQuery.data?.modelRoles ?? {},
    [configQuery.data]
  );
  const configuredChains = React.useMemo(
    () => configQuery.data?.fallbackChains ?? {},
    [configQuery.data]
  );
  const configuredFallbackEnabled = configQuery.data?.modelFallback !== false;

  // Follow the on-disk config for any role the user has not edited
  React.useEffect(() => {
    setSelections((prev) => {
      const next: Record<string, string> = { ...prev };
      for (const role of Object.keys(configuredRoles)) {
        if (!dirtyRoles[role]) {
          next[role] = configuredRoles[role];
        }
      }
      return next;
    });
  }, [configuredRoles, dirtyRoles]);

  React.useEffect(() => {
    setChainDrafts((prev) => {
      const next: Record<string, string[]> = { ...prev };
      for (const [key, chain] of Object.entries(configuredChains)) {
        if (!dirtyChains[key]) {
          next[key] = chain;
        }
      }
      return next;
    });
  }, [configuredChains, dirtyChains]);

  const roles = React.useMemo<RoleDefinition[]>(() => {
    const known = new Set(BUILT_IN_ROLES.map((r) => r.key));
    const custom = new Set<string>();
    for (const key of Object.keys(configuredRoles)) custom.add(key);
    for (const key of Object.keys(configuredChains)) custom.add(key);
    const extras = Array.from(custom)
      .filter((key) => !known.has(key))
      .sort()
      .map((key) => ({ key, name: key, description: 'Custom role' }));
    return [...BUILT_IN_ROLES, ...extras];
  }, [configuredRoles, configuredChains]);

  const saveMutation = useMutation({
    mutationFn: async (payload: {
      modelRoles?: Record<string, string | null>;
      fallbackChains?: Record<string, string[] | null>;
      modelFallback?: boolean;
    }) => {
      const res = await fetch('/api/omp-config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to save OMP config');
      }
      return data;
    },
    onSuccess: () => {
      setDirtyRoles({});
      setClearedRoles({});
      setDirtyChains({});
      setFallbackEnabled(null);
      queryClient.invalidateQueries({ queryKey: ['config', 'omp'] });
    },
  });

  const changedRoleKeys = React.useMemo(() => {
    const changed = new Set<string>();
    for (const role of Object.keys(dirtyRoles)) {
      if ((selections[role] ?? '') !== (configuredRoles[role] ?? '')) {
        changed.add(role);
      }
    }
    for (const role of Object.keys(clearedRoles)) {
      if (configuredRoles[role] !== undefined) {
        changed.add(role);
      }
    }
    return Array.from(changed);
  }, [dirtyRoles, clearedRoles, selections, configuredRoles]);

  const changedChainKeys = React.useMemo(() => {
    return Object.keys(dirtyChains).filter((key) => {
      const draft = chainDrafts[key] ?? [];
      const configured = configuredChains[key] ?? [];
      if (draft.length !== configured.length) return true;
      return draft.some((entry, index) => entry !== configured[index]);
    });
  }, [dirtyChains, chainDrafts, configuredChains]);

  const fallbackToggleChanged = fallbackEnabled !== null && fallbackEnabled !== configuredFallbackEnabled;
  const isDirty = changedRoleKeys.length > 0 || changedChainKeys.length > 0 || fallbackToggleChanged;
  const changeCount = changedRoleKeys.length + changedChainKeys.length + (fallbackToggleChanged ? 1 : 0);

  const handleValueChange = (role: string, model: string) => {
    setSelections((prev) => ({ ...prev, [role]: model }));
    setDirtyRoles((prev) => ({ ...prev, [role]: true }));
    setClearedRoles((prev) => {
      const next = { ...prev };
      delete next[role];
      return next;
    });
    saveMutation.reset();
  };

  const handleClear = (role: string) => {
    setClearedRoles((prev) => ({ ...prev, [role]: true }));
    saveMutation.reset();
  };

  const handleChainChange = (key: string, chain: string[]) => {
    setChainDrafts((prev) => ({ ...prev, [key]: chain }));
    setDirtyChains((prev) => ({ ...prev, [key]: true }));
    saveMutation.reset();
  };

  const handleSave = () => {
    if (!isDirty) return;
    const payload: {
      modelRoles?: Record<string, string | null>;
      fallbackChains?: Record<string, string[] | null>;
      modelFallback?: boolean;
    } = {};

    if (changedRoleKeys.length > 0) {
      payload.modelRoles = {};
      for (const role of changedRoleKeys) {
        payload.modelRoles[role] = clearedRoles[role] ? null : selections[role];
      }
    }

    if (changedChainKeys.length > 0) {
      payload.fallbackChains = {};
      for (const key of changedChainKeys) {
        const chain = (chainDrafts[key] ?? []).filter((entry) => entry.trim() !== '');
        payload.fallbackChains[key] = chain.length > 0 ? chain : null;
      }
    }

    if (fallbackToggleChanged) {
      payload.modelFallback = fallbackEnabled;
    }

    saveMutation.mutate(payload);
  };

  const isRoleCleared = (role: string) => clearedRoles[role] === true;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-4">
        <label className="flex items-center gap-2 text-sm text-zinc-700 dark:text-zinc-300">
          <input
            type="checkbox"
            checked={fallbackEnabled ?? configuredFallbackEnabled}
            onChange={(event) => {
              setFallbackEnabled(event.target.checked);
              saveMutation.reset();
            }}
            className="h-4 w-4 rounded border-zinc-300 accent-blue-600"
          />
          Enable model fallback on retry
        </label>
        <div className="flex items-center gap-3">
          {saveMutation.isSuccess && !isDirty && (
            <span className="flex items-center gap-1 text-xs text-green-600 dark:text-green-400">
              <CheckCircle2 className="h-3.5 w-3.5" />
              Saved
            </span>
          )}
          {saveMutation.isError && (
            <span className="flex items-center gap-1 text-xs text-red-600 dark:text-red-400">
              <AlertCircle className="h-3.5 w-3.5" />
              {saveMutation.error instanceof Error ? saveMutation.error.message : 'Save failed'}
            </span>
          )}
          <button
            type="button"
            onClick={handleSave}
            disabled={!isDirty || saveMutation.isPending}
            className="inline-flex items-center gap-1.5 rounded-md bg-zinc-900 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
          >
            {saveMutation.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            Save{isDirty ? ` (${changeCount})` : ''}
          </button>
        </div>
      </div>

      <p className="text-sm text-zinc-500 dark:text-zinc-400">
        Assign a model to each OMP role. Unassigned roles fall back to the default model.
        Expand a role to edit its ordered fallback chain, tried when the primary model fails.
      </p>

      {configQuery.isLoading ? (
        <div className="flex items-center gap-2 text-sm text-zinc-500 dark:text-zinc-400">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading OMP config...
        </div>
      ) : configQuery.isError ? (
        <div className="flex items-center gap-2 text-sm text-red-600 dark:text-red-400">
          <AlertCircle className="h-4 w-4" />
          {configQuery.error instanceof Error ? configQuery.error.message : 'Failed to load OMP config'}
        </div>
      ) : (
        <ul className="space-y-2">
          {roles.map((role) => {
            const cleared = isRoleCleared(role.key);
            const currentModel = cleared ? '' : (selections[role.key] ?? configuredRoles[role.key] ?? '');
            const chain = chainDrafts[role.key] ?? configuredChains[role.key] ?? [];
            const chainExpanded = expandedChains[role.key] === true;
            const chainChanged = changedChainKeys.includes(role.key);
            return (
              <li
                key={role.key}
                className="rounded-lg border border-zinc-200 px-3 py-2 dark:border-zinc-800"
              >
                <div className="flex items-center gap-3">
                  <div className="w-36 shrink-0">
                    <div className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
                      {role.name}
                    </div>
                    <div className="truncate text-xs text-zinc-500 dark:text-zinc-400" title={role.description}>
                      {role.description}
                    </div>
                  </div>
                  <div className="min-w-0 flex-1">
                    <ModelSelector
                      apiTarget="omp"
                      value={currentModel}
                      onValueChange={(model) => handleValueChange(role.key, model)}
                      placeholder="Not set (uses default)"
                      ariaLabel={`omp-role-${role.key}-model`}
                    />
                  </div>
                  {configuredRoles[role.key] !== undefined && !cleared && (
                    <button
                      type="button"
                      onClick={() => handleClear(role.key)}
                      title={`Unset ${role.name} role`}
                      aria-label={`Unset ${role.name} role`}
                      className="shrink-0 rounded-md p-1.5 text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-zinc-600 dark:hover:bg-zinc-800 dark:hover:text-zinc-300"
                    >
                      <RotateCcw className="h-3.5 w-3.5" />
                    </button>
                  )}
                  {cleared && (
                    <span className="shrink-0 text-xs text-amber-600 dark:text-amber-400">
                      will unset
                    </span>
                  )}
                  <button
                    type="button"
                    onClick={() => setExpandedChains((prev) => ({ ...prev, [role.key]: !chainExpanded }))}
                    aria-expanded={chainExpanded}
                    aria-label={`Fallback chain for ${role.name}`}
                    className={`flex shrink-0 items-center gap-1 rounded-md px-2 py-1.5 text-xs transition-colors ${
                      chain.length > 0
                        ? 'text-blue-600 hover:bg-blue-50 dark:text-blue-400 dark:hover:bg-blue-900/20'
                        : 'text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600 dark:hover:bg-zinc-800 dark:hover:text-zinc-300'
                    }`}
                  >
                    {chainExpanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                    Fallbacks{chain.length > 0 ? ` (${chain.length})` : ''}
                    {chainChanged && <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />}
                  </button>
                </div>

                {chainExpanded && (
                  <div className="mt-3 space-y-2 border-t border-zinc-100 pt-3 dark:border-zinc-800/60">
                    <datalist id={`omp-models-datalist-${role.key}`}>
                      {(modelsQuery.data?.models ?? []).map((model) => (
                        <option key={model} value={model} />
                      ))}
                    </datalist>
                    {chain.length === 0 && (
                      <p className="text-xs text-zinc-500 dark:text-zinc-400">
                        No fallbacks — retries stay on the primary model.
                      </p>
                    )}
                    {chain.map((entry, index) => (
                      <div key={index} className="flex items-center gap-2">
                        <span className="w-5 shrink-0 text-right text-xs text-zinc-400">{index + 1}.</span>
                        <input
                          type="text"
                          value={entry}
                          list={`omp-models-datalist-${role.key}`}
                          onChange={(event) => {
                            const next = [...chain];
                            next[index] = event.target.value;
                            handleChainChange(role.key, next);
                          }}
                          placeholder="provider/model or provider/*"
                          aria-label={`${role.name} fallback ${index + 1}`}
                          className="h-8 min-w-0 flex-1 rounded-md border border-zinc-200 bg-white px-2 font-mono text-xs dark:border-zinc-800 dark:bg-zinc-950"
                        />
                        <button
                          type="button"
                          onClick={() => handleChainChange(role.key, chain.filter((_, i) => i !== index))}
                          aria-label={`Remove fallback ${index + 1}`}
                          className="shrink-0 rounded-md p-1 text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-zinc-600 dark:hover:bg-zinc-800"
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    ))}
                    <button
                      type="button"
                      onClick={() => handleChainChange(role.key, [...chain, ''])}
                      className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-300"
                    >
                      <Plus className="h-3 w-3" />
                      Add fallback
                    </button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

export default ModelRolesPanel;
