import { NextResponse } from 'next/server';
import { runModelsCommand } from '@/lib/cliModels';
import { parseOpenCodeModelsVerbose } from '@/lib/opencodeModels';
import type { OmoModelDetail } from '@/lib/queries';

export async function GET(): Promise<Response> {
  let modelDetails: OmoModelDetail[] = [];
  const verbose = await runModelsCommand({
    command: 'opencode models --verbose',
    sourceName: 'opencode',
    timeoutEnvVar: 'OPENCODE_MODELS_TIMEOUT_MS',
    defaultTimeoutMs: 30000,
    maxBuffer: 32 * 1024 * 1024,
    extraPath: `${process.env.HOME}/.opencode/bin`,
    parseStdout: (stdout) => {
      const parsed = parseOpenCodeModelsVerbose(stdout);
      modelDetails = parsed.modelDetails;
      return parsed.models;
    },
  });

  if (verbose.status === 200) {
    return NextResponse.json(
      { ...verbose.result, modelDetails },
      { status: verbose.status }
    );
  }

  // OpenCode releases predating --verbose still get a usable model selector.
  // The UI treats missing metadata as unknown and preserves configured values.
  const fallback = await runModelsCommand({
    command: 'opencode models',
    sourceName: 'opencode',
    timeoutEnvVar: 'OPENCODE_MODELS_TIMEOUT_MS',
    extraPath: `${process.env.HOME}/.opencode/bin`,
  });

  return NextResponse.json(fallback.result, { status: fallback.status });
}
