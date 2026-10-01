import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import type { ExecException } from 'child_process';
import { mkdtemp, mkdir, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { delimiter, join } from 'path';
import { setExecFn } from '@/lib/cliModels';
import { GET } from './route';

type ExecCallback = (error: ExecException | null, stdout: string, stderr: string) => void;

type MockExecFn = (cmd: string, opts: unknown, callback: ExecCallback) => void;

describe('/api/omp-models', () => {
  const originalHome = process.env.HOME;
  const originalPath = process.env.PATH;
  const originalModelsTimeout = process.env.OMP_MODELS_TIMEOUT_MS;

  let mockExec: MockExecFn & {
    mockImplementation: (impl: MockExecFn) => void;
    mock: { calls: unknown[][] };
  };

  beforeAll(() => {
    process.env.HOME = '/tmp';
    process.env.PATH = '/usr/bin';
    delete process.env.OMP_MODELS_TIMEOUT_MS;
  });

  afterAll(() => {
    process.env.HOME = originalHome;
    process.env.PATH = originalPath;
    if (originalModelsTimeout === undefined) {
      delete process.env.OMP_MODELS_TIMEOUT_MS;
    } else {
      process.env.OMP_MODELS_TIMEOUT_MS = originalModelsTimeout;
    }
  });

  beforeEach(() => {
    mockExec = vi.fn() as unknown as MockExecFn & {
      mockImplementation: (impl: MockExecFn) => void;
      mock: { calls: unknown[][] };
    };
    setExecFn(mockExec as never);
  });

  afterEach(() => {
    setExecFn(null);
  });

  it('should return source=omp and real model list on successful GET', async () => {
    mockExec.mockImplementation((_cmd: unknown, _opts: unknown, callback: ExecCallback) => {
      callback(null, JSON.stringify({
        models: [
          {
            provider: 'kimi-code',
            id: 'k3',
            selector: 'kimi-code/k3',
            reasoning: true,
            thinking: ['low', 'high', 'max'],
          },
          {
            provider: 'openai-codex',
            id: 'gpt-5.4',
            selector: 'openai-codex/gpt-5.4',
            reasoning: false,
            thinking: null,
          },
        ],
      }), '');
    });

    const response = await GET();
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.source).toBe('omp');
    expect(data.models).toEqual(['kimi-code/k3', 'openai-codex/gpt-5.4']);
    expect(data.modelDetails).toEqual([
      {
        selector: 'kimi-code/k3',
        reasoning: true,
        thinking: ['low', 'high', 'max'],
      },
      {
        selector: 'openai-codex/gpt-5.4',
        reasoning: false,
        thinking: null,
      },
    ]);
  });

  it('should use OMP_MODELS_TIMEOUT_MS when valid', async () => {
    process.env.OMP_MODELS_TIMEOUT_MS = '30000';
    mockExec.mockImplementation((_cmd: unknown, _opts: unknown, callback: ExecCallback) => {
      callback(null, '{"models":[{"selector":"kimi-code/k3"}]}', '');
    });

    const response = await GET();
    const call = mockExec.mock.calls[0] as [string, { timeout: number }, ExecCallback] | undefined;
    expect(response.status).toBe(200);
    expect(call?.[1]?.timeout).toBe(30000);
    expect(typeof call?.[2]).toBe('function');
    delete process.env.OMP_MODELS_TIMEOUT_MS;
  });

  it('should fall back to provider/id when selector is missing and skip junk entries', async () => {
    mockExec.mockImplementation((_cmd: unknown, _opts: unknown, callback: ExecCallback) => {
      callback(null, JSON.stringify({
        models: [
          { provider: 'anthropic', id: 'claude-opus-4-6' },
          { provider: 'broken' },
          'not-an-object',
        ],
      }), 'warning: extra stderr noise');
    });

    const response = await GET();
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.source).toBe('omp');
    expect(data.models).toEqual(['anthropic/claude-opus-4-6']);
    expect(data.modelDetails).toEqual([{ selector: 'anthropic/claude-opus-4-6' }]);
  });

  it('should retain models while ignoring malformed capability metadata', async () => {
    mockExec.mockImplementation((_cmd: unknown, _opts: unknown, callback: ExecCallback) => {
      callback(null, JSON.stringify({
        models: [
          { selector: 'openai/gpt-valid', reasoning: true, thinking: ['minimal', 'xhigh'] },
          { selector: 'openai/gpt-bad-reasoning', reasoning: 'yes', thinking: null },
          { selector: 'openai/gpt-bad-thinking', reasoning: true, thinking: ['low', 42] },
          { selector: 'openai/gpt-unknown-thinking', thinking: ['turbo'] },
          { selector: 'openai/gpt-empty-thinking', reasoning: true, thinking: [] },
          { selector: '   ' },
          { provider: 'anthropic', id: '   ' },
          null,
          ['not', 'a', 'model'],
        ],
      }), '');
    });

    const response = await GET();
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.models).toEqual([
      'openai/gpt-valid',
      'openai/gpt-bad-reasoning',
      'openai/gpt-bad-thinking',
      'openai/gpt-unknown-thinking',
      'openai/gpt-empty-thinking',
    ]);
    expect(data.modelDetails).toEqual([
      { selector: 'openai/gpt-valid', reasoning: true, thinking: ['minimal', 'xhigh'] },
      { selector: 'openai/gpt-bad-reasoning', thinking: null },
      { selector: 'openai/gpt-bad-thinking', reasoning: true },
      { selector: 'openai/gpt-unknown-thinking' },
      { selector: 'openai/gpt-empty-thinking', reasoning: true, thinking: [] },
    ]);
  });

  it('should return 503 with OMP CLI not found when the binary is missing', async () => {
    mockExec.mockImplementation((_cmd: unknown, _opts: unknown, callback: ExecCallback) => {
      callback(new Error('spawn omp ENOENT') as ExecException, '', 'command not found');
    });

    const response = await GET();
    const data = await response.json();

    expect(response.status).toBe(503);
    expect(data.source).toBe('error');
    expect(data.models).toEqual([]);
    expect(data.error).toBe('OMP CLI not found');
  });

  it('returns a normalized error for non-ENOENT failures', async () => {
    mockExec.mockImplementation((_cmd: unknown, _opts: unknown, callback: ExecCallback) => {
      callback(new Error('timeout') as ExecException, '', '');
    });

    const response = await GET();
    const data = await response.json();

    expect(response.status).toBe(503);
    expect(data.source).toBe('error');
    expect(data.error).toBe('Failed to fetch models from CLI');
  });

  it('should return 503 when the CLI emits non-JSON output', async () => {
    mockExec.mockImplementation((_cmd: unknown, _opts: unknown, callback: ExecCallback) => {
      callback(null, 'not json at all', '');
    });

    const response = await GET();
    const data = await response.json();

    expect(response.status).toBe(503);
    expect(data.source).toBe('error');
    expect(data.error).toBe('Failed to parse models output');
  });

  it('should return 503 when the JSON models field is malformed', async () => {
    mockExec.mockImplementation((_cmd: unknown, _opts: unknown, callback: ExecCallback) => {
      callback(null, '{"models":{"selector":"openai/gpt-5.4"}}', '');
    });

    const response = await GET();
    const data = await response.json();

    expect(response.status).toBe(503);
    expect(data.source).toBe('error');
    expect(data.models).toEqual([]);
    expect(data).not.toHaveProperty('modelDetails');
  });

  it('should return a timeout hint when the CLI is killed by the timeout', async () => {
    mockExec.mockImplementation((_cmd: unknown, _opts: unknown, callback: ExecCallback) => {
      const error = new Error('Command failed: omp models --json') as ExecException;
      error.killed = true;
      error.signal = 'SIGTERM';
      callback(error, '', '');
    });

    const response = await GET();
    const data = await response.json();

    expect(response.status).toBe(503);
    expect(data.source).toBe('error');
    expect(data.error).toContain('timed out after 60s');
    expect(data.error).toContain('OMP_MODELS_TIMEOUT_MS');
  });

  it('should return 503 with error payload when GET returns empty models', async () => {
    mockExec.mockImplementation((_cmd: unknown, _opts: unknown, callback: ExecCallback) => {
      callback(null, '{"models":[]}', '');
    });

    const response = await GET();
    const data = await response.json();

    expect(response.status).toBe(503);
    expect(data.source).toBe('error');
    expect(data.models).toEqual([]);
  });
});

