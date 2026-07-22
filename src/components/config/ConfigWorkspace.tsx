'use client';

import * as React from 'react';
import { Search, Bot, ChevronRight, AlertTriangle } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { CategoriesManager } from './categories/CategoriesManager';
import { ProfileManager } from './profiles/ProfileManager';
import { AgentConfigForm } from './AgentConfigForm';
import { ModelRolesPanel } from './ModelRolesPanel';
import type { ApiTarget } from '../ModelSelector';

interface AgentConfig {
  model?: string;
}

interface ConfigResponse {
  agents: Record<string, AgentConfig>;
}

interface ModelsResponse {
  models: string[];
  source: string;
  error?: string;
}

function isModelsResponse(value: unknown): value is ModelsResponse {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as { models?: unknown };
  return Array.isArray(candidate.models);
}

type AgentStatus = 'ok' | 'invalid' | 'unconfigured';

interface ConfigWorkspaceProps {
  apiTarget: ApiTarget;
}

interface AgentItem {
  key: string;
  name: string;
  description: string;
}

/** Display metadata for well-known OMO agents; unknown/config-only agents are listed too */
const KNOWN_AGENT_METADATA: Record<string, { name: string; description: string }> = {
  default: { name: 'Default', description: 'Fallback configuration' },
  sisyphus: { name: 'Sisyphus', description: 'Task execution agent' },
  hephaestus: { name: 'Hephaestus', description: 'Build & automation' },
  prometheus: { name: 'Prometheus', description: 'Planning agent' },
  oracle: { name: 'Oracle', description: 'Knowledge & research' },
  metis: { name: 'Metis', description: 'Strategy & consultation' },
  momus: { name: 'Momus', description: 'Review & critique' },
  atlas: { name: 'Atlas', description: 'Execution-focused' },
  librarian: { name: 'Librarian', description: 'Documentation & exploration' },
  explore: { name: 'Explore', description: 'Code navigation' },
  'multimodal-looker': { name: 'Multimodal Looker', description: 'Image & visual analysis' },
};

type WorkspaceTab = 'agents' | 'categories' | 'profiles' | 'roles';

