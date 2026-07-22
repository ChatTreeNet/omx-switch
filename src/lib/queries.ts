import { useQuery } from '@tanstack/react-query';
import type { AgentConfig, CategoryConfig } from '@/types/omoConfig';

export type ApiTarget = 'omo' | 'omp';

export interface TargetConfigResponse {
  agents?: Record<string, AgentConfig>;
  categories?: Record<string, CategoryConfig>;
  modelRoles?: Record<string, string>;
  modelFallback?: boolean;
  fallbackChains?: Record<string, string[]>;
  [key: string]: unknown;
}

export interface ModelsResponse {
  models: string[];
  source: string;
  error?: string;
}

function isModelsResponse(value: unknown): value is ModelsResponse {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as { models?: unknown };
  return Array.isArray(candidate.models);
}

export function useConfigQuery(apiTarget: ApiTarget, options: { retry?: boolean } = {}) {
  return useQuery<TargetConfigResponse>({
    queryKey: ['config', apiTarget],
    queryFn: async () => {
      const res = await fetch(`/api/${apiTarget}-config`);
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to fetch config');
      }
      return data;
    },
    retry: options.retry,
  });
}

export function useModelsQuery(apiTarget: ApiTarget) {
  return useQuery<ModelsResponse>({
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
}
