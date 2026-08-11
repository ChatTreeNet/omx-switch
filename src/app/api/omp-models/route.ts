import { NextResponse } from 'next/server';
import { runModelsCommand } from '@/lib/cliModels';
import type { OmpModelDetail } from '@/lib/queries';

const FIXED_THINKING_LEVELS = new Set([
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
  'max',
]);

interface ParsedOmpModels {
  models: string[];
  modelDetails: OmpModelDetail[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function getSelector(entry: Record<string, unknown>): string | null {
  if (typeof entry.selector === 'string' && entry.selector.trim() !== '') {
    return entry.selector.trim();
  }

  if (typeof entry.provider !== 'string' || typeof entry.id !== 'string') {
    return null;
  }

  const provider = entry.provider.trim();
  const id = entry.id.trim();
  return provider !== '' && id !== '' ? `${provider}/${id}` : null;
}

function getThinkingLevels(value: unknown): string[] | null | undefined {
  if (value === null) return null;
  if (!Array.isArray(value)) return undefined;
  if (!value.every((level) => typeof level === 'string' && FIXED_THINKING_LEVELS.has(level))) {
    return undefined;
  }
  return value;
}

function parseOmpModelsJson(stdout: string): ParsedOmpModels {
  const payload = JSON.parse(stdout);
  if (!isRecord(payload) || !Array.isArray(payload.models)) {
    return { models: [], modelDetails: [] };
  }

  const models: string[] = [];
  const modelDetails: OmpModelDetail[] = [];

  for (const entry of payload.models) {
    if (!isRecord(entry)) continue;

    const selector = getSelector(entry);
    if (selector === null) continue;

    const detail: OmpModelDetail = { selector };
    if (typeof entry.reasoning === 'boolean') {
      detail.reasoning = entry.reasoning;
    }

    const thinking = getThinkingLevels(entry.thinking);
    if (thinking !== undefined) {
      detail.thinking = thinking;
    }

    models.push(selector);
    modelDetails.push(detail);
  }

  return { models, modelDetails };
}

export async function GET(): Promise<Response> {
  let modelDetails: OmpModelDetail[] = [];
  const { result, status } = await runModelsCommand({
    command: 'omp models --json',
    sourceName: 'omp',
    timeoutEnvVar: 'OMP_MODELS_TIMEOUT_MS',
    // Cold catalog refreshes can take 30s+; the default 15s kills them
    defaultTimeoutMs: 60000,
    notFoundError: 'OMP CLI not found',
    parseStdout: (stdout) => {
      const parsed = parseOmpModelsJson(stdout);
      modelDetails = parsed.modelDetails;
      return parsed.models;
    },
  });

  return NextResponse.json(status === 200 ? { ...result, modelDetails } : result, { status });
}