describe.skipIf(process.platform === 'win32')('/api/omp-models CLI discovery', () => {
  let home: string;

  async function installCli(installDir: string, selector: string) {
    const bin = join(installDir, 'bin');
    await mkdir(bin, { recursive: true });
    await writeFile(
      join(bin, 'omp'),
      `#!/usr/bin/env bun\nconsole.log(JSON.stringify({ models: [{ selector: ${JSON.stringify(selector)}, kind: 'chat' }] }));\n`,
      { mode: 0o755 }
    );
    await writeFile(
      join(bin, 'bun'),
      '#!/bin/sh\nexec "$OMP_TEST_NODE" "$@"\n',
      { mode: 0o755 }
    );
    return bin;
  }

  beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), 'omp-cli-discovery-'));
    vi.stubEnv('HOME', home);
    vi.stubEnv('PATH', ['/usr/bin', '/bin'].join(delimiter));
    vi.stubEnv('BUN_INSTALL', undefined);
    vi.stubEnv('OMP_TEST_NODE', process.execPath);
    setExecFn(null);
  });

  afterEach(async () => {
    setExecFn(null);
    vi.unstubAllEnvs();
    await rm(home, { recursive: true, force: true });
  });

  it('loads models when the standard Bun install and its runtime are absent from PATH', async () => {
    await installCli(join(home, '.bun'), 'fixture/standard');

    const response = await GET();
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.models).toEqual(['fixture/standard']);
  });

  it('uses BUN_INSTALL before the default install when neither is in PATH', async () => {
    await installCli(join(home, '.bun'), 'fixture/standard');
    const customInstall = join(home, 'custom bun');
    await installCli(customInstall, 'fixture/custom');
    vi.stubEnv('BUN_INSTALL', customInstall);

    const response = await GET();
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.models).toEqual(['fixture/custom']);
  });

  it('preserves an existing PATH-selected OMP installation', async () => {
    await installCli(join(home, '.bun'), 'fixture/standard');
    const customInstall = join(home, 'custom');
    await installCli(customInstall, 'fixture/custom');
    vi.stubEnv('BUN_INSTALL', customInstall);
    const preferredBin = await installCli(join(home, 'preferred'), 'fixture/preferred');
    vi.stubEnv('PATH', [preferredBin, '/usr/bin', '/bin'].join(delimiter));

    const response = await GET();
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.models).toEqual(['fixture/preferred']);
  });
});
