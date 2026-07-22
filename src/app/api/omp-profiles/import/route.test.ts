import { beforeEach, describe, expect, it, vi } from 'vitest';
import type * as OmpStorageModule from '@/lib/profiles/ompStorage';

vi.mock('@/lib/profiles/ompStorage', async () => {
  const actual = await vi.importActual<typeof OmpStorageModule>('@/lib/profiles/ompStorage');
  return {
    ...actual,
    readOmpProfileIndexStrict: vi.fn(),
    writeOmpProfileConfig: vi.fn(),
    writeOmpProfileIndex: vi.fn(),
  };
});

import {
  readOmpProfileIndexStrict,
  writeOmpProfileConfig,
  writeOmpProfileIndex,
} from '@/lib/profiles/ompStorage';
import { POST } from './route';

const mockReadIndex = vi.mocked(readOmpProfileIndexStrict);
const mockWriteConfig = vi.mocked(writeOmpProfileConfig);
const mockWriteIndex = vi.mocked(writeOmpProfileIndex);

function createRequest(body: unknown) {
  return new Request('http://localhost/api/omp-profiles/import', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }) as never;
}

function makeEmptyIndex() {
  return {
    version: 1,
    profiles: [] as { id: string; name: string; emoji: string; createdAt: string; updatedAt: string }[],
    activeProfileId: null,
    lastModified: '2026-01-01T00:00:00Z',
  };
}

const validFile = {
  version: 1,
  source: 'omx-switch',
  exportedAt: '2026-01-01T00:00:00Z',
  profile: { id: 'fast', name: 'Fast', emoji: '⚡' },
  config: { modelRoles: { default: 'kimi-code/k3' } },
};

describe('/api/omp-profiles/import', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockReadIndex.mockResolvedValue(makeEmptyIndex());
    mockWriteIndex.mockResolvedValue(undefined);
    mockWriteConfig.mockResolvedValue(undefined);
  });

  it('imports a valid profile file', async () => {
    const response = await POST(createRequest(validFile));
    const data = await response.json();

    expect(response.status).toBe(201);
    expect(data.profile.id).toBe('fast');
    expect(mockWriteConfig).toHaveBeenCalledWith('fast', { modelRoles: { default: 'kimi-code/k3' } });
  });

  it('rejects duplicate profile ids', async () => {
    mockReadIndex.mockResolvedValue({
      ...makeEmptyIndex(),
      profiles: [{ ...validFile.profile, createdAt: '', updatedAt: '' }],
    });

    const response = await POST(createRequest(validFile));

    expect(response.status).toBe(400);
    expect(mockWriteConfig).not.toHaveBeenCalled();
  });

  it('rejects invalid profile files with 400', async () => {
    for (const bad of [null, {}, { profile: { id: 'bad id!' } }]) {
      const response = await POST(createRequest(bad));

      expect(response.status).toBe(400);
    }
    expect(mockWriteConfig).not.toHaveBeenCalled();
  });

  it('rejects fallback chains containing non-string or empty entries', async () => {
    for (const fallbackChains of [
      { default: [42] },
      { default: [''] },
      { default: 'not-an-array' },
      ['not-an-object'],
    ]) {
      const response = await POST(createRequest({
        ...validFile,
        config: { ...validFile.config, fallbackChains },
      }));

      expect(response.status).toBe(400);
    }
    expect(mockWriteIndex).not.toHaveBeenCalled();
    expect(mockWriteConfig).not.toHaveBeenCalled();
  });

  it('rolls back the index when the config write fails', async () => {
    mockWriteConfig.mockRejectedValue(new Error('disk full'));

    const response = await POST(createRequest(validFile));

    expect(response.status).toBe(500);
    // second index write restores the empty profile list
    const lastIndex = mockWriteIndex.mock.calls.at(-1)?.[0];
    expect(lastIndex?.profiles).toEqual([]);
  });
});