export function ConfigWorkspace({ apiTarget }: ConfigWorkspaceProps) {
  const [activeTab, setActiveTab] = React.useState<WorkspaceTab>(
    apiTarget === 'omp' ? 'roles' : 'agents'
  );
  const [selectedAgent, setSelectedAgent] = React.useState('default');
  const [searchQuery, setSearchQuery] = React.useState('');

  const { data: configData } = useQuery<ConfigResponse>({
    queryKey: ['config', apiTarget],
    queryFn: async () => {
      const res = await fetch(`/api/${apiTarget}-config`);
      if (!res.ok) throw new Error('Failed to fetch config');
      return res.json();
    },
  });

  const { data: modelsData } = useQuery<ModelsResponse>({
    queryKey: ['models', apiTarget],
    queryFn: async () => {
      const res = await fetch(`/api/${apiTarget}-models`);
      let parsed: unknown = null;
      try {
        parsed = await res.json();
      } catch {
        parsed = null;
      }

      const errorMessage =
        parsed &&
        typeof parsed === 'object' &&
        'error' in parsed &&
        typeof parsed.error === 'string'
          ? parsed.error
          : null;

      if (!res.ok || errorMessage) {
        throw new Error(errorMessage || `Failed to fetch models (${res.status})`);
      }

      if (!isModelsResponse(parsed)) {
        throw new Error('Invalid models response');
      }

      return parsed;
    },
    retry: false,
  });

  const availableModels = React.useMemo(
    () => new Set(modelsData?.models ?? []),
    [modelsData]
  );

  // Agent list is driven by the config file: known OMO agents get friendly
  // metadata, everything else (and every OMP agent) is listed by its key.
  const agents = React.useMemo<AgentItem[]>(() => {
    const configuredKeys = Object.keys(configData?.agents ?? {});
    const keys = new Set<string>(configuredKeys);
    // The default fallback agent always exists, even with no config on disk
    keys.add('default');
    if (apiTarget === 'omo') {
      for (const key of Object.keys(KNOWN_AGENT_METADATA)) {
        keys.add(key);
      }
    }

    return Array.from(keys)
      .sort((a, b) => {
        if (a === 'default') return -1;
        if (b === 'default') return 1;
        return a.localeCompare(b);
      })
      .map((key) => ({
        key,
        name: KNOWN_AGENT_METADATA[key]?.name ?? key,
        description: KNOWN_AGENT_METADATA[key]?.description ?? 'Custom agent',
      }));
  }, [configData, apiTarget]);

  const getAgentStatus = React.useCallback(
    (agentKey: string): AgentStatus => {
      const agentConfig = configData?.agents?.[agentKey];
      if (!agentConfig?.model) return 'unconfigured';
      if (availableModels.size > 0 && !availableModels.has(agentConfig.model)) return 'invalid';
      return 'ok';
    },
    [configData, availableModels]
  );

  const attentionCount = React.useMemo(() => {
    return agents.filter((a) => getAgentStatus(a.key) === 'invalid').length;
  }, [agents, getAgentStatus]);

  const filteredAgents = React.useMemo(() => {
    if (!searchQuery.trim()) return agents;
    const query = searchQuery.toLowerCase();
    return agents.filter(
      (agent) =>
        agent.name.toLowerCase().includes(query) ||
        agent.description.toLowerCase().includes(query) ||
        (configData?.agents?.[agent.key]?.model || '').toLowerCase().includes(query)
    );
  }, [searchQuery, agents, configData]);

  const selectedAgentData = agents.find((a) => a.key === selectedAgent);
  const targetLabel = apiTarget.toUpperCase();

  return (
    <div className="flex flex-col">
      <div className="flex items-center gap-1 rounded-lg bg-zinc-100 p-1 dark:bg-zinc-800 self-start">
        {apiTarget === 'omp' ? (
          <button
            type="button"
            onClick={() => setActiveTab('roles')}
            className={`rounded-md px-4 py-1.5 text-sm font-medium transition-colors ${
              activeTab === 'roles'
                ? 'bg-blue-600 text-white shadow-sm'
                : 'text-zinc-600 hover:bg-zinc-200 dark:text-zinc-400 dark:hover:bg-zinc-700'
            }`}
          >
            Model Roles
          </button>
        ) : (
        <>
        <button
          type="button"
          onClick={() => setActiveTab('agents')}
          className={`rounded-md px-4 py-1.5 text-sm font-medium transition-colors ${
            activeTab === 'agents'
              ? 'bg-blue-600 text-white shadow-sm'
              : 'text-zinc-600 hover:bg-zinc-200 dark:text-zinc-400 dark:hover:bg-zinc-700'
          }`}
        >
          Agents
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('categories')}
          className={`rounded-md px-4 py-1.5 text-sm font-medium transition-colors ${
            activeTab === 'categories'
              ? 'bg-blue-600 text-white shadow-sm'
              : 'text-zinc-600 hover:bg-zinc-200 dark:text-zinc-400 dark:hover:bg-zinc-700'
          }`}
        >
          Categories
        </button>
        {apiTarget === 'omo' && (
          <button
            type="button"
            onClick={() => setActiveTab('profiles')}
            className={`rounded-md px-4 py-1.5 text-sm font-medium transition-colors ${
              activeTab === 'profiles'
                ? 'bg-blue-600 text-white shadow-sm'
                : 'text-zinc-600 hover:bg-zinc-200 dark:text-zinc-400 dark:hover:bg-zinc-700'
            }`}
          >
            Profiles
          </button>
        )}
        </>
        )}
      </div>

      {activeTab === 'roles' ? (
        <main className="mt-4 rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950">
          <div className="mx-auto max-w-4xl p-8">
            <div className="mb-8">
              <h2 className="text-2xl font-bold text-zinc-900 dark:text-zinc-100">
                Model Roles
              </h2>
              <p className="text-zinc-500 dark:text-zinc-400">
                Assign models to OMP roles in ~/.omp/agent/config.yml
              </p>
            </div>
            <ModelRolesPanel />
          </div>
        </main>
      ) : activeTab === 'agents' ? (
        <div className="mt-4 flex overflow-hidden rounded-xl border border-zinc-200 dark:border-zinc-800">
          <aside className="flex w-[280px] shrink-0 flex-col border-r border-zinc-200 bg-zinc-50/50 dark:border-zinc-800 dark:bg-zinc-900/20">
            <div className="border-b border-zinc-200 p-4 dark:border-zinc-800">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search agents..."
                  className="h-10 w-full rounded-lg border border-zinc-200 bg-white pl-9 pr-4 text-sm text-zinc-900 placeholder:text-zinc-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-100 dark:placeholder:text-zinc-600"
                />
              </div>
            </div>

            <nav className="flex-1 overflow-y-auto p-2">
              <div className="space-y-1">
                {filteredAgents.map((agent) => {
                  const agentModel = configData?.agents?.[agent.key]?.model;

                  return (
                    <button
                      key={agent.key}
                      type="button"
                      onClick={() => setSelectedAgent(agent.key)}
                      className={`flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-colors ${
                        selectedAgent === agent.key
                          ? 'bg-blue-600 text-white'
                          : 'text-zinc-700 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800'
                      }`}
                    >
                      <div
                        className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-md ${
                          selectedAgent === agent.key
                            ? 'bg-white/20'
                            : 'bg-zinc-200 dark:bg-zinc-800'
                        }`}
                      >
                        <Bot
                          className={`h-4 w-4 ${
                            selectedAgent === agent.key
                              ? 'text-white'
                              : 'text-zinc-600 dark:text-zinc-400'
                          }`}
                        />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 truncate text-sm font-medium">
                          {agent.name}
                          {(() => {
                            const status = getAgentStatus(agent.key);
                            if (status === 'unconfigured') return <span className={`inline-block h-2 w-2 shrink-0 rounded-full ${selectedAgent === agent.key ? 'bg-zinc-300' : 'bg-zinc-400 dark:bg-zinc-500'}`} title="Inherits category configuration" />;
                            if (status === 'invalid') return <span className={`inline-block h-2 w-2 shrink-0 rounded-full ${selectedAgent === agent.key ? 'bg-amber-300' : 'bg-amber-500'}`} title="Model not available" />;
                            return <span className={`inline-block h-2 w-2 shrink-0 rounded-full ${selectedAgent === agent.key ? 'bg-emerald-300' : 'bg-emerald-500'}`} title="Configured" />;
                          })()}
                        </div>
                        <div
                          className={`truncate text-xs ${
                            selectedAgent === agent.key
                              ? 'text-blue-100'
                              : 'text-zinc-500 dark:text-zinc-500'
                          }`}
                        >
                          {agent.description}
                        </div>
                        {agentModel && (
                          <div
                            className={`mt-1 inline-flex max-w-full items-start rounded-md px-1.5 py-0.5 text-[11px] leading-4 ${
                              selectedAgent === agent.key
                                ? 'bg-white/15 text-blue-50/95'
                                : 'bg-zinc-200/70 text-zinc-700 dark:bg-zinc-800/80 dark:text-zinc-300'
                            }`}
                            title={agentModel}
                          >
                            <span className="font-mono break-all [display:-webkit-box] [-webkit-box-orient:vertical] [-webkit-line-clamp:2] overflow-hidden">
                              {agentModel}
                            </span>
                          </div>
                        )}
                      </div>
                      {selectedAgent === agent.key && (
                        <ChevronRight className="h-4 w-4 shrink-0 text-blue-200" />
                      )}
                    </button>
                  );
                })}
              </div>

              {filteredAgents.length === 0 && (
                <div className="py-8 text-center">
                  <p className="text-sm text-zinc-500 dark:text-zinc-400">
                    No agents found
                  </p>
                </div>
              )}
            </nav>

            <div className="border-t border-zinc-200 p-4 dark:border-zinc-800">
              <div className="flex items-center justify-between text-xs text-zinc-500 dark:text-zinc-400">
                <span className="flex items-center gap-1.5">
                  {agents.length} agents
                  {attentionCount > 0 && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-700 dark:bg-amber-900/30 dark:text-amber-400">
                      <AlertTriangle className="h-2.5 w-2.5" />
                      {attentionCount} need attention
                    </span>
                  )}
                </span>
              </div>
            </div>
          </aside>

          <main className="flex-1 overflow-y-auto bg-white dark:bg-zinc-950">
            <div className="mx-auto max-w-3xl p-8">
              <div className="mb-8 flex items-center gap-4">
                <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-blue-500 to-indigo-600 text-white shadow-lg">
                  <Bot className="h-8 w-8" />
                </div>
                <div>
                  <h2 className="text-2xl font-bold text-zinc-900 dark:text-zinc-100">
                    {selectedAgentData?.name ?? selectedAgent}
                  </h2>
                  <p className="text-zinc-500 dark:text-zinc-400">
                    {selectedAgentData?.description ?? `${targetLabel} agent`}
                  </p>
                </div>
              </div>

              <AgentConfigForm
                key={`${apiTarget}-${selectedAgent}`}
                agentName={selectedAgent}
                apiTarget={apiTarget}
              />
            </div>
          </main>
        </div>
      ) : activeTab === 'categories' ? (
        <main className="mt-4 rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950">
          <div className="mx-auto max-w-4xl p-8">
            <div className="mb-8">
              <h2 className="text-2xl font-bold text-zinc-900 dark:text-zinc-100">
                Categories
              </h2>
              <p className="text-zinc-500 dark:text-zinc-400">
                Manage {targetLabel} categories and their configurations
              </p>
            </div>
            <CategoriesManager apiTarget={apiTarget} />
          </div>
        </main>
      ) : (
        <main className="mt-4 rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950">
          <div className="mx-auto max-w-4xl p-8">
            <div className="mb-8">
              <h2 className="text-2xl font-bold text-zinc-900 dark:text-zinc-100">
                Profiles
              </h2>
              <p className="text-zinc-500 dark:text-zinc-400">
                Manage configuration profiles for different agent setups
              </p>
            </div>
            <ProfileManager />
          </div>
        </main>
      )}
    </div>
  );
}

export default ConfigWorkspace;
