import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import type { ExecException } from 'child_process';
import { handleExecResult, setExecFn } from '@/lib/cliModels';
import { GET } from './route';

type ExecCallback = (error: ExecException | null, stdout: string, stderr: string) => void;

type MockExecFn = (cmd: string, opts: unknown, callback: ExecCallback) => void;

describe('/api/omo-models', () => {
  describe('handleExecResult', () => {
    it('should return error when CLI does not exist', () => {
      const error = new Error('spawn opencode ENOENT') as ExecException;
      const result = handleExecResult(error, '', 'command not found');

      expect(result.source).toBe('error');
      expect(result.models).toEqual([]);
      expect(result.error).toBeTruthy();
    });

    it('should return error on timeout', () => {
      const error = new Error('timeout') as ExecException;
      const result = handleExecResult(error, '', '');

      expect(result.source).toBe('error');
      expect(result.models).toEqual([]);
    });

    it('should return error on empty output', () => {
      const result = handleExecResult(null, '', '');

      expect(result.source).toBe('error');
      expect(result.models).toEqual([]);
      expect(result.error).toContain('No models found');
    });

    it('should return models when only stderr but stdout is valid', () => {
      const result = handleExecResult(null, 'anthropic/claude\nopenai/gpt-4', 'some warning from CLI');

      expect(result.source).toBe('opencode');
      expect(result.models).toContain('anthropic/claude');
    });

    it('should return error when only stderr and stdout is empty', () => {
      const result = handleExecResult(null, '', 'some error in stderr');

      expect(result.source).toBe('error');
      expect(result.models).toEqual([]);
    });

    it('should return CLI models in normal case', () => {
      const result = handleExecResult(null, 'anthropic/claude\nopenai/gpt-4', '');

      expect(result.source).toBe('opencode');
      expect(result.models).toContain('anthropic/claude');
    });

    it('should trim models and ignore provider headers, whitespace, and stderr noise', () => {
      const result = handleExecResult(
        null,
        '\nAnthropic\n  anthropic/claude-3.5-sonnet  \n\nOpenAI\n\topenai/gpt-4o\t\nLoaded 2 providers\n',
        'debug: provider cache refreshed\nwarning: extra stderr noise'
      );

      expect(result.source).toBe('opencode');
      expect(result.models).toEqual(['anthropic/claude-3.5-sonnet', 'openai/gpt-4o']);
    });

    it('should reject non-slash CLI output as an error', () => {
      const result = handleExecResult(null, 'Anthropic\nOpenAI\nNo models configured\n', '');

      expect(result.source).toBe('error');
      expect(result.models).toEqual([]);
      expect(result.error).toContain('No models found');
    });
  });

  describe('GET API Integration Tests', () => {
    const originalHome = process.env.HOME;
    const originalPath = process.env.PATH;
    const originalModelsTimeout = process.env.OPENCODE_MODELS_TIMEOUT_MS;

    let mockExec: MockExecFn & {
      mockImplementation: (impl: MockExecFn) => void;
      mock: { calls: unknown[][] };
    };

    beforeAll(() => {
      process.env.HOME = '/tmp';
      process.env.PATH = '/usr/bin';
      delete process.env.OPENCODE_MODELS_TIMEOUT_MS;
    });

    afterAll(() => {
      process.env.HOME = originalHome;
      process.env.PATH = originalPath;
      if (originalModelsTimeout === undefined) {
        delete process.env.OPENCODE_MODELS_TIMEOUT_MS;
      } else {
        process.env.OPENCODE_MODELS_TIMEOUT_MS = originalModelsTimeout;
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

    it('returns model-specific metadata from verbose output', async () => {
      mockExec.mockImplementation((_cmd: unknown, _opts: unknown, callback: ExecCallback) => {
        callback(null, `anthropic/claude-3.5-sonnet
{"capabilities":{"reasoning":true},"variants":{"high":{},"max":{}}}
openai/gpt-4o
{"capabilities":{"reasoning":false},"variants":{}}
`, '');
      });

      const response = await GET();
      const data = await response.json();
      const call = mockExec.mock.calls[0] as [string, { timeout: number }, ExecCallback] | undefined;

      expect(response.status).toBe(200);
      expect(data.source).toBe('opencode');
      expect(data.models).toContain('anthropic/claude-3.5-sonnet');
      expect(data.modelDetails).toEqual([
        { selector: 'anthropic/claude-3.5-sonnet', reasoning: true, variants: ['high', 'max'] },
        { selector: 'openai/gpt-4o', reasoning: false, variants: [] },
      ]);
      expect(call?.[0]).toBe('opencode models --verbose');
      expect(call?.[1]?.timeout).toBe(30000);
      expect((call?.[1] as { maxBuffer?: number })?.maxBuffer).toBe(32 * 1024 * 1024);
      expect(typeof call?.[2]).toBe('function');
    });

    it('should use OPENCODE_MODELS_TIMEOUT_MS when valid', async () => {
      process.env.OPENCODE_MODELS_TIMEOUT_MS = '45000';
      mockExec.mockImplementation((_cmd: unknown, _opts: unknown, callback: ExecCallback) => {
        callback(null, 'anthropic/claude-3.5-sonnet\n{"variants":{}}\n', '');
      });

      const response = await GET();
      const call = mockExec.mock.calls[0] as [string, { timeout: number }, ExecCallback] | undefined;
      expect(response.status).toBe(200);
      expect(call?.[0]).toBe('opencode models --verbose');
      expect(call?.[1]?.timeout).toBe(45000);
      expect(typeof call?.[2]).toBe('function');
      delete process.env.OPENCODE_MODELS_TIMEOUT_MS;
    });

    it('should return source=opencode when CLI has stderr but stdout is valid', async () => {
      mockExec.mockImplementation((_cmd: unknown, _opts: unknown, callback: ExecCallback) => {
        callback(null, 'anthropic/claude-3.5-sonnet\n{"variants":{}}\n', 'Warning: newer version available');
      });

      const response = await GET();
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.source).toBe('opencode');
    });

    it('falls back to the plain command when verbose output cannot be parsed', async () => {
      mockExec.mockImplementation((cmd: string, _opts: unknown, callback: ExecCallback) => {
        if (cmd.endsWith('--verbose')) {
          callback(null, 'anthropic/claude-3.5-sonnet\n{"variants":{', '');
        } else {
          callback(null, 'anthropic/claude-3.5-sonnet\nopenai/gpt-4o\n', '');
        }
      });

      const response = await GET();
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data).toEqual({
        models: ['anthropic/claude-3.5-sonnet', 'openai/gpt-4o'],
        source: 'opencode',
      });
      expect(mockExec.mock.calls.map((call) => call[0])).toEqual([
        'opencode models --verbose',
        'opencode models',
      ]);
    });

    it('returns 503 with an error payload when both CLI attempts fail', async () => {
      mockExec.mockImplementation((_cmd: unknown, _opts: unknown, callback: ExecCallback) => {
        callback(new Error('spawn opencode ENOENT') as ExecException, '', 'command not found');
      });

      const response = await GET();
      const data = await response.json();

      expect(response.status).toBe(503);
      expect(data.source).toBe('error');
      expect(data.models).toEqual([]);
      expect(data.error).toBeTruthy();
      expect(mockExec.mock.calls).toHaveLength(2);
    });

    it('does not expose command diagnostics in logs or the API error', async () => {
      const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
      const secret = 'provider-token-super-secret';
      mockExec.mockImplementation((_cmd: unknown, _opts: unknown, callback: ExecCallback) => {
        callback(
          new Error(`Command failed with ${secret}`) as ExecException,
          '',
          `authorization: Bearer ${secret}`
        );
      });

      const response = await GET();
      const data = await response.json();
      const logged = JSON.stringify(consoleError.mock.calls);

      expect(response.status).toBe(503);
      expect(JSON.stringify(data)).not.toContain(secret);
      expect(logged).not.toContain(secret);
      expect(logged).toContain('stderrBytes');
      consoleError.mockRestore();
    });

    it('returns 503 when both commands return no models', async () => {
      mockExec.mockImplementation((_cmd: unknown, _opts: unknown, callback: ExecCallback) => {
        callback(null, '', '');
      });

      const response = await GET();
      const data = await response.json();

      expect(response.status).toBe(503);
      expect(data.source).toBe('error');
      expect(data.models).toEqual([]);
    });
  });
});
