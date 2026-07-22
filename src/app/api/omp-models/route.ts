import { NextResponse } from 'next/server';
import { runModelsCommand } from '@/lib/cliModels';

function parseOmpModelsJson(stdout: string): string[] {
  const payload = JSON.parse(stdout);
  if (!payload || !Array.isArray(payload.models)) {
    return [];
  }

  return payload.models
    .map((entry: { selector?: unknown; provider?: unknown; id?: unknown }) => {
      if (typeof entry?.selector === 'string' && entry.selector !== '') {
        return entry.selector;
      }
      if (typeof entry?.provider === 'string' && typeof entry?.id === 'string') {
        return `${entry.provider}/${entry.id}`;
      }
      return null;
    })
    .filter((selector: string | null): selector is string => selector !== null);
}

export async function GET(): Promise<Response> {
  const { result, status } = await runModelsCommand({
    command: 'omp models --json',
    sourceName: 'omp',
    timeoutEnvVar: 'OMP_MODELS_TIMEOUT_MS',
    // Cold catalog refreshes can take 30s+; the default 15s kills them
    defaultTimeoutMs: 60000,
    notFoundError: 'OMP CLI not found',
    parseStdout: parseOmpModelsJson,
  });

  return NextResponse.json(result, { status });
}
