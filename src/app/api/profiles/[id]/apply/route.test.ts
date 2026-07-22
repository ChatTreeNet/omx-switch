import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/profiles/storage', () => ({
  readProfileConfig: vi.fn(),
  getProfileById: vi.fn(),
  setActiveProfileId: vi.fn(),
}));

vi.mock('@/lib/omoConfig', async () => {
  const actual = await vi.importActual<typeof import('@/lib/omoConfig')>('@/lib/omoConfig');
  return {
    ...actual,
    readConfig: vi.fn(),
    writeConfig: vi.fn(),
  };
});

import {
  getProfileById,
  readProfileConfig,
  setActiveProfileId,
} from '@/lib/profiles/storage';
import { readConfig, writeConfig } from '@/lib/omoConfig';
import { createExportedProfileFile, parseImportedProfileFile } from '@/lib/profiles/share';
import { POST } from './route';

const mockReadProfileConfig = vi.mocked(readProfileConfig);
const mockGetProfileById = vi.mocked(getProfileById);
const mockSetActiveProfileId = vi.mocked(setActiveProfileId);
const mockReadConfig = vi.mocked(readConfig);
const mockWriteConfig = vi.mocked(writeConfig);
let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

describe('/api/profiles/[id]/apply', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  it('applies a profile as a v4 overlay without deleting absent config keys', async () => {
    const exportedProfile = createExportedProfileFile(
      {
        id: 'v4-overlay',
        name: 'V4 Overlay',
        emoji: '🧩',
        createdAt: '2026-05-11T00:00:00.000Z',
        updatedAt: '2026-05-11T00:00:00.000Z',
      },
      {
        agents: {
          sisyphus: {
            fallback_models: [
              'anthropic/claude-opus-4-6',
              {
                model: 'google/gemini-3.1-pro',
                variant: 'high',
                reasoningEffort: 'max',
                maxTokens: 32000,
                thinking: { enabled: true },
                futureFallbackField: 'preserve-me',
              },
            ],
            reasoningEffort: 'max',
            maxTokens: 64000,
            thinking: { type: 'enabled', budget_tokens: 12000 },
            future_agent_knob: { mode: 'experimental' },
          },
        },
        categories: {
          ultrabrain: {
            reasoningEffort: 'max',
            fallback_models: [
              'openai/gpt-5.4',
              { model: 'anthropic/claude-opus-4-6', reasoningEffort: 'max' },
            ],
            future_category_knob: 'keep-me',
          },
        },
        team_mode: {
          enabled: true,
          strategy: 'pairing',
        },
        metadata: {
          owner: 'platform',
        },
      }
    );
    const importedProfile = parseImportedProfileFile(exportedProfile);

    mockGetProfileById.mockResolvedValue({
      ...importedProfile.profile,
      createdAt: '2026-05-11T00:00:00.000Z',
      updatedAt: '2026-05-11T00:00:00.000Z',
    });
    mockReadProfileConfig.mockResolvedValue(importedProfile.config);
    mockReadConfig.mockResolvedValue({
      agents: {
        sisyphus: {
          model: 'openai/gpt-5.4',
          fallback_models: ['anthropic/claude-opus-4-6'],
          system: 'Keep this system prompt',
        },
        oracle: {
          model: 'openai/gpt-5.4',
        },
      },
      categories: {
        deep: {
          model: 'openai/gpt-5.4',
          variant: 'medium',
        },
      },
      tools: {
        shell: { enabled: true },
      },
    });
    mockWriteConfig.mockResolvedValue();
    mockSetActiveProfileId.mockResolvedValue();

    const response = await POST(new Request('http://localhost/api/profiles/v4-overlay/apply') as never, {
      params: Promise.resolve({ id: 'v4-overlay' }),
    });

    expect(response.status).toBe(200);
    expect(mockWriteConfig).toHaveBeenCalledWith({
      agents: {
        sisyphus: {
          model: 'openai/gpt-5.4',
          fallback_models: [
            'anthropic/claude-opus-4-6',
            {
              model: 'google/gemini-3.1-pro',
              variant: 'high',
              reasoningEffort: 'max',
              maxTokens: 32000,
              thinking: { enabled: true },
              futureFallbackField: 'preserve-me',
            },
          ],
          reasoningEffort: 'max',
          maxTokens: 64000,
          thinking: { type: 'enabled', budget_tokens: 12000 },
          future_agent_knob: { mode: 'experimental' },
          system: 'Keep this system prompt',
        },
        oracle: {
          model: 'openai/gpt-5.4',
        },
      },
      categories: {
        deep: {
          model: 'openai/gpt-5.4',
          variant: 'medium',
        },
        ultrabrain: {
          reasoningEffort: 'max',
          fallback_models: [
            'openai/gpt-5.4',
            { model: 'anthropic/claude-opus-4-6', reasoningEffort: 'max' },
          ],
          future_category_knob: 'keep-me',
        },
      },
      team_mode: {
        enabled: true,
        strategy: 'pairing',
      },
      metadata: {
        owner: 'platform',
      },
      tools: {
        shell: { enabled: true },
      },
    });
    expect(mockSetActiveProfileId).toHaveBeenCalledWith('v4-overlay');
  });

  it('rolls config back when setting the active profile fails', async () => {
    const currentConfig = {
      agents: {
        oracle: { model: 'openai/gpt-5.4' },
      },
      team_mode: {
        enabled: false,
      },
    };

    mockGetProfileById.mockResolvedValue({
      id: 'v4-overlay',
      name: 'V4 Overlay',
      emoji: '🧩',
      createdAt: '2026-05-11T00:00:00.000Z',
      updatedAt: '2026-05-11T00:00:00.000Z',
    });
    mockReadProfileConfig.mockResolvedValue({
      agents: {
        oracle: { model: 'anthropic/claude-opus-4-6' },
      },
      team_mode: {
        enabled: true,
      },
    });
    mockReadConfig.mockResolvedValue(currentConfig);
    mockWriteConfig.mockResolvedValue();
    mockSetActiveProfileId.mockRejectedValue(new Error('index write failed'));

    const response = await POST(new Request('http://localhost/api/profiles/v4-overlay/apply') as never, {
      params: Promise.resolve({ id: 'v4-overlay' }),
    });

    expect(response.status).toBe(500);
    expect(mockWriteConfig).toHaveBeenNthCalledWith(1, {
      agents: {
        oracle: { model: 'anthropic/claude-opus-4-6' },
      },
      team_mode: {
        enabled: true,
      },
    });
    expect(mockWriteConfig).toHaveBeenNthCalledWith(2, currentConfig);
    expect(mockSetActiveProfileId).toHaveBeenCalledTimes(1);
  });
});
