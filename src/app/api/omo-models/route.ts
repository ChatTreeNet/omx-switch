import { NextResponse } from 'next/server';
import { runModelsCommand } from '@/lib/cliModels';

export async function GET(): Promise<Response> {
  const { result, status } = await runModelsCommand({
    command: 'opencode models',
    sourceName: 'opencode',
    timeoutEnvVar: 'OPENCODE_MODELS_TIMEOUT_MS',
    extraPath: `${process.env.HOME}/.opencode/bin`,
  });

  return NextResponse.json(result, { status });
}
