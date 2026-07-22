import { beforeEach, describe, expect, it, vi } from 'vitest';
import type * as OmpStorageModule from '@/lib/profiles/ompStorage';
import type * as OmpConfigModule from '@/lib/ompConfig';

vi.mock('@/lib/profiles/ompStorage', async () => {
  const actual = await vi.importActual<typeof OmpStorageModule>('@/lib/profiles/ompStorage');
  return {
    ...actual,
    readOmpProfileConfig: vi.fn(),
    getOmpProfileById: vi.fn(),
    setOmpActiveProfileId: vi.fn(),
  };
});

vi.mock('@/lib/ompConfig', async () => {
  const actual = await vi.importActual<typeof OmpConfigModule>('@/lib/ompConfig');
  return {
    ...actual,
    readConfig: vi.fn(),
    writeConfig: vi.fn(),
  };
});

import {
  readOmpProfileConfig,
  getOmpProfileById,
  setOmpActiveProfileId,
} from '@/lib/profiles/ompStorage';
import { readConfig, writeConfig } from '@/lib/ompConfig';
import { POST } from './route';

const mockReadProfileConfig = vi.mocked(readOmpProfileConfig);
const mockGetProfileById = vi.mocked(getOmpProfileById);
const mockSetActive = vi.mocked(setOmpActiveProfileId);
const mockReadConfig = vi.mocked(readConfig);
const mockWriteConfig = vi.mocked(writeConfig);

const profile = {
  id: 'fast',
  name: 'Fast',
  emoji: '⚡',
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
};

function createParams(id: string) {
  return { params: Promise.resolve({ id }) };
}

describe('/api/omp-profiles/[id]/apply', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockReadConfig.mockResolvedValue({});
    mockWriteConfig.mockResolvedValue(undefined);
    mockSetActive.mockResolvedValue(undefined);
  });

  it('returns 404 for an unknown profile', async () => {
    mockGetProfileById.mockResolvedValue(undefined);

    const response = await POST(new Request('http://localhost') as never, createParams('nope'));

    expect(response.status).toBe(404);
    expect(mockWriteConfig).not.toHaveBeenCalled();
  });

  it('merges profile assignments per-key and preserves other settings', async () => {
    mockGetProfileById.mockResolvedValue(profile);
    mockReadProfileConfig.mockResolvedValue({
      modelRoles: { smol: 'openai/gpt-5.4-mini' },
      fallbackChains: { default: ['openai/gpt-5.4'] },
      modelFallback: false,
    });
    mockReadConfig.mockResolvedValue({
      setupVersion: 1,
      modelRoles: { default: 'kimi-code/k3' },
      retry: { enabled: true, fallbackChains: { smol: ['kimi-code/k3'] } },
      autoResume: true,
    });

    const response = await POST(new Request('http://localhost') as never, createParams('fast'));
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.message).toBe('Profile applied successfully');
    expect(mockWriteConfig).toHaveBeenCalledWith({
      setupVersion: 1,
      modelRoles: { default: 'kimi-code/k3', smol: 'openai/gpt-5.4-mini' },
      retry: {
        enabled: true,
        fallbackChains: { smol: ['kimi-code/k3'], default: ['openai/gpt-5.4'] },
        modelFallback: false,
      },
      autoResume: true,
    });
    expect(mockSetActive).toHaveBeenCalledWith('fast');
  });

  it('rolls back the config write when activation fails', async () => {
    mockGetProfileById.mockResolvedValue(profile);
    mockReadProfileConfig.mockResolvedValue({ modelRoles: { smol: 'openai/gpt-5.4-mini' } });
    const currentConfig = { modelRoles: { default: 'kimi-code/k3' } };
    mockReadConfig.mockResolvedValue(currentConfig);
    mockSetActive.mockRejectedValue(new Error('index write failed'));

    const response = await POST(new Request('http://localhost') as never, createParams('fast'));

    expect(response.status).toBe(500);
    // merged write, then rollback write of the original config
    expect(mockWriteConfig).toHaveBeenLastCalledWith(currentConfig);
  });
});
