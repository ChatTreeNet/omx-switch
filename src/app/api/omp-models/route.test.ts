import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import type { ExecException } from 'child_process';
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
          { provider: 'kimi-code', id: 'k3', selector: 'kimi-code/k3' },
          { provider: 'openai-codex', id: 'gpt-5.4', selector: 'openai-codex/gpt-5.4' },
        ],
      }), '');
    });

    const response = await GET();
    const data = await response.json();
    const call = mockExec.mock.calls[0] as [string, { timeout: number }, ExecCallback] | undefined;

    expect(response.status).toBe(200);
    expect(data.source).toBe('omp');
    expect(data.models).toEqual(['kimi-code/k3', 'openai-codex/gpt-5.4']);
    expect(call?.[0]).toBe('omp models --json');
    expect(call?.[1]?.timeout).toBe(15000);
    expect(typeof call?.[2]).toBe('function');
  });

  it('should use OMP_MODELS_TIMEOUT_MS when valid', async () => {
    process.env.OMP_MODELS_TIMEOUT_MS = '30000';
    mockExec.mockImplementation((_cmd: unknown, _opts: unknown, callback: ExecCallback) => {
      callback(null, '{"models":[{"selector":"kimi-code/k3"}]}', '');
    });

    const response = await GET();
    const call = mockExec.mock.calls[0] as [string, { timeout: number }, ExecCallback] | undefined;
    expect(response.status).toBe(200);
    expect(call?.[0]).toBe('omp models --json');
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

  it('should return 503 with the raw error message for non-ENOENT failures', async () => {
    mockExec.mockImplementation((_cmd: unknown, _opts: unknown, callback: ExecCallback) => {
      callback(new Error('timeout') as ExecException, '', '');
    });

    const response = await GET();
    const data = await response.json();

    expect(response.status).toBe(503);
    expect(data.source).toBe('error');
    expect(data.error).toBe('timeout');
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
