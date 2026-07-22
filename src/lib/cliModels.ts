import { type ExecException } from 'child_process';

export type ExecFn = (
  command: string,
  options: { timeout: number; env: NodeJS.ProcessEnv },
  callback: (error: ExecException | null, stdout: string, stderr: string) => void
) => void;

let _execFn: ExecFn | null = null;

function getExecFn(): ExecFn {
  if (_execFn) return _execFn;
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require('child_process').exec as ExecFn;
}

export function setExecFn(fn: ExecFn | null) {
  _execFn = fn;
}

export interface ModelsResult {
  models: string[];
  source: string;
  error?: string;
}

export function handleExecResult(
  error: ExecException | null,
  stdout: string,
  stderr: string,
  sourceName = 'opencode'
): ModelsResult {
  const logLabel = `[${sourceName}-models]`;

  if (error) {
    console.error(`${logLabel} command failed`, {
      message: error.message,
      code: error.code,
      signal: error.signal,
      stderr: stderr || undefined,
      stdoutPreview: stdout ? stdout.slice(0, 300) : undefined,
    });
    return { models: [], source: 'error', error: error.message || 'Failed to fetch models from CLI' };
  }

  if (stderr) {
    console.warn(`${logLabel} stderr:`, stderr);
  }

  try {
    const models = stdout
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.includes('/'));
    if (models.length === 0) {
      return { models: [], source: 'error', error: 'No models found. Please check your CLI installation.' };
    }
    return { models, source: sourceName };
  } catch {
    return { models: [], source: 'error', error: 'Failed to parse models output' };
  }
}

export interface ModelsCommandOptions {
  /** CLI command to execute, e.g. 'opencode models' */
  command: string;
  /** Success source label, e.g. 'opencode' or 'omp' */
  sourceName: string;
  /** Env var that overrides the default exec timeout */
  timeoutEnvVar: string;
  /** Default exec timeout in ms when the env var is unset (default 15000) */
  defaultTimeoutMs?: number;
  /** Extra directory prepended to PATH for the exec call */
  extraPath?: string;
  /** Error message returned when the CLI binary is missing (ENOENT) */
  notFoundError?: string;
  /** Custom stdout parser; defaults to the provider/model line filter */
  parseStdout?: (stdout: string) => string[];
}

export function runModelsCommand(
  options: ModelsCommandOptions
): Promise<{ result: ModelsResult; status: number }> {
  const { promise, resolve } = Promise.withResolvers<{ result: ModelsResult; status: number }>();

  const parsedTimeout = Number(process.env[options.timeoutEnvVar]);
  const fallback = options.defaultTimeoutMs ?? 15000;
  const timeout = Number.isFinite(parsedTimeout) && parsedTimeout > 0 ? parsedTimeout : fallback;

  const env = options.extraPath
    ? { ...process.env, PATH: `${options.extraPath}:${process.env.PATH}` }
    : { ...process.env };

  getExecFn()(options.command, { timeout, env }, (error, stdout, stderr) => {
    if (error) {
      console.error(`[${options.sourceName}-models] GET failed`, {
        timeout,
        command: options.command,
        cwd: process.cwd(),
        home: process.env.HOME,
      });
    }

    let result: ModelsResult;

    // exec kills the process with SIGTERM on timeout; surface a hint instead
    // of the bare 'Command failed' message
    const killedByTimeout = error && (error.killed || error.signal === 'SIGTERM');
    const effectiveError = killedByTimeout
      ? Object.assign(new Error(`${options.command} timed out after ${Math.round(timeout / 1000)}s (override with ${options.timeoutEnvVar})`), { code: error.code, signal: error.signal })
      : error;

    if (!effectiveError && options.parseStdout) {
      if (stderr) {
        console.warn(`[${options.sourceName}-models] stderr:`, stderr);
      }
      try {
        const models = options.parseStdout(stdout);
        result = models.length > 0
          ? { models, source: options.sourceName }
          : { models: [], source: 'error', error: 'No models found. Please check your CLI installation.' };
      } catch {
        result = { models: [], source: 'error', error: 'Failed to parse models output' };
      }
    } else {
      result = handleExecResult(effectiveError, stdout, stderr, options.sourceName);
    }

    if (error && options.notFoundError && /ENOENT|command not found/.test(error.message)) {
      result = { models: [], source: 'error', error: options.notFoundError };
    }

    const status = result.source === 'error' ? 503 : 200;
    resolve({ result, status });
  });

  return promise;
}
