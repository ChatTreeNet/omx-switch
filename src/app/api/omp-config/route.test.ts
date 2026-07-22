import { beforeEach, describe, expect, it, vi } from 'vitest';
import type * as OmpConfigModule from '@/lib/ompConfig';

vi.mock('@/lib/ompConfig', async () => {
  const actual = await vi.importActual<typeof OmpConfigModule>('@/lib/ompConfig');
  return {
    ...actual,
    readConfig: vi.fn(),
    writeConfig: vi.fn(),
  };
});

import { readConfig, writeConfig } from '@/lib/ompConfig';
import { GET, POST } from './route';

const mockReadConfig = vi.mocked(readConfig);
const mockWriteConfig = vi.mocked(writeConfig);

function createPostRequest(body: unknown) {
  return new Request('http://localhost/api/omp-config', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }) as never;
}

describe('/api/omp-config', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockReadConfig.mockResolvedValue({});
    mockWriteConfig.mockResolvedValue(undefined);
  });

  it('returns modelRoles and strips secret-like fields', async () => {
    mockReadConfig.mockResolvedValue({
      modelRoles: { default: 'kimi-code/k3', smol: 'openai/gpt-5.4-mini' },
      'auth.broker.token': 'secret-token-should-not-leak',
      autoResume: true,
    });

    const response = await GET();
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.modelRoles).toEqual({ default: 'kimi-code/k3', smol: 'openai/gpt-5.4-mini' });
    expect(data.autoResume).toBe(true);
    expect(JSON.stringify(data)).not.toContain('should-not-leak');
  });

  it('returns empty modelRoles when config is missing', async () => {
    mockReadConfig.mockResolvedValue({});

    const response = await GET();
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.modelRoles).toEqual({});
  });

  it('rejects array request bodies', async () => {
    const response = await POST(createPostRequest(['not-an-object']));

    expect(response.status).toBe(400);
    expect(mockWriteConfig).not.toHaveBeenCalled();
  });

  it('rejects secret-like fields with 403 without writing config', async () => {
    const response = await POST(createPostRequest({
      modelRoles: { default: 'kimi-code/k3' },
      apiKey: 'sk-evil',
    }));
    const data = await response.json();

    expect(response.status).toBe(403);
    expect(data.error).toContain('disallowed fields');
    expect(mockWriteConfig).not.toHaveBeenCalled();
  });

  it('rejects empty model strings and non-string values', async () => {
    for (const bad of ['   ', 42, {}]) {
      const response = await POST(createPostRequest({
        modelRoles: { default: bad },
      }));

      expect(response.status).toBe(400);
      expect(mockWriteConfig).not.toHaveBeenCalled();
    }
  });

  it('rejects invalid role names', async () => {
    const response = await POST(createPostRequest({
      modelRoles: { 'bad role!': 'kimi-code/k3' },
    }));
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.error).toContain('Invalid role name');
    expect(mockWriteConfig).not.toHaveBeenCalled();
  });

  it('merges role updates into existing modelRoles and preserves other settings', async () => {
    mockReadConfig.mockResolvedValue({
      setupVersion: 1,
      modelRoles: { default: 'kimi-code/k3', smol: 'openai/gpt-5.4-mini' },
      autoResume: true,
    });

    const response = await POST(createPostRequest({
      modelRoles: { slow: 'openai/gpt-5.6-sol' },
    }));
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.modelRoles).toEqual({
      default: 'kimi-code/k3',
      smol: 'openai/gpt-5.4-mini',
      slow: 'openai/gpt-5.6-sol',
    });
    expect(mockWriteConfig).toHaveBeenCalledWith({
      setupVersion: 1,
      modelRoles: {
        default: 'kimi-code/k3',
        smol: 'openai/gpt-5.4-mini',
        slow: 'openai/gpt-5.6-sol',
      },
      autoResume: true,
    });
  });

  it('unsets a role when its model is null', async () => {
    mockReadConfig.mockResolvedValue({
      modelRoles: { default: 'kimi-code/k3', smol: 'openai/gpt-5.4-mini' },
    });

    const response = await POST(createPostRequest({
      modelRoles: { smol: null },
    }));
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.modelRoles).toEqual({ default: 'kimi-code/k3' });
    expect(mockWriteConfig).toHaveBeenCalledWith({
      modelRoles: { default: 'kimi-code/k3' },
    });
  });

  it('rejects an empty payload', async () => {
    const response = await POST(createPostRequest({}));
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.error).toBe('Missing config fields to update');
    expect(mockWriteConfig).not.toHaveBeenCalled();
  });

  it('merges fallback chains under retry.fallbackChains', async () => {
    mockReadConfig.mockResolvedValue({
      setupVersion: 1,
      modelRoles: { default: 'kimi-code/k3' },
      retry: { enabled: true, modelFallback: true, fallbackChains: { default: ['openai/gpt-5.4'] } },
    });

    const response = await POST(createPostRequest({
      fallbackChains: { smol: ['openai/gpt-5.4-mini', 'kimi-code/k3'] },
    }));
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.fallbackChains).toEqual({
      default: ['openai/gpt-5.4'],
      smol: ['openai/gpt-5.4-mini', 'kimi-code/k3'],
    });
    expect(mockWriteConfig).toHaveBeenCalledWith({
      setupVersion: 1,
      modelRoles: { default: 'kimi-code/k3' },
      retry: {
        enabled: true,
        modelFallback: true,
        fallbackChains: {
          default: ['openai/gpt-5.4'],
          smol: ['openai/gpt-5.4-mini', 'kimi-code/k3'],
        },
      },
    });
  });

  it('deletes a fallback chain when set to null and toggles modelFallback', async () => {
    mockReadConfig.mockResolvedValue({
      modelRoles: { default: 'kimi-code/k3' },
      retry: { modelFallback: true, fallbackChains: { default: ['openai/gpt-5.4'] } },
    });

    const response = await POST(createPostRequest({
      fallbackChains: { default: null },
      modelFallback: false,
    }));
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.fallbackChains).toEqual({});
    expect(data.modelFallback).toBe(false);
    expect(mockWriteConfig).toHaveBeenCalledWith({
      modelRoles: { default: 'kimi-code/k3' },
      retry: { modelFallback: false, fallbackChains: {} },
    });
  });

  it('allows secret-like role names in modelRoles and fallbackChains keys', async () => {
    mockReadConfig.mockResolvedValue({});

    const response = await POST(createPostRequest({
      modelRoles: { token: 'kimi-code/k3' },
      fallbackChains: { token: ['openai/gpt-5.4'] },
    }));
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.modelRoles).toEqual({ token: 'kimi-code/k3' });
    expect(data.fallbackChains).toEqual({ token: ['openai/gpt-5.4'] });
  });

  it('rejects malformed fallback chains', async () => {
    for (const bad of [[''], 'not-an-array', [42]]) {
      const response = await POST(createPostRequest({
        fallbackChains: { default: bad },
      }));

      expect(response.status).toBe(400);
      expect(mockWriteConfig).not.toHaveBeenCalled();
    }
  });

  it('GET surfaces fallbackChains and modelFallback from retry settings', async () => {
    mockReadConfig.mockResolvedValue({
      modelRoles: { default: 'kimi-code/k3' },
      retry: {
        modelFallback: false,
        fallbackChains: { default: ['openai/gpt-5.4', 'google/*'] },
      },
    });

    const response = await GET();
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.modelFallback).toBe(false);
    expect(data.fallbackChains).toEqual({ default: ['openai/gpt-5.4', 'google/*'] });
  });
});
