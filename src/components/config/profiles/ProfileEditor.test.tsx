import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ProfileEditor } from './ProfileEditor';

const mockFetch = vi.fn<typeof fetch>();
global.fetch = mockFetch;

const profile = {
  id: 'deep-work',
  name: 'Deep Work',
  emoji: '🧠',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

function jsonResponse(data: unknown): Response {
  return {
    ok: true,
    status: 200,
    json: async () => data,
  } as Response;
}

describe('ProfileEditor OMP configuration import', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it.each([
    ['high', 'high'],
    [undefined, null],
  ])(
    'persists current defaultThinkingLevel %j as %j',
    async (apiLevel, expectedLevel) => {
      const user = userEvent.setup();
      const onSave = vi.fn();
      mockFetch.mockResolvedValueOnce(jsonResponse({
        modelRoles: { default: 'openai/gpt-5.6-sol' },
        defaultThinkingLevel: apiLevel,
        fallbackChains: {},
        modelFallback: true,
      }));

      render(
        <ProfileEditor
          profile={profile}
          apiTarget="omp"
          initialConfig={{ agents: {} }}
          onSave={onSave}
          onCancel={vi.fn()}
        />
      );

      await user.click(screen.getByRole('button', { name: /import from current config/i }));
      await screen.findByText('Configuration imported successfully');
      await user.click(screen.getByRole('button', { name: /save changes/i }));

      await waitFor(() => {
        expect(onSave).toHaveBeenCalledWith(expect.objectContaining({
          config: expect.objectContaining({
            modelRoles: { default: 'openai/gpt-5.6-sol' },
            defaultThinkingLevel: expectedLevel,
          }),
        }));
      });
    }
  );

  it.each([
    [{ agents: {} }, 'Keep current'],
    [{ agents: {}, defaultThinkingLevel: null }, 'OMP default'],
  ])(
    'labels omitted and null thinking semantics distinctly: %j',
    (initialConfig, expectedLabel) => {
      render(
        <ProfileEditor
          profile={profile}
          apiTarget="omp"
          initialConfig={initialConfig as never}
          onSave={vi.fn()}
          onCancel={vi.fn()}
        />
      );

      expect(screen.getByText(new RegExp(`thinking: ${expectedLabel}`, 'i'))).toBeInTheDocument();
    }
  );
});
